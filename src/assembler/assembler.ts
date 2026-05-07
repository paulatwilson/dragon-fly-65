import { tokenize, type Token, type TokenKind } from "./lexer";
import { ENCODE, immKind, modeOperandBytes } from "./table";
import type {
  AsmMode,
  AssemblerError,
  AssemblerOutput,
  Expr,
  ParsedOperand,
  Statement,
  Width,
} from "./types";

// ─── Parser ──────────────────────────────────────────────────────────────────

class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly errors: AssemblerError[],
  ) {}

  private eof(): Token {
    return { kind: "eof", value: "", line: 0 };
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? this.eof();
  }

  private peekKind(): TokenKind {
    return (this.tokens[this.pos] ?? this.eof()).kind;
  }

  private consume(): Token {
    return this.tokens[this.pos++] ?? this.eof();
  }

  private skip(): void {
    this.pos++;
  }

  private atEOL(): boolean {
    const k = this.peekKind();
    return k === "newline" || k === "eof";
  }

  private skipNewlines(): void {
    while (this.peekKind() === "newline") this.skip();
  }

  private error(msg: string): void {
    this.errors.push({ line: this.peek().line, message: msg });
  }

  private expect(kind: TokenKind): Token | null {
    if (this.peekKind() !== kind) {
      this.error(`expected ${kind}, got ${this.peekKind()} (${this.peek().value})`);
      return null;
    }
    return this.consume();
  }

  // Expression parsing — supports +, -, *, / and parenthesised sub-expressions
  private parseExpr(): Expr {
    return this.parseAddSub();
  }

  private parseAddSub(): Expr {
    let left = this.parseMulDiv();
    while (this.peekKind() === "plus" || this.peekKind() === "minus") {
      const op = this.consume().kind;
      const right = this.parseMulDiv();
      const lv = left.kind === "num" ? left.value : 0;
      const rv = right.kind === "num" ? right.value : 0;
      if (left.kind === "num" && right.kind === "num") {
        left = { kind: "num", value: op === "plus" ? lv + rv : lv - rv };
      } else {
        // Symbolic arithmetic — keep as the symbol (simplified: first symbol wins)
        left = left.kind === "sym" ? left : right;
      }
    }
    return left;
  }

  private parseMulDiv(): Expr {
    let left = this.parsePrimary();
    while (this.peekKind() === "star" || this.peekKind() === "slash") {
      const op = this.consume().kind;
      const right = this.parsePrimary();
      if (left.kind === "num" && right.kind === "num") {
        left = {
          kind: "num",
          value: op === "star" ? left.value * right.value : Math.trunc(left.value / right.value),
        };
      }
    }
    return left;
  }

  private parsePrimary(): Expr {
    const t = this.peek();

    if (t.kind === "minus") {
      this.skip();
      const inner = this.parsePrimary();
      if (inner.kind === "num") return { kind: "num", value: -inner.value };
      return inner; // can't negate a symbol at parse time
    }

    if (t.kind === "plus") {
      this.skip();
      return this.parsePrimary();
    }

    if (t.kind === "caret") {
      // ^ modifier: bank byte of the following expression
      this.skip();
      const inner = this.parsePrimary();
      if (inner.kind === "num") return { kind: "num", value: (inner.value >> 16) & 0xff };
      return inner;
    }

    if (t.kind === "number") {
      this.skip();
      return { kind: "num", value: parseInt(t.value, 10) };
    }

    if (t.kind === "identifier") {
      this.skip();
      return { kind: "sym", name: t.value };
    }

    if (t.kind === "lparen") {
      this.skip();
      const inner = this.parseExpr();
      this.expect("rparen");
      return inner;
    }

    if (t.kind === "star") {
      // * = current PC (handled at encode time — use a special symbol)
      this.skip();
      return { kind: "sym", name: "*" };
    }

    this.error(`unexpected token in expression: ${t.kind} (${t.value})`);
    return { kind: "num", value: 0 };
  }

  // Consume optional `.b`, `.w`, `.l` size suffix after an expression
  private parseSizeSuffix(): 8 | 16 | 32 | undefined {
    if (this.peekKind() === "dot") {
      const saved = this.pos;
      this.skip();
      const t = this.peek();
      if (t.kind === "identifier") {
        if (t.value === "b") { this.skip(); return 8; }
        if (t.value === "w") { this.skip(); return 16; }
        if (t.value === "l") { this.skip(); return 32; }
      }
      this.pos = saved; // not a size suffix — backtrack
    }
    return undefined;
  }

  private parseOperand(mnemonic: string): ParsedOperand {
    const none: ParsedOperand = { kind: "none", expr: { kind: "num", value: 0 } };

    if (this.atEOL()) return none;

    const t = this.peek();

    // Explicit accumulator: asl a
    if (t.kind === "identifier" && t.value === "a") {
      this.skip();
      if (this.atEOL()) return { kind: "none", expr: { kind: "num", value: 0 } };
      this.pos--; // not just 'a', treat as identifier
    }

    // Immediate: #expr
    if (t.kind === "hash") {
      this.skip();
      // < > ^ modifiers before the expression
      let immForce: 8 | 16 | 32 | undefined;
      if (this.peekKind() === "lt") { this.skip(); immForce = 8; }
      else if (this.peekKind() === "gt") { this.skip(); immForce = 24 as any; } // treated as 32 for 832

      const expr = this.parseExpr();
      const sfx = this.parseSizeSuffix();
      if (sfx !== undefined) immForce = sfx;
      return immForce !== undefined
        ? { kind: "imm", expr, immForce }
        : { kind: "imm", expr };
    }

    // Force-direct: <expr[,x/y]
    if (t.kind === "lt") {
      this.skip();
      const expr = this.parseExpr();
      if (this.peekKind() === "comma") {
        this.skip();
        const reg = this.peek();
        if (reg.kind === "identifier" && (reg.value === "x" || reg.value === "y")) {
          this.skip();
          return { kind: reg.value === "x" ? "addr,x" : "addr,y", expr, addrForce: 8 };
        }
        this.error("expected x or y after ,");
      }
      return { kind: "addr", expr, addrForce: 8 };
    }

    // Force-absolute: !expr[,x/y]
    if (t.kind === "bang") {
      this.skip();
      const expr = this.parseExpr();
      if (this.peekKind() === "comma") {
        this.skip();
        const reg = this.peek();
        if (reg.kind === "identifier" && (reg.value === "x" || reg.value === "y")) {
          this.skip();
          return { kind: reg.value === "x" ? "addr,x" : "addr,y", expr, addrForce: 16 };
        }
        this.error("expected x or y after ,");
      }
      return { kind: "addr", expr, addrForce: 16 };
    }

    // Force-long: >expr[,x]
    if (t.kind === "gt") {
      this.skip();
      const expr = this.parseExpr();
      if (this.peekKind() === "comma") {
        this.skip();
        const reg = this.peek();
        if (reg.kind === "identifier" && reg.value === "x") {
          this.skip();
          return { kind: "addr,x", expr, addrForce: 24 };
        }
        this.error("expected x after ,");
      }
      return { kind: "addr", expr, addrForce: 24 };
    }

    // Indirect: (expr...) or [expr...]
    if (t.kind === "lparen") {
      this.skip();
      const expr = this.parseExpr();
      const next = this.peek();

      if (next.kind === "comma") {
        this.skip();
        const reg = this.peek();
        if (reg.kind === "identifier" && reg.value === "x") {
          this.skip();
          this.expect("rparen");
          return { kind: "(addr,x)", expr };
        }
        if (reg.kind === "identifier" && reg.value === "s") {
          this.skip();
          this.expect("rparen");
          this.expect("comma");
          const yReg = this.peek();
          if (yReg.kind !== "identifier" || yReg.value !== "y") {
            this.error("expected y after (expr,s),");
          } else {
            this.skip();
          }
          return { kind: "(addr,s),y", expr };
        }
        this.error(`expected x or s after (, got ${reg.value}`);
        return none;
      }

      this.expect("rparen");

      if (this.peekKind() === "comma") {
        this.skip();
        const reg = this.peek();
        if (reg.kind === "identifier" && reg.value === "y") {
          this.skip();
          return { kind: "(addr),y", expr };
        }
        this.error("expected y after (expr),");
        return none;
      }

      return { kind: "(addr)", expr };
    }

    if (t.kind === "lbracket") {
      this.skip();
      const expr = this.parseExpr();
      this.expect("rbracket");

      if (this.peekKind() === "comma") {
        this.skip();
        const reg = this.peek();
        if (reg.kind === "identifier" && reg.value === "y") {
          this.skip();
          return { kind: "[addr],y", expr };
        }
        this.error("expected y after [expr],");
        return none;
      }

      return { kind: "[addr]", expr };
    }

    // Block move for mvn/mvp: expr,expr
    if (mnemonic === "mvn" || mnemonic === "mvp" || mnemonic === "jsl" || mnemonic === "jml") {
      // jsl/jml are aliases — parse addr normally
    }

    // Bare address: expr[,x/y/s]
    const expr = this.parseExpr();

    if (this.peekKind() === "comma") {
      this.skip();
      const reg = this.peek();
      if (reg.kind === "identifier") {
        if (reg.value === "x") { this.skip(); return { kind: "addr,x", expr }; }
        if (reg.value === "y") { this.skip(); return { kind: "addr,y", expr }; }
        if (reg.value === "s") { this.skip(); return { kind: "addr,s", expr }; }
      }
      // Could be block move: expr,expr
      if (reg.kind === "number" || reg.kind === "identifier") {
        const expr2 = this.parseExpr();
        return { kind: "block", expr, expr2 };
      }
      this.error(`unexpected operand after comma: ${reg.value}`);
    }

    return { kind: "addr", expr };
  }

  private parseDirectiveArgs(name: string, line: number): Statement | null {
    switch (name) {
      case "org": {
        const expr = this.parseExpr();
        return { type: "org", value: expr, line };
      }
      case "db":
      case "byte": {
        const values: Expr[] = [];
        while (!this.atEOL()) {
          if (this.peekKind() === "string") {
            // Inline strings: each character as a byte
            const s = this.consume().value;
            for (let i = 0; i < s.length; i++) values.push({ kind: "num", value: s.charCodeAt(i) });
          } else {
            values.push(this.parseExpr());
          }
          if (this.peekKind() === "comma") this.skip();
          else break;
        }
        return { type: "db", values, line };
      }
      case "dw":
      case "word": {
        const values: Expr[] = [];
        while (!this.atEOL()) {
          values.push(this.parseExpr());
          if (this.peekKind() === "comma") this.skip();
          else break;
        }
        return { type: "dw", values, line };
      }
      case "dl":
      case "long": {
        const values: Expr[] = [];
        while (!this.atEOL()) {
          values.push(this.parseExpr());
          if (this.peekKind() === "comma") this.skip();
          else break;
        }
        return { type: "dl", values, line };
      }
      case "ascii": {
        const t = this.peek();
        if (t.kind !== "string") { this.error(".ascii requires a string argument"); return null; }
        this.skip();
        return { type: "ascii", text: t.value, nul: false, line };
      }
      case "asciiz": {
        const t = this.peek();
        if (t.kind !== "string") { this.error(".asciiz requires a string argument"); return null; }
        this.skip();
        return { type: "ascii", text: t.value, nul: true, line };
      }
      case "resb": {
        const count = this.parseExpr();
        return { type: "resb", count, line };
      }
      case "equ":
      case "set": {
        this.error(`.${name} must follow a label (e.g. NAME .equ VALUE)`);
        return null;
      }
      case "65816":
        return { type: "cpu", mode: "65816", line };
      case "65832":
        return { type: "cpu", mode: "65832", line };
      case "a8":
        return { type: "width", reg: "acc", width: 8, line };
      case "a16":
        return { type: "width", reg: "acc", width: 16, line };
      case "a32":
        return { type: "width", reg: "acc", width: 32, line };
      case "i8":
        return { type: "width", reg: "idx", width: 8, line };
      case "i16":
        return { type: "width", reg: "idx", width: 16, line };
      case "i32":
        return { type: "width", reg: "idx", width: 32, line };
      default:
        this.error(`unknown directive: .${name}`);
        return null;
    }
  }

  parseAll(): Statement[] {
    const stmts: Statement[] = [];

    while (this.peekKind() !== "eof") {
      this.skipNewlines();
      if (this.peekKind() === "eof") break;

      const t = this.peek();
      const line = t.line;

      // Directive: .name [args]
      if (t.kind === "dot") {
        this.skip();
        const name = this.peek();
        if (name.kind !== "identifier") {
          this.error("expected directive name after .");
          this.skipNewlines();
          continue;
        }
        this.skip();
        const stmt = this.parseDirectiveArgs(name.value, line);
        if (stmt) stmts.push(stmt);
        if (!this.atEOL()) {
          this.error(`unexpected tokens after directive .${name.value}`);
        }
        continue;
      }

      // NAME .equ VALUE (no colon) — common assembler syntax
      if (
        t.kind === "identifier" &&
        this.tokens[this.pos + 1]?.kind === "dot" &&
        this.tokens[this.pos + 2]?.kind === "identifier" &&
        (this.tokens[this.pos + 2]?.value === "equ" || this.tokens[this.pos + 2]?.value === "set")
      ) {
        const name = t.value;
        this.skip(); // identifier
        this.skip(); // dot
        this.skip(); // equ/set
        const value = this.parseExpr();
        stmts.push({ type: "equ", name, value, line });
        continue;
      }

      // identifier followed by colon → label definition
      if (t.kind === "identifier" && this.tokens[this.pos + 1]?.kind === "colon") {
        const name = t.value;
        this.skip(); // identifier
        this.skip(); // colon
        stmts.push({ type: "label", name, line });

        // After a label, check for .equ / .set on the same line
        if (this.peekKind() === "dot") {
          this.skip();
          const directive = this.peek();
          if (directive.kind === "identifier" && (directive.value === "equ" || directive.value === "set")) {
            this.skip();
            const value = this.parseExpr();
            // Replace the label statement with an equ
            stmts.pop();
            stmts.push({ type: "equ", name, value, line });
            continue;
          }
          this.pos -= 2; // backtrack the dot
        }

        // The label might have an instruction on the same line
        if (!this.atEOL()) continue; // parse next tokens as instruction
        continue;
      }

      // Instruction mnemonic
      if (t.kind === "identifier") {
        const mnemonic = t.value;
        this.skip();
        const operand = this.parseOperand(mnemonic);
        if (!this.atEOL()) {
          this.error(`unexpected tokens after instruction ${mnemonic}`);
        }
        stmts.push({ type: "instr", mnemonic, operand, line });
        continue;
      }

      this.error(`unexpected token: ${t.kind} (${t.value})`);
      this.skip();
    }

    return stmts;
  }
}

