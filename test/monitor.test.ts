import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { assemble } from "../src/assembler";
import { Machine } from "../src/machine";

// Build + load the monitor, return a Machine ready to run.
function buildMonitor(): Machine {
  const src = readFileSync(resolve(__dirname, "../monitor/monitor.asm"), "utf8");
  const out = assemble(src);
  expect(out.errors).toHaveLength(0);

  const machine = new Machine();
  machine.load(out.bytes, out.origin);
  machine.setResetVector(out.origin);
  machine.reset();
  return machine;
}

// Collect all output produced while feeding `input` to the machine.
// Runs until the machine stops writing output for a full pass through the
// run loop with no new characters, or until STP.  Cap at maxSteps to
// prevent runaway loops in failing tests.
function runWithInput(machine: Machine, input: string, maxSteps = 5_000_000): string {
  const bytes = [...input].map(c => c.charCodeAt(0));
  let byteIdx = 0;

  const captured: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  // Temporarily capture stdout by replacing the write method
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = (chunk: string | Uint8Array) => {
    captured.push(typeof chunk === "string" ? chunk : String.fromCharCode(...chunk));
    return true;
  };

  try {
    let steps = 0;
    let lastOutputStep = 0;
    let inputFed = false;

    while (steps < maxSteps) {
      // Feed one input byte every ~200 steps so the monitor has time to process
      if (!inputFed && byteIdx < bytes.length && steps % 200 === 0) {
        machine.pushInput(bytes[byteIdx++]!);
        if (byteIdx >= bytes.length) inputFed = true;
      }

      const stopped = machine.step();
      if (stopped) break;
      steps++;

      // Track when output last happened
      if (captured.length > 0) {
        const lastLen = captured.join("").length;
        if (lastLen > 0) lastOutputStep = steps;
      }

      // Once all input is fed, stop after 50 000 quiet steps
      if (inputFed && steps - lastOutputStep > 50_000) break;
    }
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = originalWrite;
  }

  return captured.join("");
}

describe("monitor", () => {
  test("assembles without errors", () => {
    const src = readFileSync(resolve(__dirname, "../monitor/monitor.asm"), "utf8");
    const out = assemble(src);
    expect(out.errors).toHaveLength(0);
    expect(out.bytes.length).toBeGreaterThan(0);
  });

  test("banner printed on startup", () => {
    const machine = buildMonitor();
    // Run long enough to see the banner, then H to get to a stable state
    const output = runWithInput(machine, "H\r");
    expect(output).toContain("DragonFly 65 Monitor");
  });

  test("H command shows help text", () => {
    const machine = buildMonitor();
    const output = runWithInput(machine, "H\r");
    expect(output).toContain("MAAAA");
    expect(output).toContain("GAAAA");
    expect(output).toContain("SAAAADD");
  });

  test("unknown command shows error", () => {
    const machine = buildMonitor();
    const output = runWithInput(machine, "Z\r");
    expect(output).toContain("?");
  });

  test("S command stores bytes, M command reads them back", () => {
    const machine = buildMonitor();
    // Store 0xDE 0xAD at $0300
    const output = runWithInput(machine, "S0300DEAD\rM0300\r");
    // Verify the bytes are in machine RAM
    expect(machine.mem.readByte(0x0300)).toBe(0xde);
    expect(machine.mem.readByte(0x0301)).toBe(0xad);
    // Memory dump should show DE and AD
    expect(output).toContain("DE");
    expect(output).toContain("AD");
  });

  test("M command dumps 16 bytes with ASCII sidebar", () => {
    const machine = buildMonitor();
    // Write "Hello" starting at $0300 so we get printable chars in the dump
    const hello = [...("Hello")].map(c => c.charCodeAt(0));
    for (let i = 0; i < hello.length; i++) machine.mem.writeByte(0x0300 + i, hello[i]!);

    const output = runWithInput(machine, "M0300\r");
    // Separator pipes from the dump format
    expect(output).toContain("|");
  });

  test("G command runs code and returns to monitor", () => {
    // Assemble a tiny stub: LDA #$42, RTS  (at $0300)
    const machine = buildMonitor();
    // Manually poke the stub: LDA #$42 (A9 42), RTS (60)
    machine.mem.writeByte(0x0300, 0xa9); // LDA #imm
    machine.mem.writeByte(0x0301, 0x42);
    machine.mem.writeByte(0x0302, 0x60); // RTS

    const output = runWithInput(machine, "G0300\r");
    expect(output).toContain("Returned");
  });

  test("R command shows no-data message before any G", () => {
    const machine = buildMonitor();
    const output = runWithInput(machine, "R\r");
    expect(output).toContain("No program");
  });

  test("R command shows registers after G", () => {
    const machine = buildMonitor();
    // Stub: LDA #$42, RTS
    machine.mem.writeByte(0x0300, 0xa9);
    machine.mem.writeByte(0x0301, 0x42);
    machine.mem.writeByte(0x0302, 0x60);

    const output = runWithInput(machine, "G0300\rR\r");
    expect(output).toContain("A=");
    expect(output).toContain("X=");
    expect(output).toContain("Y=");
    expect(output).toContain("P=");
  });
});
