import { compilerError, compilerOk } from "./result";
import { lowerLovelaceToIr } from "./ir";
import type {
  CompilerResult,
  LovelaceAssemblyOutput,
  LovelaceCheckedType,
  LovelaceCodegenOptions,
  LovelaceIrFunction,
  LovelaceIrGlobal,
  LovelaceIrInstruction,
  LovelaceIrModule,
  LovelaceIrValue,
} from "./types";

const WORD_BYTES = 4;

export function generateLovelaceAssembly(
  source: string,
  options: LovelaceCodegenOptions = {},
): CompilerResult<LovelaceAssemblyOutput> {
  const lowered = lowerLovelaceToIr(source, options);
  if (!lowered.ok) {
    return compilerError(lowered.diagnostics);
  }

  const generator = new LovelaceCodeGenerator(lowered.value, options);
  return compilerOk(generator.generate());
}

class LovelaceCodeGenerator {
  private readonly lines: string[] = [];
  private readonly dataLines: string[] = [];
  private readonly slots = new Map<string, string>();
  private readonly strings = new Map<string, string>();
  private labelId = 0;

  public constructor(
    private readonly ir: LovelaceIrModule,
    private readonly options: LovelaceCodegenOptions,
  ) {}

  public generate(): LovelaceAssemblyOutput {
    const entryPoint = this.options.entryPoint ?? "boot";

    this.collectStorage();
    this.emitHeader(entryPoint);
    this.emitInitializers();

    for (const fn of this.ir.functions) {
      this.emitFunction(fn);
    }

    this.emitData();

    return {
      assembly: `${this.lines.join("\n")}\n`,
      entryPoint,
      ir: this.ir,
    };
  }

  private emitHeader(entryPoint: string): void {
    this.emit("; DragonFly 65 Lovelace v1 generated assembly");
    this.emit("; Calling convention: first argument in A, remaining arguments on stack, return value in A.");
    this.emit(".65832");
    this.emit(".a32");
    this.emit(".i32");
    this.emit("");
    this.emit("lace_start:");
    this.emit("  jsr lace_init");
    this.emit(`  jsr ${functionLabel(entryPoint)}`);
    this.emit("  stp");
    this.emit("");
  }

  private emitInitializers(): void {
    this.emit("lace_init:");
    for (const instruction of this.ir.initializers) {
      this.emitInstruction(instruction, "lace_init");
    }
    this.emit("  rts");
    this.emit("");
  }

  private emitFunction(fn: LovelaceIrFunction): void {
    this.emit(`${functionLabel(fn.name)}:`);

    if (fn.parameters[0] !== undefined) {
      this.emit("  ; first argument arrives in A");
      this.emit(`  sta ${this.slotForLocal(fn.name, fn.parameters[0].name)}`);
    }
    for (let index = fn.parameters.length - 1; index >= 1; index -= 1) {
      const parameter = fn.parameters[index];
      if (parameter !== undefined) {
        this.emit(`  pla ; argument ${index + 1}`);
        this.emit(`  sta ${this.slotForLocal(fn.name, parameter.name)}`);
      }
    }

    let explicitReturn = false;
    for (const instruction of fn.body) {
      if (instruction.op === "return") {
        explicitReturn = true;
      }
      this.emitInstruction(instruction, fn.name);
    }
    if (!explicitReturn) {
      this.emit("  rts");
    }
    this.emit("");
  }

  private emitInstruction(instruction: LovelaceIrInstruction, scope: string): void {
    switch (instruction.op) {
      case "declare":
        this.emit(`  ; declare ${this.valueName(instruction.target)}`);
        break;
      case "assign":
        this.loadValue(instruction.value, scope);
        this.storeValue(instruction.target, scope);
        break;
      case "binary":
        this.emitBinary(instruction, scope);
        break;
      case "unary":
        this.emitUnary(instruction, scope);
        break;
      case "call":
        this.emitCall(instruction, scope);
        break;
      case "cast":
        this.loadValue(instruction.value, scope);
        this.storeValue(instruction.target, scope);
        break;
      case "index":
      case "member":
      case "struct":
        this.emit(`  ; ${instruction.op} lowering is reserved for the runtime/linker chunks`);
        this.emit("  lda #0.l");
        this.storeValue(instruction.target, scope);
        break;
      case "return":
        if (instruction.values[0] !== undefined) {
          this.loadValue(instruction.values[0], scope);
        }
        this.emit("  rts");
        break;
      case "label":
        this.emit(`${localLabel(scope, instruction.name)}:`);
        break;
      case "jump":
        this.emit(`  bra ${localLabel(scope, instruction.label)}`);
        break;
      case "jumpIfFalse":
        this.loadValue(instruction.test, scope);
        this.emit("  cmp #0.l");
        this.emit(`  beq ${localLabel(scope, instruction.label)}`);
        break;
      case "asm":
        this.emitInlineAssembly(instruction.body);
        break;
    }
  }

