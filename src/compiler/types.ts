export type LovelaceDiagnosticSeverity = "error" | "warning" | "info";

export type LovelaceCompilerStage =
  | "compiler"
  | "lexer"
  | "parser"
  | "semantic"
  | "type-checker"
  | "ir"
  | "codegen"
  | "assembler"
  | "linker";

export interface SourcePosition {
  offset: number;
  line: number;
  column: number;
}

export interface SourceSpan {
  start: SourcePosition;
  end: SourcePosition;
}

export interface LovelaceDiagnostic {
  code: string;
  message: string;
  severity: LovelaceDiagnosticSeverity;
  stage: LovelaceCompilerStage;
  span: SourceSpan;
  sourcePath?: string;
}

export interface LovelaceCompileOptions {
  sourcePath?: string;
  entryPoint?: string;
  emitAssembly?: boolean;
}

export interface LovelaceBuildOutput {
  assembly: string;
  binary: Uint8Array;
  entryPoint: string;
}

export type LovelaceTokenKind =
  | "keyword"
  | "identifier"
  | "number"
  | "string"
  | "operator"
  | "punctuation"
  | "newline"
  | "eof";

export interface LovelaceToken {
  kind: LovelaceTokenKind;
  value: string;
  span: SourceSpan;
}

export interface LovelaceLexOptions {
  sourcePath?: string;
}

export type CompilerResult<T> =
  | { ok: true; value: T; diagnostics: LovelaceDiagnostic[] }
  | { ok: false; diagnostics: LovelaceDiagnostic[] };
