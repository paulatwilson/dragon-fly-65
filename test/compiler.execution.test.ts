import { describe, expect, it } from "bun:test";
import { assemble } from "../src/assembler";
import { compileLovelace } from "../src/compiler";
import {
  createCpu,
  createRam,
  readLong,
  RESET_VECTOR_ADDRESS,
  writeWord,
  type Ram,
  type W65C832Cpu,
} from "../src/emulator";

interface ExecutionResult {
  cpu: W65C832Cpu;
  ram: Ram;
  symbols: Map<string, number>;
}

function compileAndRun(source: string, maxSteps = 500): ExecutionResult {
  const compiled = compileLovelace(source);
  if (!compiled.ok) {
    throw new Error(compiled.diagnostics.map(diagnostic => diagnostic.message).join("; "));
  }

  const assembled = assemble(compiled.value.assembly);
  if (assembled.errors.length > 0) {
    throw new Error(assembled.errors.map(error => `line ${error.line}: ${error.message}`).join("; "));
  }

  const ram = createRam();
  for (const [offset, byte] of assembled.bytes.entries()) {
    ram.writeByte(assembled.origin + offset, byte);
  }

  const start = assembled.symbols.get("lace_start") ?? assembled.origin;
  writeWord(ram, RESET_VECTOR_ADDRESS, start);

  const cpu = createCpu({ memory: ram });
  cpu.reset();
  cpu.writeRegister("e8", true);
  cpu.writeRegister("e16", false);
  cpu.writeRegister("p", 0);

  for (let step = 0; step < maxSteps && !cpu.readRegister("stopped"); step += 1) {
    cpu.step();
  }

  if (!cpu.readRegister("stopped")) {
    throw new Error(`Compiled program did not stop within ${maxSteps} steps.`);
  }

  return { cpu, ram, symbols: assembled.symbols };
}

describe("Lovelace compiler emulator execution", () => {
  it("runs a compiled return-value program to STP", () => {
    const { cpu } = compileAndRun(`
pub func boot(): int
    return 7
end
`);

    expect(cpu.readRegister("stopped")).toBe(true);
    expect(cpu.readRegister("a")).toBe(7);
  });

  it("runs compiled function calls and preserves return values", () => {
    const { cpu } = compileAndRun(`
func id(value: int): int
    return value
end

pub func boot(): int
    const result = id(42)
    return result
end
`);

    expect(cpu.readRegister("a")).toBe(42);
  });

  it("runs compiled control flow", () => {
    const { cpu } = compileAndRun(`
pub func boot(): int
    var i = 0
    while i < 3
        i = i + 1
    end
    return i
end
`);

    expect(cpu.readRegister("a")).toBe(3);
  });

  it("writes compiled locals to emulator memory", () => {
    const { cpu, ram, symbols } = compileAndRun(`
pub func boot(): int
    var total = 1
    total = total + 2
    return total
end
`);
    const totalAddress = symbols.get("lace_local_boot_total");

    expect(totalAddress).toBeNumber();
    expect(cpu.readRegister("a")).toBe(3);
    expect(readLong(ram, totalAddress ?? 0)).toBe(3);
  });
});