// ─── Assembler state ─────────────────────────────────────────────────────────

interface AsmState {
  pc: number;
  accWidth: Width;
  idxWidth: Width;
  is832: boolean;
}

function resolveExpr(expr: Expr, symbols: Map<string, number>, pc: number): number | undefined {
  if (expr.kind === "num") return expr.value;
  if (expr.name === "*") return pc;
  const v = symbols.get(expr.name);
  return v; // undefined if not yet defined
}

// ─── Mode selection ───────────────────────────────────────────────────────────

// Returns null when no mode is found for this mnemonic+operand combination
function selectMode(
  mnemonic: string,
  operand: ParsedOperand,
  value: number,
  isForwardRef: boolean,
): AsmMode | null {
  function tryModes(modes: AsmMode[]): AsmMode | null {
    for (const m of modes) {
      if (ENCODE.has(`${mnemonic}:${m}`)) return m;
    }
    return null;
  }

  const { kind, addrForce } = operand;

  switch (kind) {
    case "none":
      return tryModes(["implied"]);

    case "imm": {
      const ik = immKind(mnemonic);
      const m: AsmMode = ik === "fixed8" ? "imm8" : "imm";
      return ENCODE.has(`${mnemonic}:${m}`) ? m : null;
    }

    case "addr": {
      let candidates: AsmMode[];
      if (addrForce === 8) candidates = ["dp"];
      else if (addrForce === 16) candidates = ["abs"];
      else if (addrForce === 24) candidates = ["long"];
      else if (isForwardRef) candidates = ["abs", "dp", "long"];  // default abs for unknown symbols
      else if (value > 0xffff) candidates = ["long", "abs"];
      else if (value > 0xff) candidates = ["abs", "long"];
      else candidates = ["dp", "abs", "long"];
      return tryModes(candidates);
    }

    case "addr,x": {
      let candidates: AsmMode[];
      if (addrForce === 8) candidates = ["dp,x"];
      else if (addrForce === 16) candidates = ["abs,x"];
      else if (addrForce === 24) candidates = ["long,x"];
      else if (isForwardRef) candidates = ["abs,x", "dp,x", "long,x"];
      else if (value > 0xffff) candidates = ["long,x", "abs,x"];
      else if (value > 0xff) candidates = ["abs,x", "long,x"];
      else candidates = ["dp,x", "abs,x", "long,x"];
      return tryModes(candidates);
    }

    case "addr,y": {
      let candidates: AsmMode[];
      if (addrForce === 8) candidates = ["dp,y"];
      else if (addrForce === 16) candidates = ["abs,y"];
      else if (isForwardRef || value > 0xff) candidates = ["abs,y", "dp,y"];
      else candidates = ["dp,y", "abs,y"];
      return tryModes(candidates);
    }

    case "addr,s":
      return ENCODE.has(`${mnemonic}:sr`) ? "sr" : null;

    case "(addr)": {
      let candidates: AsmMode[];
      if (addrForce === 8) candidates = ["(dp)"];
      else if (addrForce === 16) candidates = ["(abs)"];
      else if (isForwardRef || value > 0xff) candidates = ["(abs)", "(dp)"];
      else candidates = ["(dp)", "(abs)"];
      return tryModes(candidates);
    }

    case "[addr]": {
      let candidates: AsmMode[];
      if (addrForce === 8) candidates = ["[dp]"];
      else if (addrForce === 16) candidates = ["[abs]"];
      else if (isForwardRef || value > 0xff) candidates = ["[abs]", "[dp]"];
      else candidates = ["[dp]", "[abs]"];
      return tryModes(candidates);
    }

    case "(addr,x)": {
      let candidates: AsmMode[];
      if (addrForce === 8) candidates = ["(dp,x)"];
      else if (addrForce === 16) candidates = ["(abs,x)"];
      else if (isForwardRef || value > 0xff) candidates = ["(abs,x)", "(dp,x)"];
      else candidates = ["(dp,x)", "(abs,x)"];
      return tryModes(candidates);
    }

    case "(addr),y":
      return ENCODE.has(`${mnemonic}:(dp),y`) ? "(dp),y" : null;

    case "[addr],y":
      return ENCODE.has(`${mnemonic}:[dp],y`) ? "[dp],y" : null;

    case "(addr,s),y":
      return ENCODE.has(`${mnemonic}:(sr),y`) ? "(sr),y" : null;

    case "block":
      return ENCODE.has(`${mnemonic}:block`) ? "block" : null;
  }
}

