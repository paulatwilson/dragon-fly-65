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
  }, 15_000);

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

  test("A and D support branches with absolute target syntax", () => {
    const machine = buildMonitor();
    const output = runWithInput(
      machine,
      [
        "A0480",
        "beq $0488",
        "bne $0480",
        "bcc $048A",
        "bcs $0484",
        "bmi $048C",
        "bpl $0488",
        "rts",
        "end",
        "D0480",
      ].join("\r") + "\r",
    );

    expect(machine.mem.readByte(0x0480)).toBe(0xf0);
    expect(machine.mem.readByte(0x0481)).toBe(0x06);
    expect(machine.mem.readByte(0x0482)).toBe(0xd0);
    expect(machine.mem.readByte(0x0483)).toBe(0xfc);
    expect(machine.mem.readByte(0x0484)).toBe(0x90);
    expect(machine.mem.readByte(0x0485)).toBe(0x04);
    expect(machine.mem.readByte(0x0486)).toBe(0xb0);
    expect(machine.mem.readByte(0x0487)).toBe(0xfc);
    expect(machine.mem.readByte(0x0488)).toBe(0x30);
    expect(machine.mem.readByte(0x0489)).toBe(0x02);
    expect(machine.mem.readByte(0x048a)).toBe(0x10);
    expect(machine.mem.readByte(0x048b)).toBe(0xfc);
    expect(output).toContain("0480 F0 06 BEQ $0488");
    expect(output).toContain("0482 D0 FC BNE $0480");
    expect(output).toContain("0484 90 04 BCC $048A");
    expect(output).toContain("0486 B0 FC BCS $0484");
    expect(output).toContain("0488 30 02 BMI $048C");
    expect(output).toContain("048A 10 FC BPL $0488");
    expect(output).toContain("048C 60 RTS");
  }, 10_000);

  test("branch operations run in monitor programs", () => {
    const machine = buildMonitor();
    const output = runWithInput(
      machine,
      [
        "A04A0",
        "lda #0",
        "cmp #0",
        "beq $04AB",
        "lda #'X'",
        "sta $F000",
        "bcs $04B2",
        "lda #'X'",
        "sta $F000",
        "bpl $04B9",
        "lda #'X'",
        "sta $F000",
        "lda #1",
        "cmp #2",
        "bne $04C4",
        "lda #'X'",
        "sta $F000",
        "bcc $04CB",
        "lda #'X'",
        "sta $F000",
        "bmi $04D2",
        "lda #'X'",
        "sta $F000",
        "lda #'B'",
        "sta $F000",
        "lda #'R'",
        "sta $F000",
        "rts",
        "end",
        "G04A0",
        "R",
      ].join("\r") + "\r",
    );

    expect(output).toContain("BR");
    expect(output).not.toContain("XBR");
    expect(output).toContain("Returned");
    expect(output).toContain("A=52");
  }, 10_000);

  test("A command supports byte data entry", () => {
    const machine = buildMonitor();
    const output = runWithInput(
      machine,
      [
        "A0500",
        ".byte $41, 66, 'C'",
        "db $00, 68",
        "end",
        "M0500",
        "D0500",
      ].join("\r") + "\r",
    );

    expect(machine.mem.readByte(0x0500)).toBe(0x41);
    expect(machine.mem.readByte(0x0501)).toBe(66);
    expect(machine.mem.readByte(0x0502)).toBe("C".charCodeAt(0));
    expect(machine.mem.readByte(0x0503)).toBe(0x00);
    expect(machine.mem.readByte(0x0504)).toBe(68);
    expect(output).toContain("0500: 41 42 43 00 44");
    expect(output).toContain("|ABC.D");
    expect(output).toContain("0500 41 DB $41");
    expect(output).toContain("0501 42 DB $42");
    expect(output).toContain("0502 43 DB $43");
    expect(output).toContain("0503 00 DB $00");
    expect(output).toContain("0504 44 DB $44");
  }, 10_000);

  test("byte data emitted by A can be used by monitor programs", () => {
    const machine = buildMonitor();
    const output = runWithInput(
      machine,
      [
        "A0520",
        ".byte 'D', $41, 84, $41",
        "end",
        "A0530",
        "lda $0520",
        "sta $F000",
        "lda $0521",
        "sta $F000",
        "lda $0522",
        "sta $F000",
        "lda $0523",
        "sta $F000",
        "rts",
        "end",
        "G0530",
        "R",
      ].join("\r") + "\r",
    );

    expect(output).toContain("DATA");
    expect(output).toContain("Returned");
    expect(output).toContain("A=41");
  }, 10_000);

  test("A command supports backward labels for branch targets", () => {
    const machine = buildMonitor();
    const output = runWithInput(
      machine,
      [
        "A0600",
        "loop:",
        "lda #0",
        "cmp #0",
        "bne loop",
        "rts",
        "end",
        "D0600",
        "G0600",
      ].join("\r") + "\r",
    );

    expect(machine.mem.readByte(0x0600)).toBe(0xa9);
    expect(machine.mem.readByte(0x0601)).toBe(0x00);
    expect(machine.mem.readByte(0x0602)).toBe(0xc9);
    expect(machine.mem.readByte(0x0603)).toBe(0x00);
    expect(machine.mem.readByte(0x0604)).toBe(0xd0);
    expect(machine.mem.readByte(0x0605)).toBe(0xfa);
    expect(machine.mem.readByte(0x0606)).toBe(0x60);
    expect(output).toContain("0604 D0 FA BNE $0600");
    expect(output).toContain("Returned");
  }, 10_000);

  test("A command supports forward labels with fixups", () => {
    const machine = buildMonitor();
    const output = runWithInput(
      machine,
      [
        "A0620",
        "bne later",
        "lda later",
        "later:",
        "rts",
        "end",
        "D0620",
      ].join("\r") + "\r",
    );

    expect(machine.mem.readByte(0x0620)).toBe(0xd0);
    expect(machine.mem.readByte(0x0621)).toBe(0x03);
    expect(machine.mem.readByte(0x0622)).toBe(0xad);
    expect(machine.mem.readByte(0x0623)).toBe(0x25);
    expect(machine.mem.readByte(0x0624)).toBe(0x06);
    expect(machine.mem.readByte(0x0625)).toBe(0x60);
    expect(output).toContain("0620 D0 03 BNE $0625");
    expect(output).toContain("0622 AD 25 06 LDA $0625");
    expect(output).toContain("OK");
    expect(output).not.toContain("?");
  }, 10_000);

  test("A command rejects unresolved forward labels on end", () => {
    const machine = buildMonitor();
    const output = runWithInput(
      machine,
      [
        "A0640",
        "bne missing",
        "end",
      ].join("\r") + "\r",
    );

    expect(machine.mem.readByte(0x0640)).toBe(0xd0);
    expect(machine.mem.readByte(0x0641)).toBe(0x00);
    expect(output).toContain("?");
    expect(output).not.toContain("OK");
  }, 10_000);
});
