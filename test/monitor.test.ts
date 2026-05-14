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

  test("A and D support index register load and store forms", () => {
    const machine = buildMonitor();
    const output = runWithInput(
      machine,
      [
        "A0660",
        "ldx #$02",
        "ldy #$03",
        "ldx $10",
        "ldy $11",
        "ldx $10,y",
        "ldy $11,x",
        "ldx $0700",
        "ldy $0702",
        "end",
        "D0660",
        "A0680",
        "stx $12",
        "sty $13",
        "stx $12,y",
        "sty $13,x",
        "stx $0704",
        "sty $0706",
        "ldx $0700,y",
        "ldy $0702,x",
        "end",
        "D0680",
      ].join("\r") + "\r",
    );

    expect(machine.mem.readByte(0x0660)).toBe(0xa2);
    expect(machine.mem.readByte(0x0662)).toBe(0xa0);
    expect(machine.mem.readByte(0x0664)).toBe(0xa6);
    expect(machine.mem.readByte(0x0666)).toBe(0xa4);
    expect(machine.mem.readByte(0x0668)).toBe(0xb6);
    expect(machine.mem.readByte(0x066a)).toBe(0xb4);
    expect(machine.mem.readByte(0x066c)).toBe(0xae);
    expect(machine.mem.readByte(0x066f)).toBe(0xac);
    expect(output).toContain("0660 A2 02 LDX #$02");
    expect(output).toContain("0664 A6 10 LDX $10");
    expect(output).toContain("0668 B6 10 LDX $10,Y");
    expect(output).toContain("066C AE 00 07 LDX $0700");
    expect(output).toContain("0680 86 12 STX $12");
    expect(output).toContain("0684 96 12 STX $12,Y");
    expect(output).toContain("0688 8E 04 07 STX $0704");
    expect(output).toContain("068E BE 00 07 LDX $0700,Y");
  }, 15_000);

  test("new index register load and store forms run in monitor programs", () => {
    const machine = buildMonitor();
    const output = runWithInput(
      machine,
      [
        "A06A0",
        "sep #$10",
        "ldx #$41",
        "stx $10",
        "ldy #$42",
        "sty $11",
        "lda $0010",
        "sta $F000",
        "lda $0011",
        "sta $F000",
        "rep #$10",
        "rts",
        "end",
        "G06A0",
        "R",
      ].join("\r") + "\r",
    );

    expect(output).toContain("AB");
    expect(output).toContain("Returned");
    expect(output).toContain("X=0041");
    expect(output).toContain("Y=0042");
  }, 10_000);

  test("core implied and status instructions run in monitor programs", () => {
    const machine = buildMonitor();
    const output = runWithInput(
      machine,
      [
        "A06C0",
        "sep #$10",
        "lda #'A'",
        "tax",
        "inx",
        "dex",
        "txa",
        "sta $F000",
        "lda #'B'",
        "tay",
        "iny",
        "dey",
        "tya",
        "sta $F000",
        "clc",
        "sec",
        "clv",
        "cld",
        "sed",
        "cli",
        "sei",
        "rep #$10",
        "rts",
        "end",
        "G06C0",
        "R",
      ].join("\r") + "\r",
    );

    expect(output).toContain("AB");
    expect(output).toContain("Returned");
    expect(output).toContain("A=42");
    expect(output).toContain("X=0041");
    expect(output).toContain("Y=0042");
  }, 10_000);

  test("A and D support core implied and status instructions", () => {
    const machine = buildMonitor();
    const output = runWithInput(
      machine,
      [
        "A0800",
        "tax",
        "tay",
        "txa",
        "tya",
        "tsx",
        "txs",
        "inx",
        "dex",
        "iny",
        "dey",
        "clc",
        "sec",
        "cli",
        "sei",
        "clv",
        "cld",
        "sed",
        "end",
        "D0800",
        "D0808",
        "D0810",
      ].join("\r") + "\r",
    );

    expect(output).toContain("0800 AA TAX");
    expect(output).toContain("0801 A8 TAY");
    expect(output).toContain("0802 8A TXA");
    expect(output).toContain("0803 98 TYA");
    expect(output).toContain("0804 BA TSX");
    expect(output).toContain("0805 9A TXS");
    expect(output).toContain("0806 E8 INX");
    expect(output).toContain("0807 CA DEX");
    expect(output).toContain("0808 C8 INY");
    expect(output).toContain("0809 88 DEY");
    expect(output).toContain("080A 18 CLC");
    expect(output).toContain("080B 38 SEC");
    expect(output).toContain("080C 58 CLI");
    expect(output).toContain("080D 78 SEI");
    expect(output).toContain("080E B8 CLV");
    expect(output).toContain("080F D8 CLD");
    expect(output).toContain("0810 F8 SED");
  }, 15_000);

  test("native assembler and disassembler parity covers completed roadmap groups", () => {
    const machine = buildMonitor();
    const output = runWithInput(
      machine,
      [
        "A0700",
        "cmp #$41",
        "and #$0F",
        "ora #$40",
        "eor #$01",
        "adc #$02",
        "sbc #$03",
        "end",
        "D0700",
        "A0720",
        "lda $0800",
        "cmp $0801",
        "and $0802",
        "ora $0803",
        "eor $0804",
        "adc $0805",
        "sbc $0806",
        "end",
        "D0720",
        "A0750",
        "beq $0758",
        "bne $0750",
        "bcc $075A",
        "bcs $0754",
        "bmi $075C",
        "bpl $0758",
        "end",
        "D0750",
        "A0770",
        ".byte $41, 66, 'C'",
        "db $00, 68",
        "end",
        "D0770",
        "A0790",
        "start:",
        "bne later",
        "lda start",
        "later:",
        "bne start",
        "rts",
        "end",
        "D0790",
        "A07B0",
        "ldx #$02",
        "ldy #$03",
        "ldx $10",
        "ldy $11",
        "ldx $10,y",
        "ldy $11,x",
        "ldx $0800",
        "ldy $0802",
        "end",
        "D07B0",
        "A07D0",
        "stx $12",
        "sty $13",
        "stx $12,y",
        "sty $13,x",
        "stx $0804",
        "sty $0806",
        "ldx $0800,y",
        "ldy $0802,x",
        "end",
        "D07D0",
        "A07F0",
        "sta $14",
        "sta $14,x",
        "sta $0808",
        "sta $0808,x",
        "sta $0808,y",
        "end",
        "D07F0",
      ].join("\r") + "\r",
    );

    expect(output).toContain("0700 C9 41 CMP #$41");
    expect(output).toContain("0702 29 0F AND #$0F");
    expect(output).toContain("0704 09 40 ORA #$40");
    expect(output).toContain("0706 49 01 EOR #$01");
    expect(output).toContain("0708 69 02 ADC #$02");
    expect(output).toContain("070A E9 03 SBC #$03");

    expect(output).toContain("0720 AD 00 08 LDA $0800");
    expect(output).toContain("0723 CD 01 08 CMP $0801");
    expect(output).toContain("0726 2D 02 08 AND $0802");
    expect(output).toContain("0729 0D 03 08 ORA $0803");
    expect(output).toContain("072C 4D 04 08 EOR $0804");
    expect(output).toContain("072F 6D 05 08 ADC $0805");
    expect(output).toContain("0732 ED 06 08 SBC $0806");

    expect(output).toContain("0750 F0 06 BEQ $0758");
    expect(output).toContain("0752 D0 FC BNE $0750");
    expect(output).toContain("0754 90 04 BCC $075A");
    expect(output).toContain("0756 B0 FC BCS $0754");
    expect(output).toContain("0758 30 02 BMI $075C");
    expect(output).toContain("075A 10 FC BPL $0758");

    expect(output).toContain("0770 41 DB $41");
    expect(output).toContain("0771 42 DB $42");
    expect(output).toContain("0772 43 DB $43");
    expect(output).toContain("0773 00 DB $00");
    expect(output).toContain("0774 44 DB $44");

    expect(output).toContain("0790 D0 03 BNE $0795");
    expect(output).toContain("0792 AD 90 07 LDA $0790");
    expect(output).toContain("0795 D0 F9 BNE $0790");
    expect(output).toContain("0797 60 RTS");

    expect(output).toContain("07B0 A2 02 LDX #$02");
    expect(output).toContain("07B2 A0 03 LDY #$03");
    expect(output).toContain("07B4 A6 10 LDX $10");
    expect(output).toContain("07B6 A4 11 LDY $11");
    expect(output).toContain("07B8 B6 10 LDX $10,Y");
    expect(output).toContain("07BA B4 11 LDY $11,X");
    expect(output).toContain("07BC AE 00 08 LDX $0800");
    expect(output).toContain("07BF AC 02 08 LDY $0802");

    expect(output).toContain("07D0 86 12 STX $12");
    expect(output).toContain("07D2 84 13 STY $13");
    expect(output).toContain("07D4 96 12 STX $12,Y");
    expect(output).toContain("07D6 94 13 STY $13,X");
    expect(output).toContain("07D8 8E 04 08 STX $0804");
    expect(output).toContain("07DB 8C 06 08 STY $0806");
    expect(output).toContain("07DE BE 00 08 LDX $0800,Y");
    expect(output).toContain("07E1 BC 02 08 LDY $0802,X");

    expect(output).toContain("07F0 85 14 STA $14");
    expect(output).toContain("07F2 95 14 STA $14,X");
    expect(output).toContain("07F4 8D 08 08 STA $0808");
    expect(output).toContain("07F7 9D 08 08 STA $0808,X");
    expect(output).toContain("07FA 99 08 08 STA $0808,Y");
  }, 40_000);
});
