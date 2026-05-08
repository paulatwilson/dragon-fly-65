import { describe, expect, it } from "bun:test";
import {
  checkLovelaceTypes,
  type LovelaceTypeCheckModel,
} from "../src/compiler";

function check(source: string): LovelaceTypeCheckModel {
  const result = checkLovelaceTypes(source);
  if (!result.ok) {
    throw new Error(result.diagnostics.map(diagnostic => diagnostic.message).join("; "));
  }
  return result.value;
}

describe("Lovelace type checker", () => {
  it("accepts the hello fixture", async () => {
    const source = await Bun.file("test/fixtures/lovelace/hello.lace").text();

    expect(check(source).functions.get("boot")).toMatchObject({
      name: "boot",
      returnType: { name: "<none>" },
    });
  });

  it("infers obvious primitive types for global constants", () => {
    const model = check(`
const name = "NeedleOS"
const ready = true
const count = 42
const ratio = 0.5
`);

    expect(model.globalValues.get("name")).toMatchObject({ name: "string" });
    expect(model.globalValues.get("ready")).toMatchObject({ name: "bool" });
    expect(model.globalValues.get("count")).toMatchObject({ name: "int" });
    expect(model.globalValues.get("ratio")).toMatchObject({ name: "float32" });
  });

  it("accepts explicit integer-width initializers and casts", () => {
    const model = check(`
func boot()
    var flag: uint8 = 0
    var port = cast<uint16>($D000)
    flag = flag + 1
end
`);

    expect(model.functions.get("boot")).toMatchObject({ returnType: { name: "<none>" } });
  });

  it("rejects explicit initializer type mismatches", () => {
    const result = checkLovelaceTypes(`
func boot()
    const name: string = 1
end
`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "LACE4004",
      message: "Cannot assign 'int' to 'string'.",
      stage: "type-checker",
    });
  });

  it("rejects return type mismatches", () => {
    const result = checkLovelaceTypes(`
func add(): int
    return "nope"
end
`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "LACE4004",
      message: "Cannot assign 'string' to 'int'.",
    });
  });

  it("requires bool conditions", () => {
    const result = checkLovelaceTypes(`
func boot()
    if 1 then
        halt()
    end
end
`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "LACE4006",
      message: "Expected 'bool', got 'int'.",
    });
  });

  it("checks function call arguments", () => {
    const result = checkLovelaceTypes(`
func connect(host: string, port: int): bool
    return true
end

func boot()
    connect("localhost", "ssh")
end
`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "LACE4004",
      message: "Cannot assign 'string' to 'int'.",
    });
  });

  it("checks type-strict comparisons", () => {
    const result = checkLovelaceTypes(`
func boot()
    const ok = "1" == 1
end
`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "LACE4005",
      message: "Cannot compare 'string' with 'int'.",
    });
  });

  it("checks struct literal fields", () => {
    const result = checkLovelaceTypes(`
type Process = struct
    id: int
    state: string
end

func boot()
    const p = Process { id: "one", state: READY }
end

const READY = 1
`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain("LACE4004");
  });

  it("tracks the implicit result/error pair model for call destructuring", () => {
    const model = check(`
type Error = struct
    code: int
    description: string
end

func readFile(path: string): string
    return "data"
end

func boot()
    const data, err = readFile("/boot/config")
end
`);

    expect(model.functions.get("readFile")).toMatchObject({
      returnType: { name: "string" },
    });
  });

  it("returns source paths in type diagnostics", () => {
    const result = checkLovelaceTypes("func boot(): bool\n    return 1\nend\n", {
      sourcePath: "typed-broken.lace",
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      sourcePath: "typed-broken.lace",
      stage: "type-checker",
    });
  });
});