const BRANCH_REL8 = new Set(["bpl", "bmi", "bvc", "bvs", "bcc", "bcs", "bne", "beq", "bra"]);
const BRANCH_REL16 = new Set(["brl", "per"]);

function isBranch(mnemonic: string): "rel8" | "rel16" | false {
  if (BRANCH_REL8.has(mnemonic)) return "rel8";
  if (BRANCH_REL16.has(mnemonic)) return "rel16";
  return false;
}

// Estimate instruction byte count for a statement (pass 1)
function estimateSize(
  stmt: Statement,
  symbols: Map<string, number>,
  pc: number,
  state: AsmState,
): number {
  if (stmt.type !== "instr") {
    switch (stmt.type) {
      case "org":
      case "label":
      case "equ":
      case "width":
      case "cpu":
        return 0;
      case "db":
        return stmt.values.length;
      case "dw":
        return stmt.values.length * 2;
      case "dl":
        return stmt.values.length * 3;
      case "ascii":
        return stmt.text.length + (stmt.nul ? 1 : 0);
      case "resb": {
        const n = resolveExpr(stmt.count, symbols, pc);
        return n ?? 1;
      }
    }
  }

  const { mnemonic, operand } = stmt;
  const br = isBranch(mnemonic);
  if (br) return br === "rel8" ? 2 : 3;

  // For forward references to unknown symbols, assume abs-size
  const value = resolveExpr(operand.expr, symbols, pc);
  const isForwardRef = value === undefined;
  const v = value ?? 0xffff; // worst-case for unknown

  const mode = selectMode(mnemonic, operand, v, isForwardRef);
  if (mode === null) return 1; // unknown — emit 1 byte placeholder

  const opBytes = modeOperandBytes(mode, state.accWidth, state.idxWidth, mnemonic);
  return 1 + opBytes;
}

