import { describe, expect, it } from "bun:test";
import { assemble } from "../src/assembler";
import {
  generateLovelaceAssembly,
  type LovelaceAssemblyOutput,
} from "../src/compiler";

function generate(source: string): LovelaceAssemblyOutput {
  const result = generateLovelaceAssembly(source);
  if (!result.ok) {
    throw new Error(result.diagnostics.map(diagnostic => diagnostic.message).join("; "));
  }
  return result.value;
}

describe("Lovelace W65C832 code generator", () => {
  it("emits a stable startup stub, initializer routine, and function labels", async () => {
    const source = await Bun.file("test/fixtures/lovelace/hello.lace").text();
    const output = generate(source);

    expect(output.entryPoint).toBe("boot");
    expect(output.assembly).toContain(".65832");
    expect(output.assembly).toContain(".a32");
    expect(output.assembly).toContain("lace_start:");
    expect(output.assembly).toContain("jsr lace_init");
    expect(output.assembly).toContain("jsr lace_fn_boot");
    expect(output.assembly).toContain("lace_fn_boot:");
  });

  it("emits assembler-friendly code for arithmetic, locals, and returns", () => {
    const output = generate(`
func boot(): int
    var total = 1 + 2
    return total
end
`);

    expect(output.assembly).toContain("adc #2.l");
    expect(output.assembly).toContain("sta lace_local_boot_total");
    expect(output.assembly).toContain("lda lace_local_boot_total");
    expect(output.assembly).toContain("rts");

    const assembled = assemble(output.assembly);
    expect(assembled.errors).toEqual([]);
    expect(assembled.bytes.length).toBeGreaterThan(0);
  });

  it("follows the Lovelace calling convention for the first argument in A", () => {
    const output = generate(`
func id(value: int): int
    return value
end

func boot(): int
    const result = id(7)
    return result
end
`);

    expect(output.assembly).toContain("lace_fn_id:");
    expect(output.assembly).toContain("; first argument arrives in A");
    expect(output.assembly).toContain("sta lace_local_id_value");
    expect(output.assembly).toContain("lda #7.l");
    expect(output.assembly).toContain("jsr lace_fn_id");

    const assembled = assemble(output.assembly);
    expect(assembled.errors).toEqual([]);
  });

  it("emits labels and branches for conditionals and loops", () => {
    const output = generate(`
func boot()
    var i = 0
    while i < 3
        i = i + 1
    end
end
`);

    expect(output.assembly).toContain("lace_label_boot_while_start");
    expect(output.assembly).toContain("beq lace_label_boot_while_end");
    expect(output.assembly).toContain("bra lace_label_boot_while_start");

    const assembled = assemble(output.assembly);
    expect(assembled.errors).toEqual([]);
  });

  it("places globals and string literals in generated storage", () => {
    const output = generate(`
const VERSION = "0.1"

func boot(): string
    return VERSION
end
`);

    expect(output.assembly).toContain("lace_global_version:");
    expect(output.assembly).toContain("lace_str_0:");
    expect(output.assembly).toContain(".asciiz \"0.1\"");
    expect(output.assembly).toContain("lda #lace_str_0.l");
    expect(output.assembly).toContain("sta lace_global_version");

    const assembled = assemble(output.assembly);
    expect(assembled.errors).toEqual([]);
  });

  it("preserves diagnostics from earlier compiler stages", () => {
    const result = generateLovelaceAssembly(`
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

  it("reports missing entry points before assembly", () => {
    const result = generateLovelaceAssembly("func boot()\nend\n", {
      entryPoint: "start",
      sourcePath: "boot.lace",
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      stage: "codegen",
      code: "LACE5001",
      sourcePath: "boot.lace",
    });
  });

  it("emits only runtime seed stubs used by the program", () => {
    const output = generate(`
func boot(): int
    print("ready")
    const length = len("ready")
    return length
end
`);

    expect(output.assembly).toContain("; Runtime seed");
    expect(output.assembly).toContain("lace_fn_print:");
    expect(output.assembly).toContain("lace_fn_len:");
    expect(output.assembly).not.toContain("lace_fn_halt:");

    const assembled = assemble(output.assembly);
    expect(assembled.errors).toEqual([]);
  });

  it("emits runtime seed stubs for memory helpers and halt", () => {
    const output = generate(`
func boot()
    const value = memory.read8($1000)
    memory.write8($1000, value)
    halt()
end
`);

    expect(output.assembly).toContain("lace_fn_memory_read8:");
    expect(output.assembly).toContain("lace_fn_memory_write8:");
    expect(output.assembly).toContain("lace_fn_halt:");

    const assembled = assemble(output.assembly);
    expect(assembled.errors).toEqual([]);
  });
});
