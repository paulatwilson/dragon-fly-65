import { describe, expect, it } from "bun:test";
import { lexLovelace, type LovelaceToken } from "../src/compiler";

function lex(source: string): LovelaceToken[] {
  const result = lexLovelace(source);
  if (!result.ok) {
    throw new Error(result.diagnostics.map(diagnostic => diagnostic.message).join("; "));
  }
  return result.value;
}

function significantValues(source: string): string[] {
  return lex(source)
    .filter(token => token.kind !== "newline" && token.kind !== "eof")
    .map(token => token.value);
}

describe("Lovelace lexer", () => {
  it("tokenizes the hello fixture with a top-level call and function declaration", async () => {
    const source = await Bun.file("test/fixtures/lovelace/hello.lace").text();

    expect(significantValues(source)).toEqual([
      "boot",
      "(",
      ")",
      "pub",
      "func",
      "boot",
      "(",
      ")",
      "const",
      "message",
      "=",
      "\"Hello, DragonFly 65\"",
      "end",
    ]);
  });

  it("classifies keywords, identifiers, punctuation, and newlines", () => {
    const tokens = lex("pub func boot()\nend\n");

    expect(tokens.map(token => token.kind)).toEqual([
      "keyword",
      "keyword",
      "identifier",
      "punctuation",
      "punctuation",
      "newline",
      "keyword",
      "newline",
      "eof",
    ]);
  });

  it("preserves one-based source spans", () => {
    const tokens = lex("const message = \"hi\"\n");
    const message = tokens.find(token => token.value === "message");

    expect(message?.span).toEqual({
      start: { offset: 6, line: 1, column: 7 },
      end: { offset: 13, line: 1, column: 14 },
    });
  });

  it("tokenizes Lovelace numeric literal forms", () => {
    expect(significantValues("const a = 10\nconst b = $D000\nconst c = 0x2a\nconst d = %1010\nconst e = 0.5\n")).toEqual([
      "const",
      "a",
      "=",
      "10",
      "const",
      "b",
      "=",
      "$D000",
      "const",
      "c",
      "=",
      "0x2a",
      "const",
      "d",
      "=",
      "%1010",
      "const",
      "e",
      "=",
      "0.5",
    ]);
  });

  it("skips line and block comments while preserving surrounding tokens", () => {
    expect(significantValues("const VERSION = \"0.1\" // inline\n/* block */\nvar x = 1\n")).toEqual([
      "const",
      "VERSION",
      "=",
      "\"0.1\"",
      "var",
      "x",
      "=",
      "1",
    ]);
  });

  it("tokenizes operators used by Lovelace expressions and assignments", () => {
    expect(significantValues("x += 1\ny <<= 2\nif a != b and not ready then\nend\n")).toEqual([
      "x",
      "+=",
      "1",
      "y",
      "<<=",
      "2",
      "if",
      "a",
      "!=",
      "b",
      "and",
      "not",
      "ready",
      "then",
      "end",
    ]);
  });

  it("supports dot-separated module identifiers", () => {
    expect(significantValues("import system.console: console\nconsole.print(\"hi\")\n")).toEqual([
      "import",
      "system.console",
      ":",
      "console",
      "console.print",
      "(",
      "\"hi\"",
      ")",
    ]);
  });

  it("reports unterminated strings with source path", () => {
    const result = lexLovelace("const message = \"oops", {
      sourcePath: "broken.lace",
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      {
        code: "LACE1002",
        message: "Unterminated string literal.",
        severity: "error",
        stage: "lexer",
        sourcePath: "broken.lace",
        span: {
          start: { offset: 16, line: 1, column: 17 },
          end: { offset: 21, line: 1, column: 22 },
        },
      },
    ]);
  });

  it("reports unterminated block comments", () => {
    const result = lexLovelace("/* nope");

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("LACE1003");
  });
});