// Emit bytes for a relative branch
function encodeRelative(opcode: number, targetExpr: Expr, pc: number, instrSize: number, wide: boolean, symbols: Map<string, number>, errors: AssemblerError[], line: number): number[] {
  const target = resolveExpr(targetExpr, symbols, pc);
  if (target === undefined) {
    errors.push({ line, message: `undefined label: ${targetExpr.kind === "sym" ? targetExpr.name : "?"}` });
    return wide ? [opcode, 0, 0] : [opcode, 0];
  }
  const offset = target - (pc + instrSize);
  if (!wide) {
    if (offset < -128 || offset > 127) {
      errors.push({ line, message: `branch target out of range: offset ${offset}` });
    }
    return [opcode, ((offset & 0xff) + 0x100) % 0x100];
  } else {
    const u = ((offset & 0xffff) + 0x10000) % 0x10000;
    return [opcode, u & 0xff, (u >> 8) & 0xff];
  }
}

// ─── Pass 2 encoding ─────────────────────────────────────────────────────────

function encodeInstr(
  stmt: Extract<Statement, { type: "instr" }>,
  pc: number,
  instrSize: number,
  symbols: Map<string, number>,
  state: AsmState,
  errors: AssemblerError[],
): number[] {
  const { mnemonic, operand, line } = stmt;

  const br = isBranch(mnemonic);
  if (br) {
    const opcode = ENCODE.get(`${mnemonic}:${br}`)!;
    return encodeRelative(opcode, operand.expr, pc, instrSize, br === "rel16", symbols, errors, line);
  }

  const rawValue = resolveExpr(operand.expr, symbols, pc);
  const isForwardRef = rawValue === undefined;
  const value = rawValue ?? 0;

  const mode = selectMode(mnemonic, operand, value, isForwardRef);
  if (mode === null) {
    errors.push({ line, message: `${mnemonic}: unsupported addressing mode or unknown instruction` });
    return [0xea]; // NOP placeholder
  }

  const opcode = ENCODE.get(`${mnemonic}:${mode}`);
  if (opcode === undefined) {
    errors.push({ line, message: `no encoding for ${mnemonic} ${mode}` });
    return [0xea];
  }

  const opBytes = modeOperandBytes(mode, state.accWidth, state.idxWidth, mnemonic);
  const bytes: number[] = [opcode];

  if (opBytes === 0) return bytes;

  if (mode === "block") {
    const src = resolveExpr(operand.expr, symbols, pc) ?? 0;
    const dest = operand.expr2 ? (resolveExpr(operand.expr2, symbols, pc) ?? 0) : 0;
    // MVN/MVP: dest bank first, then src bank (WDC encoding)
    bytes.push(dest & 0xff, src & 0xff);
    return bytes;
  }

  if (mode === "(sr),y" || mode === "sr") {
    bytes.push(value & 0xff);
    return bytes;
  }

  // Emit operand bytes little-endian
  let v = value;
  for (let i = 0; i < opBytes; i++) {
    bytes.push(v & 0xff);
    v >>= 8;
  }
  return bytes;
}

