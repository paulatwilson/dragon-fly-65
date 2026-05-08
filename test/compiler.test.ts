import { describe, expect, it } from "bun:test";
import {
  compileLovelace,
  compilerError,
  compilerOk,
  createDiagnostic,
  startOfSourceSpan,
} from "../src/compiler";

describe("Lovelace compiler scaffold", () => {
  it("exposes a compile API with structured diagnostics", () => {
    const result = compileLovelace("pub func boot()\nend\n", {
      sourcePath: "boot.lace",
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      {
        code: "LACE0000",
        message: "Lovelace compiler pipeline is not implemented yet.",
        severity: "error",
        stage: "compiler",
        sourcePath: "boot.lace",
        span: startOfSourceSpan(),
      },
    ]);
  });

  it("creates diagnostics with one-based source positions", () => {
    const diagnostic = createDiagnostic({
      code: "LACE9999",
      message: "Example diagnostic",
      severity: "info",
      stage: "lexer",
    });

    expect(diagnostic.span.start).toEqual({ offset: 0, line: 1, column: 1 });
    expect(diagnostic.span.end).toEqual({ offset: 0, line: 1, column: 1 });
  });

  it("provides result helpers for later compiler stages", () => {
    expect(compilerOk({ value: 42 })).toEqual({
      ok: true,
      value: { value: 42 },
      diagnostics: [],
    });

    const diagnostic = createDiagnostic({
      code: "LACE1000",
      message: "Nope",
      severity: "error",
      stage: "parser",
    });

    expect(compilerError([diagnostic])).toEqual({
      ok: false,
      diagnostics: [diagnostic],
    });
  });

  it("keeps Lovelace source fixtures available for compiler tests", async () => {
    const fixture = Bun.file("test/fixtures/lovelace/hello.lace");
    const source = await fixture.text();

    expect(await fixture.exists()).toBe(true);
    expect(source).toContain("boot()");
    expect(source).toContain("pub func boot()");
  });
});
