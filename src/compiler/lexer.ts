import { createDiagnostic } from "./diagnostics";
import { compilerError, compilerOk } from "./result";
import type {
  CompilerResult,
  LovelaceDiagnostic,
  LovelaceLexOptions,
  LovelaceToken,
  LovelaceTokenKind,
  SourcePosition,
  SourceSpan,
} from "./types";

export const LOVELACE_KEYWORDS = new Set([
  "module",
  "import",
  "pub",
  "const",
  "var",
  "type",
  "struct",
  "func",
  "return",
  "if",
  "then",
  "else",
  "while",
  "for",
  "in",
  "to",
  "break",
  "continue",
  "switch",
  "case",
  "default",
  "end",
  "asm",
  "unsafe",
  "pointer",
  "true",
  "false",
  "null",
  "and",
  "or",
  "not",
  "cast",
]);

const MULTI_CHAR_OPERATORS = [
  "<<=",
  ">>=",
  "==",
  "!=",
  "<=",
  ">=",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "<<",
  ">>",
  "++",
  "--",
  "**",
] as const;

const SINGLE_CHAR_OPERATORS = new Set([
  "+",
  "-",
  "*",
  "/",
  "%",
  "=",
  "<",
  ">",
  "&",
  "|",
  "^",
  "~",
]);

const PUNCTUATION = new Set(["(", ")", "{", "}", "[", "]", ",", ":", "."]);

export function lexLovelace(
  source: string,
  options: LovelaceLexOptions = {},
): CompilerResult<LovelaceToken[]> {
  const lexer = new LovelaceLexer(source, options);
  return lexer.lex();
}

class LovelaceLexer {
  private index = 0;
  private line = 1;
  private column = 1;
  private readonly tokens: LovelaceToken[] = [];
  private readonly diagnostics: LovelaceDiagnostic[] = [];

  public constructor(
    private readonly source: string,
    private readonly options: LovelaceLexOptions,
  ) {}

  public lex(): CompilerResult<LovelaceToken[]> {
    while (!this.isAtEnd()) {
      const char = this.peek();

      if (char === " " || char === "\t" || char === "\r") {
        this.advance();
        continue;
      }

      if (char === "\n") {
        this.emitSingleCharacterToken("newline");
        continue;
      }

      if (char === "/" && this.peekNext() === "/") {
        this.skipLineComment();
        continue;
      }

      if (char === "/" && this.peekNext() === "*") {
        this.skipBlockComment();
        continue;
      }

      if (char === "\"") {
        this.lexString();
        continue;
      }

      if (this.isNumberStart(char)) {
        this.lexNumber();
        continue;
      }

      if (isIdentifierStart(char)) {
        this.lexIdentifierOrKeyword();
        continue;
      }

      const operator = this.matchOperator();
      if (operator !== undefined) {
        this.emitFixedToken("operator", operator);
        continue;
      }

      if (PUNCTUATION.has(char)) {
        this.emitSingleCharacterToken("punctuation");
        continue;
      }

      const span = this.spanFrom(this.position());
      this.diagnostics.push(
        this.createLexerDiagnostic(
          "LACE1001",
          `Unexpected character '${char}'.`,
          span,
        ),
      );
      this.advance();
    }

    const eofPosition = this.position();
    this.tokens.push({
      kind: "eof",
      value: "",
      span: { start: eofPosition, end: eofPosition },
    });

    if (this.diagnostics.length > 0) {
      return compilerError(this.diagnostics);
    }

    return compilerOk(this.tokens);
  }

  private lexIdentifierOrKeyword(): void {
    const start = this.position();
    let value = "";

    while (!this.isAtEnd()) {
      const char = this.peek();
      const next = this.peekNext();
      if (isIdentifierPart(char)) {
        value += this.advance();
        continue;
      }
      if (char === "." && next !== undefined && isIdentifierStart(next)) {
        value += this.advance();
        continue;
      }
      break;
    }

    this.tokens.push({
      kind: LOVELACE_KEYWORDS.has(value) ? "keyword" : "identifier",
      value,
      span: this.spanFrom(start),
    });
  }

