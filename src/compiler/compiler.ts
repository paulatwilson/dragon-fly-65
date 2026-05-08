import { createDiagnostic } from "./diagnostics";
import { compilerError } from "./result";
import type {
  CompilerResult,
  LovelaceBuildOutput,
  LovelaceCompileOptions,
} from "./types";

export function compileLovelace(
  source: string,
  options: LovelaceCompileOptions = {},
): CompilerResult<LovelaceBuildOutput> {
  void source;
  const sourcePath = options.sourcePath;

  return compilerError([
    createDiagnostic({
      code: "LACE0000",
      message: "Lovelace compiler pipeline is not implemented yet.",
      severity: "error",
      stage: "compiler",
      ...(sourcePath === undefined ? {} : { sourcePath }),
    }),
  ]);
}