  private emitBinary(
    instruction: Extract<LovelaceIrInstruction, { op: "binary" }>,
    scope: string,
  ): void {
    switch (instruction.operator) {
      case "+":
        this.loadValue(instruction.left, scope);
        this.emit("  clc");
        this.emit(`  adc ${this.operandForValue(instruction.right, scope)}`);
        this.storeValue(instruction.target, scope);
        break;
      case "-":
        this.loadValue(instruction.left, scope);
        this.emit("  sec");
        this.emit(`  sbc ${this.operandForValue(instruction.right, scope)}`);
        this.storeValue(instruction.target, scope);
        break;
      case "&":
        this.loadValue(instruction.left, scope);
        this.emit(`  and ${this.operandForValue(instruction.right, scope)}`);
        this.storeValue(instruction.target, scope);
        break;
      case "|":
      case "or":
        this.loadValue(instruction.left, scope);
        this.emit(`  ora ${this.operandForValue(instruction.right, scope)}`);
        this.storeValue(instruction.target, scope);
        break;
      case "^":
        this.loadValue(instruction.left, scope);
        this.emit(`  eor ${this.operandForValue(instruction.right, scope)}`);
        this.storeValue(instruction.target, scope);
        break;
      case "==":
      case "!=":
      case "<":
      case "<=":
      case ">":
      case ">=":
        this.emitComparison(instruction, scope);
        break;
      case "and":
        this.emitBooleanAnd(instruction, scope);
        break;
      default:
        this.emit(`  ; unsupported binary operator ${instruction.operator}`);
        this.emit("  lda #0.l");
        this.storeValue(instruction.target, scope);
        break;
    }
  }

  private emitUnary(
    instruction: Extract<LovelaceIrInstruction, { op: "unary" }>,
    scope: string,
  ): void {
    switch (instruction.operator) {
      case "-":
        this.emit("  lda #0.l");
        this.emit("  sec");
        this.emit(`  sbc ${this.operandForValue(instruction.argument, scope)}`);
        this.storeValue(instruction.target, scope);
        break;
      case "~":
        this.loadValue(instruction.argument, scope);
        this.emit("  eor #$ffffffff.l");
        this.storeValue(instruction.target, scope);
        break;
      case "not":
        this.loadValue(instruction.argument, scope);
        this.emit("  cmp #0.l");
        this.emitBooleanResult("beq", instruction.target, scope);
        break;
      default:
        this.loadValue(instruction.argument, scope);
        this.storeValue(instruction.target, scope);
        break;
    }
  }

  private emitCall(
    instruction: Extract<LovelaceIrInstruction, { op: "call" }>,
    scope: string,
  ): void {
    for (let index = instruction.args.length - 1; index >= 1; index -= 1) {
      const argument = instruction.args[index];
      if (argument !== undefined) {
        this.loadValue(argument, scope);
        this.emit("  pha");
      }
    }

    if (instruction.args[0] !== undefined) {
      this.loadValue(instruction.args[0], scope);
    }

    this.emit(`  jsr ${functionLabel(instruction.callee)}`);
    if (instruction.target !== undefined) {
      this.storeValue(instruction.target, scope);
    }
  }

