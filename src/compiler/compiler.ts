import { assemble } from "../assembler";
import { createDiagnostic } from "./diagnostics";
import { generateLovelaceAssembly } from "./codegen";
import { compilerError, compilerOk } from "./result";
import type {
  CompilerResult,
  LovelaceBuildOutput,
  LovelaceCompileOptions,
} from "./types";

export function compileLovelace(
  source: string,
  options: LovelaceCompileOptions = {},
): CompilerResult<LovelaceBuildOutput> {
  const generated = generateLovelaceAssembly(source, options);
  if (!generated.ok) {
    return compilerError(generated.diagnostics);
  }

  const assembled = assemble(generated.value.assembly);
  if (assembled.errors.length > 0) {
    return compilerError(
      assembled.errors.map(error =>
        createDiagnostic({
          code: "LACE6001",
          message: `Assembler line ${error.line}: ${error.message}`,
          severity: "error",
          stage: "assembler",
          ...(options.sourcePath === undefined ? {} : { sourcePath: options.sourcePath }),
        }),
      ),
    );
  }

  return compilerOk({
    assembly: generated.value.assembly,
    binary: assembled.bytes,
    entryPoint: generated.value.entryPoint,
  });
}
