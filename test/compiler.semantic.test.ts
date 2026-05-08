import { describe, expect, it } from "bun:test";
import {
  analyzeLovelace,
  type LovelaceSemanticModel,
} from "../src/compiler";

function analyze(source: string): LovelaceSemanticModel {
  const result = analyzeLovelace(source);
  if (!result.ok) {
    throw new Error(result.diagnostics.map(diagnostic => diagnostic.message).join("; "));
  }
  return result.value;
}

describe("Lovelace semantic analysis", () => {
  it("accepts the hello fixture with a forward top-level boot call", async () => {
    const source = await Bun.file("test/fixtures/lovelace/hello.lace").text();
    const model = analyze(source);

    expect(model.program.body.map(node => node.kind)).toEqual([
      "ExpressionStatement",
      "FunctionDeclaration",
    ]);
    expect(model.globalScope.symbols.get("boot")).toMatchObject({
      kind: "function",
      visibility: "public",
    });
  });

  it("builds global symbols for modules, imports, functions, types, constants, and builtins", () => {
    const model = analyze(`
module kernel.memory
import system.console: console
const HEAP_START = $010000
type Block = struct
    size: int
end
func boot()
    console.print("ready")
    print(len("ready"))
end
`);

    expect([...model.globalScope.symbols.keys()]).toContain("kernel.memory");
    expect(model.globalScope.symbols.get("console")).toMatchObject({ kind: "import" });
    expect(model.globalScope.symbols.get("HEAP_START")).toMatchObject({ kind: "const" });
    expect(model.globalScope.symbols.get("Block")).toMatchObject({ kind: "type" });
    expect(model.globalScope.symbols.get("boot")).toMatchObject({ kind: "function" });
    expect(model.globalScope.symbols.get("print")).toMatchObject({ kind: "builtin" });
    expect(model.globalScope.symbols.get("Error")).toMatchObject({ kind: "builtin" });
    expect(model.globalScope.symbols.get("memory")).toMatchObject({ kind: "builtin" });
  });

  it("rejects global mutable variables", () => {
    const result = analyzeLovelace("var counter = 0\n");

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "LACE3004",
        message: "Global mutable variables are not permitted.",
        stage: "semantic",
      }),
    );
  });

  it("reports duplicate symbols in the same scope", () => {
    const result = analyzeLovelace(`
func boot()
end
func boot()
end
`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "LACE3008",
      message: "Duplicate function 'boot'.",
    });
  });

  it("validates local assignments and immutable bindings", () => {
    const result = analyzeLovelace(`
func boot()
    const name = "Ada"
    name = "Grace"
end
`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "LACE3006",
        message: "Cannot assign to immutable 'name'.",
      }),
    );
  });

  it("allows assignments to mutable local variables", () => {
    expect(analyze(`
func boot()
    var counter = 0
    counter = counter + 1
end
`).globalScope.symbols.get("boot")).toMatchObject({ kind: "function" });
  });

  it("reports unknown symbols", () => {
    const result = analyzeLovelace(`
func boot()
    missing()
end
`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "LACE3005",
      message: "Unknown symbol 'missing'.",
    });
  });

  it("validates break and continue placement", () => {
    const result = analyzeLovelace(`
func boot()
    break
    continue
end
`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      "LACE3002",
      "LACE3003",
    ]);
  });

  it("allows break and continue inside loops", () => {
    const model = analyze(`
func boot()
    while running
        break
        continue
    end
end

const running = true
`);

    expect(model.globalScope.symbols.get("running")).toMatchObject({ kind: "const" });
  });

  it("reports unknown type references", () => {
    const result = analyzeLovelace(`
func alloc(): Mystery
end
`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "LACE3007",
      message: "Unknown type 'Mystery'.",
    });
  });

  it("returns source path in semantic diagnostics", () => {
    const result = analyzeLovelace("func boot()\n    missing()\nend\n", {
      sourcePath: "broken.lace",
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      sourcePath: "broken.lace",
      stage: "semantic",
      span: { start: { line: 2, column: 5 } },
    });
  });
});