  private emitComparison(
    instruction: Extract<LovelaceIrInstruction, { op: "binary" }>,
    scope: string,
  ): void {
    const trueLabel = this.nextLabel("cmp_true");
    const doneLabel = this.nextLabel("cmp_done");

    this.loadValue(instruction.left, scope);
    this.emit(`  cmp ${this.operandForValue(instruction.right, scope)}`);

    switch (instruction.operator) {
      case "==":
        this.emit(`  beq ${trueLabel}`);
        break;
      case "!=":
        this.emit(`  bne ${trueLabel}`);
        break;
      case "<":
        this.emit(`  bcc ${trueLabel}`);
        break;
      case "<=":
        this.emit(`  beq ${trueLabel}`);
        this.emit(`  bcc ${trueLabel}`);
        break;
      case ">":
        this.emit(`  bcc ${doneLabel}`);
        this.emit(`  beq ${doneLabel}`);
        this.emit(`  bra ${trueLabel}`);
        break;
      case ">=":
        this.emit(`  bcs ${trueLabel}`);
        break;
    }

    this.emit("  lda #0.l");
    this.emit(`  bra ${doneLabel}`);
    this.emit(`${trueLabel}:`);
    this.emit("  lda #1.l");
    this.emit(`${doneLabel}:`);
    this.storeValue(instruction.target, scope);
  }

  private emitBooleanAnd(
    instruction: Extract<LovelaceIrInstruction, { op: "binary" }>,
    scope: string,
  ): void {
    const falseLabel = this.nextLabel("and_false");
    const doneLabel = this.nextLabel("and_done");
    this.loadValue(instruction.left, scope);
    this.emit("  cmp #0.l");
    this.emit(`  beq ${falseLabel}`);
    this.loadValue(instruction.right, scope);
    this.emit("  cmp #0.l");
    this.emit(`  beq ${falseLabel}`);
    this.emit("  lda #1.l");
    this.emit(`  bra ${doneLabel}`);
    this.emit(`${falseLabel}:`);
    this.emit("  lda #0.l");
    this.emit(`${doneLabel}:`);
    this.storeValue(instruction.target, scope);
  }

  private emitBooleanResult(branch: string, target: LovelaceIrValue, scope: string): void {
    const trueLabel = this.nextLabel("bool_true");
    const doneLabel = this.nextLabel("bool_done");
    this.emit(`  ${branch} ${trueLabel}`);
    this.emit("  lda #0.l");
    this.emit(`  bra ${doneLabel}`);
    this.emit(`${trueLabel}:`);
    this.emit("  lda #1.l");
    this.emit(`${doneLabel}:`);
    this.storeValue(target, scope);
  }

  private emitInlineAssembly(body: string): void {
    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.length > 0) {
        this.emit(`  ${line}`);
      }
    }
  }

  private loadValue(value: LovelaceIrValue, scope: string): void {
    switch (value.kind) {
      case "literal":
        this.emit(`  lda ${this.literalOperand(value)}`);
        break;
      case "global":
      case "local":
      case "temp":
        this.emit(`  lda ${this.slotForValue(value, scope)}`);
        break;
    }
  }

  private storeValue(value: LovelaceIrValue, scope: string): void {
    switch (value.kind) {
      case "global":
      case "local":
      case "temp":
        this.emit(`  sta ${this.slotForValue(value, scope)}`);
        break;
      case "literal":
        break;
    }
  }

  private operandForValue(value: LovelaceIrValue, scope: string): string {
    if (value.kind === "literal") {
      return this.literalOperand(value);
    }
    return this.slotForValue(value, scope);
  }

  private literalOperand(value: Extract<LovelaceIrValue, { kind: "literal" }>): string {
    switch (value.literalKind) {
      case "boolean":
        return value.value === "true" ? "#1.l" : "#0.l";
      case "null":
        return "#0.l";
      case "number":
        return `#${normalizeNumber(value.value)}.l`;
      case "string":
        return `#${this.stringLabel(value.value)}.l`;
    }
  }

  private collectStorage(): void {
    for (const global of this.ir.globals) {
      this.reserveSlot(globalSlot(global.name), global.type);
    }
    for (const instruction of this.ir.initializers) {
      this.collectInstructionStorage(instruction, "lace_init");
    }
    for (const fn of this.ir.functions) {
      for (const parameter of fn.parameters) {
        this.reserveSlot(localSlot(fn.name, parameter.name), parameter.type);
      }
      for (const instruction of fn.body) {
        this.collectInstructionStorage(instruction, fn.name);
      }
    }
  }

  private collectInstructionStorage(instruction: LovelaceIrInstruction, scope: string): void {
    for (const value of valuesInInstruction(instruction)) {
      if (value.kind === "literal" && value.literalKind === "string") {
        this.stringLabel(value.value);
        continue;
      }
      if (value.kind === "global" || value.kind === "local" || value.kind === "temp") {
        this.reserveSlot(this.slotForValue(value, scope), value.type);
      }
    }
  }

  private emitData(): void {
    this.emit("; Storage");
    for (const line of this.dataLines) {
      this.emit(line);
    }
    if (this.strings.size > 0) {
      this.emit("");
      this.emit("; String literals");
      for (const [value, label] of this.strings) {
        this.emit(`${label}:`);
        this.emit(`  .asciiz ${quoteAssemblyString(value)}`);
      }
    }
  }

  private reserveSlot(label: string, type: LovelaceCheckedType): void {
    if (this.slots.has(label)) {
      return;
    }
    this.slots.set(label, label);
    this.dataLines.push(`${label}:`);
    this.dataLines.push(`  .resb ${storageBytes(type)}`);
  }

  private slotForValue(value: LovelaceIrValue, scope = "lace_init"): string {
    switch (value.kind) {
      case "global":
        return globalSlot(value.name);
      case "local":
        return localSlot(scope, value.name);
      case "temp":
        return tempSlot(scope, value.name);
      case "literal":
        return "";
    }
  }

  private slotForLocal(scope: string, name: string): string {
    return localSlot(scope, name);
  }

  private stringLabel(value: string): string {
    const existing = this.strings.get(value);
    if (existing !== undefined) {
      return existing;
    }
    const label = `lace_str_${this.strings.size}`;
    this.strings.set(value, label);
    return label;
  }

  private valueName(value: LovelaceIrValue): string {
    return value.kind === "literal" ? value.value : value.name;
  }

  private nextLabel(prefix: string): string {
    const label = `lace_${prefix}_${this.labelId}`;
    this.labelId += 1;
    return label;
  }

  private emit(line: string): void {
    this.lines.push(line);
  }
}

