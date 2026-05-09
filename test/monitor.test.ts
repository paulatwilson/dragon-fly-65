import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { assemble } from "../src/assembler";
import { bootMonitorComputer } from "../src/computer/boot";
import { Machine } from "../src/machine";

// Build + load the monitor, return a Machine ready to run.
function buildMonitor(): Machine {
  return bootMonitorComputer().machine;
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
      // Feed input gradually so the monitor has time to poll CHAR_STS.
      if (!inputFed && byteIdx < bytes.length && steps % 50 === 0) {
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

      // Once all input is fed, stop after a quiet period.
      if (inputFed && steps - lastOutputStep > 10_000) break;
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
  }, 10_000);

  test("H command shows help text", () => {
    const machine = buildMonitor();
    const output = runWithInput(machine, "H\r");
    expect(output).toContain("MAAAA");
    expect(output).toContain("GAAAA");
    expect(output).toContain("SAAAADD");
    expect(output).toContain("DAAAA");
  }, 10_000);

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

  test("A command assembles and runs a small program", () => {
    const machine = buildMonitor();
    const output = runWithInput(
      machine,
      "A0300\rlda #'H'\rsta $F000\rlda #'I'\rsta $F000\rrts\rend\rG0300\r",
    );

    expect(machine.mem.readByte(0x0300)).toBe(0xa9);
    expect(machine.mem.readByte(0x0301)).toBe("H".charCodeAt(0));
    expect(machine.mem.readByte(0x0302)).toBe(0x8d);
    expect(machine.mem.readByte(0x0303)).toBe(0x00);
    expect(machine.mem.readByte(0x0304)).toBe(0xf0);
    expect(output).toContain("HI");
    expect(output).toContain("Returned");
  });

  test("A command supports hex and decimal immediates", () => {
    const machine = buildMonitor();

    runWithInput(machine, "A0310\rsep #$20\rrep #48\rnop\rend\r");

    expect(machine.mem.readByte(0x0310)).toBe(0xe2);
    expect(machine.mem.readByte(0x0311)).toBe(0x20);
    expect(machine.mem.readByte(0x0312)).toBe(0xc2);
    expect(machine.mem.readByte(0x0313)).toBe(48);
    expect(machine.mem.readByte(0x0314)).toBe(0xea);
  });

  test("D command disassembles the native assembler subset", () => {
    const machine = buildMonitor();
    const output = runWithInput(
      machine,
      [
        "A0320",
        "lda #'A'",
        "sta $F000",
        "sep #$20",
        "rep #48",
        "nop",
        "jsr $0330",
        "jmp $0340",
        "rts",
        "end",
        "D0320",
      ].join("\r") + "\r",
    );

    expect(output).toContain("0320 A9 41 LDA #$41");
    expect(output).toContain("0322 8D 00 F0 STA $F000");
    expect(output).toContain("0325 E2 20 SEP #$20");
    expect(output).toContain("0327 C2 30 REP #$30");
    expect(output).toContain("0329 EA NOP");
    expect(output).toContain("032A 20 30 03 JSR $0330");
    expect(output).toContain("032D 4C 40 03 JMP $0340");
    expect(output).toContain("0330 60 RTS");
  }, 10_000);

  test("A and D support accumulator immediate operations", () => {
    const machine = buildMonitor();
    const output = runWithInput(
      machine,
      [
        "A0400",
        "cmp #$41",
        "and #$0F",
        "ora #'A'",
        "eor #$01",
        "adc #65",
        "sbc #$02",
        "rts",
        "end",
        "D0400",
      ].join("\r") + "\r",
    );

    expect(machine.mem.readByte(0x0400)).toBe(0xc9);
    expect(machine.mem.readByte(0x0401)).toBe(0x41);
    expect(machine.mem.readByte(0x0402)).toBe(0x29);
    expect(machine.mem.readByte(0x0403)).toBe(0x0f);
    expect(machine.mem.readByte(0x0404)).toBe(0x09);
    expect(machine.mem.readByte(0x0405)).toBe(0x41);
    expect(machine.mem.readByte(0x0406)).toBe(0x49);
    expect(machine.mem.readByte(0x0407)).toBe(0x01);
    expect(machine.mem.readByte(0x0408)).toBe(0x69);
    expect(machine.mem.readByte(0x0409)).toBe(65);
    expect(machine.mem.readByte(0x040a)).toBe(0xe9);
    expect(machine.mem.readByte(0x040b)).toBe(0x02);
    expect(output).toContain("0400 C9 41 CMP #$41");
    expect(output).toContain("0402 29 0F AND #$0F");
    expect(output).toContain("0404 09 41 ORA #$41");
    expect(output).toContain("0406 49 01 EOR #$01");
    expect(output).toContain("0408 69 41 ADC #$41");
    expect(output).toContain("040A E9 02 SBC #$02");
    expect(output).toContain("040C 60 RTS");
  }, 10_000);

  test("new accumulator immediate operations run in monitor programs", () => {
    const machine = buildMonitor();
    const output = runWithInput(
      machine,
      [
        "A0420",
        "lda #'A'",
        "and #$0F",
        "ora #$40",
        "eor #$00",
        "sta $F000",
        "cmp #'A'",
        "adc #$00",
        "sta $F000",
        "lda #$46",
        "cmp #$46",
        "sbc #$03",
        "sta $F000",
        "rts",
        "end",
        "G0420",
        "R",
      ].join("\r") + "\r",
    );

    expect(output).toContain("ABC");
    expect(output).toContain("Returned");
    expect(output).toContain("A=43");
  }, 10_000);

  test("A and D support accumulator absolute operations", () => {
    const machine = buildMonitor();
    const output = runWithInput(
      machine,
      [
        "A0440",
        "lda $0500",
        "cmp $0501",
        "and $0502",
        "ora $0503",
        "eor $0504",
        "adc $0505",
        "sbc $0506",
        "rts",
        "end",
        "D0440",
      ].join("\r") + "\r",
    );

    expect(machine.mem.readByte(0x0440)).toBe(0xad);
    expect(machine.mem.readByte(0x0441)).toBe(0x00);
    expect(machine.mem.readByte(0x0442)).toBe(0x05);
    expect(machine.mem.readByte(0x0443)).toBe(0xcd);
    expect(machine.mem.readByte(0x0446)).toBe(0x2d);
    expect(machine.mem.readByte(0x0449)).toBe(0x0d);
    expect(machine.mem.readByte(0x044c)).toBe(0x4d);
    expect(machine.mem.readByte(0x044f)).toBe(0x6d);
    expect(machine.mem.readByte(0x0452)).toBe(0xed);
    expect(output).toContain("0440 AD 00 05 LDA $0500");
    expect(output).toContain("0443 CD 01 05 CMP $0501");
    expect(output).toContain("0446 2D 02 05 AND $0502");
    expect(output).toContain("0449 0D 03 05 ORA $0503");
    expect(output).toContain("044C 4D 04 05 EOR $0504");
    expect(output).toContain("044F 6D 05 05 ADC $0505");
    expect(output).toContain("0452 ED 06 05 SBC $0506");
    expect(output).toContain("0455 60 RTS");
  }, 10_000);

  test("new accumulator absolute operations run in monitor programs", () => {
    const machine = buildMonitor();
    const output = runWithInput(
      machine,
      [
        "S0500F10F400041004603",
        "A0460",
        "lda $0500",
        "and $0501",
        "ora $0502",
        "eor $0503",
        "sta $F000",
        "cmp $0504",
        "adc $0505",
        "sta $F000",
        "lda $0506",
        "cmp $0506",
        "sbc $0507",
        "sta $F000",
        "rts",
        "end",
        "G0460",
        "R",
      ].join("\r") + "\r",
    );

    expect(output).toContain("ABC");
    expect(output).toContain("Returned");
    expect(output).toContain("A=43");
  }, 10_000);
});
