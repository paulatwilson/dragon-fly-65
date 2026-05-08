import { describe, expect, it } from "bun:test";
import {
  lowerLovelaceToIr,
  type LovelaceIrModule,
} from "../src/compiler";

function lower(source: string): LovelaceIrModule {
  const result = lowerLovelaceToIr(source);
  if (!result.ok) {
    throw new Error(result.diagnostics.map(diagnostic => diagnostic.message).join("; "));
  }
  return result.value;
}

describe("Lovelace IR lowering", () => {
  it("lowers the hello fixture into an initializer call and boot function", async () => {
    const source = await Bun.file("test/fixtures/lovelace/hello.lace").text();
    const ir = lower(source);

    expect(ir.kind).toBe("IrModule");
    expect(ir.initializers).toContainEqual(
      expect.objectContaining({ op: "call", callee: "boot" }),
    );
    expect(ir.functions).toHaveLength(1);
    expect(ir.functions[0]).toMatchObject({
      name: "boot",
      visibility: "public",
      returnType: { name: "<none>" },
    });
  });

  it("lowers globals and their initializer instructions", () => {
    const ir = lower(`
const VERSION = "0.1"
const COUNT: uint16 = 42
`);

    expect(ir.globals.map(global => ({
      name: global.name,
      mutable: global.mutable,
      typeName: global.type.name,
    }))).toEqual([
      { name: "VERSION", mutable: false, typeName: "string" },
      { name: "COUNT", mutable: false, typeName: "uint16" },
    ]);
    expect(ir.initializers.map(instruction => instruction.op)).toEqual([
      "assign",
      "assign",
    ]);
  });

  it("lowers local declarations, arithmetic, assignment, calls, and returns", () => {
    const ir = lower(`
func add(a: int, b: int): int
    var total = a + b
    print(total)
    return total
end
`);
    const add = ir.functions[0]!;

    expect(add.parameters).toEqual([
      { name: "a", type: { kind: "primitive", name: "int", parameters: [] } },
      { name: "b", type: { kind: "primitive", name: "int", parameters: [] } },
    ]);
    expect(add.body.map(instruction => instruction.op)).toEqual([
      "binary",
      "declare",
      "assign",
      "call",
      "return",
    ]);
    expect(add.body).toContainEqual(
      expect.objectContaining({ op: "call", callee: "print" }),
    );
  });

  it("lowers conditionals and loops with labels and jumps", () => {
    const ir = lower(`
const running = true

func tick(): bool
    return true
end

func boot()
    while running
        if tick() then
            break
        else
            continue
        end
    end
end
`);
    const boot = ir.functions.find(fn => fn.name === "boot")!;

    expect(boot.body.some(instruction => instruction.op === "label")).toBe(true);
    expect(boot.body.some(instruction => instruction.op === "jumpIfFalse")).toBe(true);
    expect(boot.body.some(instruction => instruction.op === "jump")).toBe(true);
  });

  it("lowers counting loops into compare, increment, and back edge", () => {
    const ir = lower(`
func boot()
    for i: uint8 = 0 to 3
        print(i)
    end
end
`);
    const boot = ir.functions[0]!;

    expect(boot.body).toContainEqual(
      expect.objectContaining({ op: "binary", operator: "<=" }),
    );
    expect(boot.body).toContainEqual(
      expect.objectContaining({ op: "binary", operator: "+" }),
    );
  });

  it("lowers struct literals into field values", () => {
    const ir = lower(`
type Process = struct
    id: int
    state: int
end

func boot()
    const p = Process { id: 1, state: 2 }
end
`);
    const boot = ir.functions[0]!;

    expect(boot.body).toContainEqual(
      expect.objectContaining({
        op: "struct",
        typeName: "Process",
        fields: [
          expect.objectContaining({ name: "id" }),
          expect.objectContaining({ name: "state" }),
        ],
      }),
    );
  });

  it("preserves diagnostics from earlier compiler stages", () => {
    const result = lowerLovelaceToIr(`
func boot()
    const name: string = 1
end
`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      stage: "type-checker",
      code: "LACE4004",
    });
  });
});