function valuesInInstruction(instruction: LovelaceIrInstruction): LovelaceIrValue[] {
  switch (instruction.op) {
    case "declare":
      return [instruction.target];
    case "assign":
      return [instruction.target, instruction.value];
    case "binary":
      return [instruction.target, instruction.left, instruction.right];
    case "unary":
      return [instruction.target, instruction.argument];
    case "call":
      return [...(instruction.target === undefined ? [] : [instruction.target]), ...instruction.args];
    case "cast":
      return [instruction.target, instruction.value];
    case "index":
      return [instruction.target, instruction.object, instruction.index];
    case "member":
      return [instruction.target, instruction.object];
    case "struct":
      return [instruction.target, ...instruction.fields.map(field => field.value)];
    case "return":
      return instruction.values;
    case "jumpIfFalse":
      return [instruction.test];
    case "label":
    case "jump":
    case "asm":
      return [];
  }
}

function storageBytes(type: LovelaceCheckedType): number {
  void type;
  return WORD_BYTES;
}

function functionLabel(name: string): string {
  return `lace_fn_${sanitize(name)}`;
}

function globalSlot(name: string): string {
  return `lace_global_${sanitize(name)}`;
}

function localSlot(scope: string, name: string): string {
  return `lace_local_${sanitize(scope)}_${sanitize(name)}`;
}

function tempSlot(scope: string, name: string): string {
  return `lace_temp_${sanitize(scope)}_${sanitize(name)}`;
}

function localLabel(scope: string, label: string): string {
  return `lace_label_${sanitize(scope)}_${sanitize(label)}`;
}

function sanitize(name: string): string {
  const sanitized = name.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+/, "");
  return /^[a-z_]/.test(sanitized) ? sanitized : `l_${sanitized}`;
}

function normalizeNumber(value: string): string {
  if (value.startsWith("$")) {
    return `0x${value.slice(1)}`;
  }
  if (value.startsWith("%")) {
    return String(parseInt(value.slice(1), 2));
  }
  return value;
}

function quoteAssemblyString(value: string): string {
  return JSON.stringify(unquoteLovelaceString(value));
}

function unquoteLovelaceString(value: string): string {
  if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
    return value.slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, "\"")
      .replace(/\\\\/g, "\\");
  }
  return value;
}
