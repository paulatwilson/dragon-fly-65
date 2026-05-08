import { describe, expect, it } from "bun:test";
import {
  compileLovelace,
  compilerError,
  compilerOk,
  createDiagnostic,
} from "../src/compiler";

describe("Lovelace compiler", () => {
  it("assembles Lovelace source into a binary image", () => {
    const result = compileLovelace("pub func boot()\nend\n", {
      sourcePath: "boot.lace",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.diagnostics.map(diagnostic => diagnostic.message).join("; "));
    }
    expect(result.value.entryPoint).toBe("boot");
    expect(result.value.assembly).toContain("lace_start:");
    expect(result.value.assembly).toContain("jsr lace_fn_boot");
    expect(result.value.binary).toBeInstanceOf(Uint8Array);
    expect(result.value.binary.length).toBeGreaterThan(0);
  });

  it("selects a custom entry point at build time", () => {
    const result = compileLovelace(`
pub func start(): int
    return 7
end
`, {
      entryPoint: "start",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.diagnostics.map(diagnostic => diagnostic.message).join("; "));
    }
    expect(result.value.entryPoint).toBe("start");
    expect(result.value.assembly).toContain("jsr lace_fn_start");
  });

  it("reports a missing entry point before assembly", () => {
    const result = compileLovelace("pub func boot()\nend\n", {
      entryPoint: "start",
      sourcePath: "boot.lace",
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "LACE5001",
      message: "Entry point 'start' was not found.",
      severity: "error",
      stage: "codegen",
      sourcePath: "boot.lace",
    });
  });

  it("preserves earlier compiler diagnostics through the full pipeline", () => {
    const result = compileLovelace(`
func boot()
    const name: string = 1
end
`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "LACE4004",
      stage: "type-checker",
    });
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