  private lexNumber(): void {
    const start = this.position();
    let value = "";

    if (this.peek() === "$") {
      value += this.advance();
      while (!this.isAtEnd() && isHexDigit(this.peek())) {
        value += this.advance();
      }
      this.pushToken("number", value, start);
      return;
    }

    if (this.peek() === "%") {
      value += this.advance();
      while (!this.isAtEnd() && isBinaryDigit(this.peek())) {
        value += this.advance();
      }
      this.pushToken("number", value, start);
      return;
    }

    if (this.peek() === "0" && (this.peekNext() === "x" || this.peekNext() === "X")) {
      value += this.advance();
      value += this.advance();
      while (!this.isAtEnd() && isHexDigit(this.peek())) {
        value += this.advance();
      }
      this.pushToken("number", value, start);
      return;
    }

    while (!this.isAtEnd() && isDecimalDigit(this.peek())) {
      value += this.advance();
    }

    const next = this.peekNext();
    if (this.peek() === "." && next !== undefined && isDecimalDigit(next)) {
      value += this.advance();
      while (!this.isAtEnd() && isDecimalDigit(this.peek())) {
        value += this.advance();
      }
    }

    this.pushToken("number", value, start);
  }

  private lexString(): void {
    const start = this.position();
    let value = this.advance();
    let escaped = false;

    while (!this.isAtEnd()) {
      const char = this.advance();
      value += char;

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === "\"") {
        this.pushToken("string", value, start);
        return;
      }
    }

    this.diagnostics.push(
      this.createLexerDiagnostic(
        "LACE1002",
        "Unterminated string literal.",
        this.spanFrom(start),
      ),
    );
  }

  private skipLineComment(): void {
    while (!this.isAtEnd() && this.peek() !== "\n") {
      this.advance();
    }
  }

  private skipBlockComment(): void {
    const start = this.position();
    this.advance();
    this.advance();

    while (!this.isAtEnd()) {
      if (this.peek() === "*" && this.peekNext() === "/") {
        this.advance();
        this.advance();
        return;
      }
      this.advance();
    }

    this.diagnostics.push(
      this.createLexerDiagnostic(
        "LACE1003",
        "Unterminated block comment.",
        this.spanFrom(start),
      ),
    );
  }

  private matchOperator(): string | undefined {
    for (const operator of MULTI_CHAR_OPERATORS) {
      if (this.source.startsWith(operator, this.index)) {
        return operator;
      }
    }

    const char = this.peek();
    return SINGLE_CHAR_OPERATORS.has(char) ? char : undefined;
  }

  private emitFixedToken(kind: LovelaceTokenKind, value: string): void {
    const start = this.position();
    for (let i = 0; i < value.length; i += 1) {
      this.advance();
    }
    this.pushToken(kind, value, start);
  }

  private emitSingleCharacterToken(kind: LovelaceTokenKind): void {
    const start = this.position();
    const value = this.advance();
    this.pushToken(kind, value, start);
  }

  private pushToken(
    kind: LovelaceTokenKind,
    value: string,
    start: SourcePosition,
  ): void {
    this.tokens.push({ kind, value, span: this.spanFrom(start) });
  }

  private createLexerDiagnostic(
    code: string,
    message: string,
    span: SourceSpan,
  ): LovelaceDiagnostic {
    const sourcePath = this.options.sourcePath;
    return createDiagnostic({
      code,
      message,
      severity: "error",
      stage: "lexer",
      span,
      ...(sourcePath === undefined ? {} : { sourcePath }),
    });
  }

  private isNumberStart(char: string): boolean {
    if (isDecimalDigit(char)) {
      return true;
    }
    if (char === "$") {
      const next = this.peekNext();
      return next !== undefined && isHexDigit(next);
    }
    if (char === "%") {
      const next = this.peekNext();
      return next !== undefined && isBinaryDigit(next);
    }
    return false;
  }

  private spanFrom(start: SourcePosition): SourceSpan {
    return {
      start,
      end: this.position(),
    };
  }

  private position(): SourcePosition {
    return {
      offset: this.index,
      line: this.line,
      column: this.column,
    };
  }

  private peek(): string {
    return this.source[this.index] ?? "";
  }

  private peekNext(): string | undefined {
    return this.source[this.index + 1];
  }

  private advance(): string {
    const char = this.source[this.index] ?? "";
    this.index += 1;
    if (char === "\n") {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
    return char;
  }

  private isAtEnd(): boolean {
    return this.index >= this.source.length;
  }
}

function isIdentifierStart(char: string): boolean {
  return /^[A-Za-z_]$/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /^[A-Za-z0-9_]$/.test(char);
}

function isDecimalDigit(char: string): boolean {
  return /^[0-9]$/.test(char);
}

function isHexDigit(char: string): boolean {
  return /^[0-9A-Fa-f]$/.test(char);
}

function isBinaryDigit(char: string): boolean {
  return char === "0" || char === "1";
}
