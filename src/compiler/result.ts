import type { CompilerResult, LovelaceDiagnostic } from "./types";

export function compilerOk<T>(
  value: T,
  diagnostics: LovelaceDiagnostic[] = [],
): CompilerResult<T> {
  return { ok: true, value, diagnostics };
}

export function compilerError<T = never>(
  diagnostics: LovelaceDiagnostic[],
): CompilerResult<T> {
  return { ok: false, diagnostics };
}
