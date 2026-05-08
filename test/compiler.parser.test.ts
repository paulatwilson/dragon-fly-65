import { describe, expect, it } from "bun:test";
import {
  parseLovelace,
  type LovelaceFunctionDeclaration,
  type LovelaceProgram,
  type LovelaceTypeDeclaration,
  type LovelaceVariableDeclaration,
} from "../src/compiler";

function parse(source: string): LovelaceProgram {
  const result = parseLovelace(source);
  if (!result.ok) {
    throw new Error(result.diagnostics.map(diagnostic => diagnostic.message).join("; "));
  }
  return result.value;
}

describe("Lovelace parser", () => {
  it("parses the hello fixture as a top-level call followed by public boot", async () => {
    const source = await Bun.file("test/fixtures/lovelace/hello.lace").text();
    const program = parse(source);

    expect(program.body.map(node => node.kind)).toEqual([
      "ExpressionStatement",
      "FunctionDeclaration",
    ]);

    const boot = program.body[1] as LovelaceFunctionDeclaration;
    expect(boot.name).toBe("boot");
    expect(boot.visibility).toBe("public");
    expect(boot.body[0]?.kind).toBe("VariableDeclaration");
  });

  it("parses modules, imports, functions, parameters, defaults, and returns", () => {
    const program = parse(`
module kernel.memory
import system.console: console

pub func connect(host: string, port: int = 80): bool
    return open(host: host, port: port)
end
`);

    expect(program.body[0]).toMatchObject({
      kind: "ModuleDeclaration",
      name: "kernel.memory",
    });
    expect(program.body[1]).toMatchObject({
      kind: "ImportDeclaration",
      moduleName: "system.console",
      alias: "console",
    });

    const connect = program.body[2] as LovelaceFunctionDeclaration;
    expect(connect.kind).toBe("FunctionDeclaration");
    expect(connect.parameters).toHaveLength(2);
    expect(connect.parameters[1]).toMatchObject({
      name: "port",
      type: { name: "int" },
      defaultValue: { kind: "Literal", value: "80" },
    });
    expect(connect.returnType).toMatchObject({ name: "bool" });
    expect(connect.body[0]).toMatchObject({
      kind: "ReturnStatement",
      values: [{ kind: "CallExpression" }],
    });
  });

  it("parses type declarations and pointer/array type references", () => {
    const program = parse(`
pub type Block = struct
    size: int
    next: pointer<Block>
    bytes: array<byte, 256>
end
`);
    const block = program.body[0] as LovelaceTypeDeclaration;

    expect(block.kind).toBe("TypeDeclaration");
    expect(block.name).toBe("Block");
    expect(block.value.fields.map(field => field.name)).toEqual(["size", "next", "bytes"]);
    expect(block.value.fields[1]?.type).toMatchObject({
      name: "pointer",
      parameters: [{ name: "Block" }],
    });
    expect(block.value.fields[2]?.type).toMatchObject({
      name: "array",
      parameters: [{ name: "byte" }, { name: "256" }],
    });
  });

  it("parses variables, assignment expressions, calls, indexing, and struct literals", () => {
    const program = parse(`
func boot()
    var buffer: array<byte, 256>
    buffer[0] = $ff
    const p = Process { id: 1, state: RUNNING }
    print(p.state)
end
`);
    const boot = program.body[0] as LovelaceFunctionDeclaration;

    expect(boot.body.map(statement => statement.kind)).toEqual([
      "VariableDeclaration",
      "ExpressionStatement",
      "VariableDeclaration",
      "ExpressionStatement",
    ]);

    const declaration = boot.body[2] as LovelaceVariableDeclaration;
    expect(declaration.initializer).toMatchObject({
      kind: "StructLiteral",
      fields: [
        { name: "id", value: { kind: "Literal", value: "1" } },
        { name: "state", value: { kind: "Identifier", name: "RUNNING" } },
      ],
    });
  });

  it("parses if, while, for, switch, break, and continue blocks", () => {
    const program = parse(`
func loop()
    while running
        if done then
            break
        else
            continue
        end
    end

    for i: uint8 = 0 to 255
        tick(i)
    end

    for item in processList
        tick(item)
    end

    switch command
        case "quit"
            halt()
        end
        default
            print("Unknown")
        end
    end
end
`);
    const loop = program.body[0] as LovelaceFunctionDeclaration;

    expect(loop.body.map(statement => statement.kind)).toEqual([
      "WhileStatement",
      "ForStatement",
      "ForStatement",
      "SwitchStatement",
    ]);
  });

  it("parses unsafe declarations, asm blocks, and casts", () => {
    const program = parse(`
func writeHardware()
    unsafe(true)
    memory[$D000] = cast<uint8>(value)
    asm { sei lda #$00 }
end
`);
    const fn = program.body[0] as LovelaceFunctionDeclaration;

    expect(fn.body.map(statement => statement.kind)).toEqual([
      "UnsafeStatement",
      "ExpressionStatement",
      "AsmStatement",
    ]);
    expect(fn.body[2]).toMatchObject({
      kind: "AsmStatement",
      body: "sei lda # $00",
    });
  });

  it("returns parser diagnostics with line and column information", () => {
    const result = parseLovelace("func boot()\n    const = 1\nend\n", {
      sourcePath: "broken.lace",
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      severity: "error",
      stage: "parser",
      sourcePath: "broken.lace",
      span: { start: { line: 2, column: 11 } },
    });
  });
});
