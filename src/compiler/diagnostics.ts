import type {
  LovelaceCompilerStage,
  LovelaceDiagnostic,
  LovelaceDiagnosticSeverity,
  SourcePosition,
  SourceSpan,
} from "./types";

export function createSourcePosition(
  offset: number,
  line: number,
  column: number,
): SourcePosition {
  return { offset, line, column };
}

export function createSourceSpan(
  start: SourcePosition,
  end: SourcePosition,
): SourceSpan {
  return { start, end };
}

export function startOfSourceSpan(): SourceSpan {
  const position = createSourcePosition(0, 1, 1);
  return createSourceSpan(position, position);
}

export function createDiagnostic(options: {
  code: string;
  message: string;
  severity: LovelaceDiagnosticSeverity;
  stage: LovelaceCompilerStage;
  span?: SourceSpan;
  sourcePath?: string;
}): LovelaceDiagnostic {
  return {
    code: options.code,
    message: options.message,
    severity: options.severity,
    stage: options.stage,
    span: options.span ?? startOfSourceSpan(),
    ...(options.sourcePath === undefined ? {} : { sourcePath: options.sourcePath }),
  };
}