// ─── Main assembler ───────────────────────────────────────────────────────────

export function assemble(source: string): AssemblerOutput {
  const errors: AssemblerError[] = [];
  const tokens = tokenize(source, errors);
  const parser = new Parser(tokens, errors);
  const stmts = parser.parseAll();

  const symbols = new Map<string, number>();
  const state: AsmState = { pc: 0, accWidth: 8, idxWidth: 8, is832: false };
  let origin = 0;

  // Pass 1: collect symbol addresses
  for (const stmt of stmts) {
    switch (stmt.type) {
      case "label":
        if (symbols.has(stmt.name)) {
          errors.push({ line: stmt.line, message: `duplicate label: ${stmt.name}` });
        }
        symbols.set(stmt.name, state.pc);
        break;

      case "equ":
        if (stmt.value.kind === "num") {
          symbols.set(stmt.name, stmt.value.value);
        } else {
          const v = resolveExpr(stmt.value, symbols, state.pc);
          if (v !== undefined) symbols.set(stmt.name, v);
          // forward-ref .equ not supported (leave undefined for now)
        }
        break;

      case "org":
        if (stmt.value.kind === "num") {
          state.pc = stmt.value.value;
          origin = stmt.value.value;
        }
        break;

      case "width":
        if (stmt.reg === "acc") state.accWidth = stmt.width;
        else state.idxWidth = stmt.width;
        break;

      case "cpu":
        state.is832 = stmt.mode === "65832";
        break;

      default:
        state.pc += estimateSize(stmt, symbols, state.pc, state);
    }
  }

  // Pass 2: encode
  const output: number[] = [];
  const state2: AsmState = { pc: origin, accWidth: 8, idxWidth: 8, is832: false };

  for (const stmt of stmts) {
    const pc = state2.pc;

    switch (stmt.type) {
      case "label":
        // no bytes
        break;

      case "equ":
        // no bytes
        break;

      case "org": {
        const v = resolveExpr(stmt.value, symbols, pc);
        if (v !== undefined) state2.pc = v;
        break;
      }

      case "width":
        if (stmt.reg === "acc") state2.accWidth = stmt.width;
        else state2.idxWidth = stmt.width;
        break;

      case "cpu":
        state2.is832 = stmt.mode === "65832";
        break;

      case "db":
        for (const e of stmt.values) {
          const v = resolveExpr(e, symbols, pc) ?? 0;
          output.push(v & 0xff);
          state2.pc++;
        }
        break;

      case "dw":
        for (const e of stmt.values) {
          const v = resolveExpr(e, symbols, pc) ?? 0;
          output.push(v & 0xff, (v >> 8) & 0xff);
          state2.pc += 2;
        }
        break;

      case "dl":
        for (const e of stmt.values) {
          const v = resolveExpr(e, symbols, pc) ?? 0;
          output.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff);
          state2.pc += 3;
        }
        break;

      case "ascii": {
        for (let i = 0; i < stmt.text.length; i++) {
          output.push(stmt.text.charCodeAt(i) & 0xff);
          state2.pc++;
        }
        if (stmt.nul) { output.push(0); state2.pc++; }
        break;
      }

      case "resb": {
        const n = resolveExpr(stmt.count, symbols, pc) ?? 0;
        for (let i = 0; i < n; i++) { output.push(0); state2.pc++; }
        break;
      }

      case "instr": {
        const instrSize = estimateSize(stmt, symbols, pc, state2);
        const bytes = encodeInstr(stmt, pc, instrSize, symbols, state2, errors);
        for (const b of bytes) output.push(b);
        state2.pc += bytes.length;

        // Auto-track mode changes for REP/SEP in emulation mode
        if (stmt.mnemonic === "rep" && stmt.operand.expr.kind === "num") {
          const mask = stmt.operand.expr.value;
          if (mask & 0x20) state2.accWidth = state2.is832 ? 32 : 16;
          if (mask & 0x10) state2.idxWidth = state2.is832 ? 32 : 16;
        } else if (stmt.mnemonic === "sep" && stmt.operand.expr.kind === "num") {
          const mask = stmt.operand.expr.value;
          if (mask & 0x20) state2.accWidth = 8;
          if (mask & 0x10) state2.idxWidth = 8;
        }
        break;
      }
    }
  }

  return {
    bytes: new Uint8Array(output),
    origin,
    symbols,
    errors,
  };
}
