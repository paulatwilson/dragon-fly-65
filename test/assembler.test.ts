import { describe, expect, it } from "bun:test";
import { assemble } from "../src/assembler";

function asm(source: string): number[] {
  const result = assemble(source);
  if (result.errors.length > 0) {
    throw new Error(result.errors.map(e => `line ${e.line}: ${e.message}`).join("; "));
  }
  return Array.from(result.bytes);
}

function asmErrors(source: string): string[] {
  return assemble(source).errors.map(e => e.message);
}

// ─── Implied instructions ─────────────────────────────────────────────────────

describe("implied instructions", () => {
  it("nop", () => expect(asm("nop")).toEqual([0xea]));
  it("clc", () => expect(asm("clc")).toEqual([0x18]));
  it("sec", () => expect(asm("sec")).toEqual([0x38]));
  it("stp", () => expect(asm("stp")).toEqual([0xdb]));
  it("xce", () => expect(asm("xce")).toEqual([0xfb]));
  it("tax", () => expect(asm("tax")).toEqual([0xaa]));
  it("txa", () => expect(asm("txa")).toEqual([0x8a]));
  it("tay", () => expect(asm("tay")).toEqual([0xa8]));
  it("tya", () => expect(asm("tya")).toEqual([0x98]));
  it("tsx", () => expect(asm("tsx")).toEqual([0xba]));
  it("txs", () => expect(asm("txs")).toEqual([0x9a]));
  it("txy", () => expect(asm("txy")).toEqual([0x9b]));
  it("tyx", () => expect(asm("tyx")).toEqual([0xbb]));
  it("tcd", () => expect(asm("tcd")).toEqual([0x5b]));
  it("tdc", () => expect(asm("tdc")).toEqual([0x7b]));
  it("tcs", () => expect(asm("tcs")).toEqual([0x1b]));
  it("tsc", () => expect(asm("tsc")).toEqual([0x3b]));
  it("rti", () => expect(asm("rti")).toEqual([0x40]));
  it("rts", () => expect(asm("rts")).toEqual([0x60]));
  it("rtl", () => expect(asm("rtl")).toEqual([0x6b]));
  it("xba", () => expect(asm("xba")).toEqual([0xeb]));
  it("wai", () => expect(asm("wai")).toEqual([0xcb]));
  it("phd", () => expect(asm("phd")).toEqual([0x0b]));
  it("pld", () => expect(asm("pld")).toEqual([0x2b]));
  it("phb", () => expect(asm("phb")).toEqual([0x8b]));
  it("plb", () => expect(asm("plb")).toEqual([0xab]));
  it("phk", () => expect(asm("phk")).toEqual([0x4b]));
  it("pha", () => expect(asm("pha")).toEqual([0x48]));
  it("pla", () => expect(asm("pla")).toEqual([0x68]));
  it("phx", () => expect(asm("phx")).toEqual([0xda]));
  it("plx", () => expect(asm("plx")).toEqual([0xfa]));
  it("phy", () => expect(asm("phy")).toEqual([0x5a]));
  it("ply", () => expect(asm("ply")).toEqual([0x7a]));
  it("php", () => expect(asm("php")).toEqual([0x08]));
  it("plp", () => expect(asm("plp")).toEqual([0x28]));
  it("inx", () => expect(asm("inx")).toEqual([0xe8]));
  it("dex", () => expect(asm("dex")).toEqual([0xca]));
  it("iny", () => expect(asm("iny")).toEqual([0xc8]));
  it("dey", () => expect(asm("dey")).toEqual([0x88]));
});

// ─── Immediate instructions ───────────────────────────────────────────────────

describe("immediate instructions (8-bit default)", () => {
  it("lda #$42", () => expect(asm("lda #$42")).toEqual([0xa9, 0x42]));
  it("ldx #$ff", () => expect(asm("ldx #$ff")).toEqual([0xa2, 0xff]));
  it("ldy #$10", () => expect(asm("ldy #$10")).toEqual([0xa0, 0x10]));
  it("adc #1",   () => expect(asm("adc #1")).toEqual([0x69, 0x01]));
  it("sbc #$80", () => expect(asm("sbc #$80")).toEqual([0xe9, 0x80]));
  it("and #0xff",() => expect(asm("and #0xff")).toEqual([0x29, 0xff]));
  it("ora #%10000001", () => expect(asm("ora #%10000001")).toEqual([0x09, 0x81]));
  it("cmp #0",   () => expect(asm("cmp #0")).toEqual([0xc9, 0x00]));
});

describe("immediate instructions (16-bit after .a16)", () => {
  it("lda #$1234 after .a16", () => {
    expect(asm(".a16\nlda #$1234")).toEqual([0xa9, 0x34, 0x12]);
  });
  it("ldx #$5678 after .i16", () => {
    expect(asm(".i16\nldx #$5678")).toEqual([0xa2, 0x78, 0x56]);
  });
  it("cmp #$8000 after .a16", () => {
    expect(asm(".a16\ncmp #$8000")).toEqual([0xc9, 0x00, 0x80]);
  });
});

describe("fixed-8-bit immediate (REP/SEP)", () => {
  it("rep #$30", () => expect(asm("rep #$30")).toEqual([0xc2, 0x30]));
  it("sep #$30", () => expect(asm("sep #$30")).toEqual([0xe2, 0x30]));
  it("cop #$00", () => expect(asm("cop #$00")).toEqual([0x02, 0x00]));
});

// ─── Direct page ─────────────────────────────────────────────────────────────

describe("direct page", () => {
  it("lda $10",   () => expect(asm("lda $10")).toEqual([0xa5, 0x10]));
  it("sta $20",   () => expect(asm("sta $20")).toEqual([0x85, 0x20]));
  it("ldx $30",   () => expect(asm("ldx $30")).toEqual([0xa6, 0x30]));
  it("ldy $40",   () => expect(asm("ldy $40")).toEqual([0xa4, 0x40]));
  it("inc $50",   () => expect(asm("inc $50")).toEqual([0xe6, 0x50]));
  it("dec $60",   () => expect(asm("dec $60")).toEqual([0xc6, 0x60]));
  it("asl $70",   () => expect(asm("asl $70")).toEqual([0x06, 0x70]));
  it("lsr $80",   () => expect(asm("lsr $80")).toEqual([0x46, 0x80]));
  it("rol $90",   () => expect(asm("rol $90")).toEqual([0x26, 0x90]));
  it("ror $a0",   () => expect(asm("ror $a0")).toEqual([0x66, 0xa0]));
});

// ─── Direct page indexed ──────────────────────────────────────────────────────

describe("direct page indexed", () => {
  it("lda $10,x", () => expect(asm("lda $10,x")).toEqual([0xb5, 0x10]));
  it("sta $20,x", () => expect(asm("sta $20,x")).toEqual([0x95, 0x20]));
  it("ldx $30,y", () => expect(asm("ldx $30,y")).toEqual([0xb6, 0x30]));
  it("ldy $40,x", () => expect(asm("ldy $40,x")).toEqual([0xb4, 0x40]));
  it("asl $50,x", () => expect(asm("asl $50,x")).toEqual([0x16, 0x50]));
});

// ─── Absolute ─────────────────────────────────────────────────────────────────

describe("absolute", () => {
  it("lda $1000",  () => expect(asm("lda $1000")).toEqual([0xad, 0x00, 0x10]));
  it("sta $2000",  () => expect(asm("sta $2000")).toEqual([0x8d, 0x00, 0x20]));
  it("jmp $4c00",  () => expect(asm("jmp $4c00")).toEqual([0x4c, 0x00, 0x4c]));
  it("jsr $ffd2",  () => expect(asm("jsr $ffd2")).toEqual([0x20, 0xd2, 0xff]));
  it("bit $2000",  () => expect(asm("bit $2000")).toEqual([0x2c, 0x00, 0x20]));
  it("inc $3000",  () => expect(asm("inc $3000")).toEqual([0xee, 0x00, 0x30]));
});

// ─── Absolute indexed ─────────────────────────────────────────────────────────

describe("absolute indexed", () => {
  it("lda $1000,x", () => expect(asm("lda $1000,x")).toEqual([0xbd, 0x00, 0x10]));
  it("sta $2000,y", () => expect(asm("sta $2000,y")).toEqual([0x99, 0x00, 0x20]));
  it("asl $3000,x", () => expect(asm("asl $3000,x")).toEqual([0x1e, 0x00, 0x30]));
});

// ─── Long absolute ────────────────────────────────────────────────────────────

describe("long absolute", () => {
  it("lda $010000", () => expect(asm("lda $010000")).toEqual([0xaf, 0x00, 0x00, 0x01]));
  it("sta $ff0000", () => expect(asm("sta $ff0000")).toEqual([0x8f, 0x00, 0x00, 0xff]));
  it("lda $010000,x", () => expect(asm("lda $010000,x")).toEqual([0xbf, 0x00, 0x00, 0x01]));
  it("jmp $010000 (JML)", () => expect(asm("jmp $010000")).toEqual([0x5c, 0x00, 0x00, 0x01]));
});

// ─── Indirect ────────────────────────────────────────────────────────────────

describe("indirect", () => {
  it("lda ($10)",    () => expect(asm("lda ($10)")).toEqual([0xb2, 0x10]));
  it("sta ($20)",    () => expect(asm("sta ($20)")).toEqual([0x92, 0x20]));
  it("lda ($10,x)",  () => expect(asm("lda ($10,x)")).toEqual([0xa1, 0x10]));
  it("lda ($10),y",  () => expect(asm("lda ($10),y")).toEqual([0xb1, 0x10]));
  it("lda [$10]",    () => expect(asm("lda [$10]")).toEqual([0xa7, 0x10]));
  it("lda [$10],y",  () => expect(asm("lda [$10],y")).toEqual([0xb7, 0x10]));
  it("jmp ($1000)",  () => expect(asm("jmp ($1000)")).toEqual([0x6c, 0x00, 0x10]));
  it("jmp ($1000,x)", () => expect(asm("jmp ($1000,x)")).toEqual([0x7c, 0x00, 0x10]));
  it("jmp [$1000]",  () => expect(asm("jmp [$1000]")).toEqual([0xdc, 0x00, 0x10]));
  it("pei ($10)",    () => expect(asm("pei ($10)")).toEqual([0xd4, 0x10]));
});

// ─── Stack relative ───────────────────────────────────────────────────────────

describe("stack relative", () => {
  it("lda $10,s",    () => expect(asm("lda $10,s")).toEqual([0xa3, 0x10]));
  it("sta $20,s",    () => expect(asm("sta $20,s")).toEqual([0x83, 0x20]));
  it("lda ($10,s),y", () => expect(asm("lda ($10,s),y")).toEqual([0xb3, 0x10]));
});

// ─── Accumulator form ─────────────────────────────────────────────────────────

describe("accumulator form", () => {
  it("asl (no operand)", () => expect(asm("asl")).toEqual([0x0a]));
  it("lsr",              () => expect(asm("lsr")).toEqual([0x4a]));
  it("rol",              () => expect(asm("rol")).toEqual([0x2a]));
  it("ror",              () => expect(asm("ror")).toEqual([0x6a]));
  it("inc",              () => expect(asm("inc")).toEqual([0x1a]));
  it("dec",              () => expect(asm("dec")).toEqual([0x3a]));
});

// ─── Branches ────────────────────────────────────────────────────────────────

describe("relative branches (forward)", () => {
  it("bra forward (+2 offset)", () => {
    // bra to target 2 bytes ahead of pc-after-instruction
    // instruction is at 0, size=2, target=4 → offset=4-2=2
    const bytes = asm("bra target\nnop\nnop\ntarget: nop");
    expect(bytes[0]).toBe(0x80); // bra
    expect(bytes[1]).toBe(2);    // offset +2
  });

  it("bne backward (-4 offset)", () => {
    // loop:nop=0, nop=1, bne loop=2..3; instrEnd=4; offset=0-4=-4=0xfc
    const bytes = asm("loop: nop\nnop\nbne loop");
    expect(bytes[2]).toBe(0xd0); // bne
    expect(bytes[3]).toBe(0xfc); // -4 = 0xfc unsigned
  });

  it("beq", () => expect(asm(".org $1000\nbeq $1002")).toEqual([0xf0, 0x00]));
  it("bcc", () => expect(asm(".org $1000\nbcc $1005")).toEqual([0x90, 0x03]));
  it("bcs", () => expect(asm(".org $1000\nbcs $0fff")).toEqual([0xb0, 0xfd]));
});

// ─── Block move ───────────────────────────────────────────────────────────────

describe("block move", () => {
  it("mvn $01,$00", () => expect(asm("mvn $01,$00")).toEqual([0x54, 0x00, 0x01]));
  it("mvp $00,$01", () => expect(asm("mvp $00,$01")).toEqual([0x44, 0x01, 0x00]));
});

// ─── Special instructions ─────────────────────────────────────────────────────

describe("special instructions", () => {
  it("brk", () => expect(asm("brk")).toEqual([0x00]));
  it("pea $1234", () => expect(asm("pea $1234")).toEqual([0xf4, 0x34, 0x12]));
  it("per label", () => {
    // PER: relative long — encodes offset to label
    // at $1000, per $1003 → offset = $1003-($1000+3) = 0
    const bytes = asm(".org $1000\nper $1003");
    expect(bytes[0]).toBe(0x62); // per
    expect(bytes[1]).toBe(0x00);
    expect(bytes[2]).toBe(0x00);
  });
  it("wdm #$42", () => expect(asm("wdm #$42")).toEqual([0x42, 0x42]));
});

// ─── Labels and symbols ───────────────────────────────────────────────────────

describe("labels and symbols", () => {
  it("label is assigned to current pc", () => {
    const result = assemble("nop\nfoo: nop");
    expect(result.symbols.get("foo")).toBe(1);
  });

  it(".equ symbol definition", () => {
    const result = assemble("DELAY .equ $1000\nlda DELAY");
    expect(result.errors).toHaveLength(0);
    expect(Array.from(result.bytes)).toEqual([0xad, 0x00, 0x10]);
  });

  it("forward label in branch", () => {
    const result = assemble("bra done\nnop\ndone: stp");
    expect(result.errors).toHaveLength(0);
    expect(result.bytes[0]).toBe(0x80); // bra
    expect(result.bytes[1]).toBe(0x01); // offset +1 (skip nop)
  });

  it("label reference in lda", () => {
    const result = assemble("DATA .equ $2000\nlda DATA");
    expect(result.errors).toHaveLength(0);
    expect(Array.from(result.bytes)).toEqual([0xad, 0x00, 0x20]);
  });
});

// ─── Origin directive ─────────────────────────────────────────────────────────

describe(".org directive", () => {
  it("sets origin", () => {
    const result = assemble(".org $8000\nnop");
    expect(result.origin).toBe(0x8000);
    expect(Array.from(result.bytes)).toEqual([0xea]);
  });

  it("affects label addresses", () => {
    const result = assemble(".org $8000\nfoo: nop");
    expect(result.symbols.get("foo")).toBe(0x8000);
  });
});

// ─── Data directives ─────────────────────────────────────────────────────────

describe("data directives", () => {
  it(".db emits bytes", () => {
    expect(asm(".db $01,$02,$03")).toEqual([0x01, 0x02, 0x03]);
  });

  it(".dw emits 16-bit little-endian words", () => {
    expect(asm(".dw $1234")).toEqual([0x34, 0x12]);
  });

  it(".dl emits 24-bit little-endian longs", () => {
    expect(asm(".dl $123456")).toEqual([0x56, 0x34, 0x12]);
  });

  it(".ascii emits string bytes", () => {
    expect(asm('.ascii "Hi"')).toEqual([0x48, 0x69]);
  });

  it(".asciiz emits string with NUL", () => {
    expect(asm('.asciiz "Hi"')).toEqual([0x48, 0x69, 0x00]);
  });

  it(".resb emits zero bytes", () => {
    expect(asm(".resb 3")).toEqual([0x00, 0x00, 0x00]);
  });

  it(".db with string inline", () => {
    expect(asm('.db "AB"')).toEqual([0x41, 0x42]);
  });
});

// ─── Address force modifiers ──────────────────────────────────────────────────

describe("address force modifiers", () => {
  it("< forces direct page on abs-range value", () => {
    // Without <, $1000 → abs. With <$1000 → dp (only low byte used)
    expect(asm("lda <$1000")).toEqual([0xa5, 0x00]);
  });

  it("! forces absolute", () => {
    // $10 normally → dp, !$10 → abs
    expect(asm("lda !$10")).toEqual([0xad, 0x10, 0x00]);
  });

  it("> forces long", () => {
    expect(asm("lda >$1000")).toEqual([0xaf, 0x00, 0x10, 0x00]);
  });
});

// ─── JSR/JMP long forms ───────────────────────────────────────────────────────

describe("long jsr/jmp", () => {
  it("jsr $010000 → JSL", () => {
    expect(asm("jsr $010000")).toEqual([0x22, 0x00, 0x00, 0x01]);
  });

  it("jsl alias", () => {
    expect(asm("jsl $010000")).toEqual([0x22, 0x00, 0x00, 0x01]);
  });

  it("jml alias long", () => {
    expect(asm("jml $010000")).toEqual([0x5c, 0x00, 0x00, 0x01]);
  });
});

// ─── Multi-instruction programs ───────────────────────────────────────────────

describe("multi-instruction programs", () => {
  it("simple load-store-halt", () => {
    expect(asm("lda #$42\nsta $10\nstp")).toEqual([0xa9, 0x42, 0x85, 0x10, 0xdb]);
  });

  it("compare and branch", () => {
    const bytes = asm("lda #5\ncmp #5\nbeq equal\nnop\nequal: stp");
    expect(bytes[0]).toBe(0xa9); // lda
    expect(bytes[2]).toBe(0xc9); // cmp
    expect(bytes[4]).toBe(0xf0); // beq
    expect(bytes[5]).toBe(0x01); // offset=+1 (skip nop)
    expect(bytes[6]).toBe(0xea); // nop
    expect(bytes[7]).toBe(0xdb); // stp
  });

  it("subroutine call and return", () => {
    const bytes = asm(
      ".org $1000\n" +
      "jsr sub\n" +
      "stp\n" +
      "sub: lda #$ff\n" +
      "rts\n"
    );
    // jsr sub: sub is at $1000+3(jsr)+1(stp) = $1004
    expect(bytes[0]).toBe(0x20);
    expect(bytes[1]).toBe(0x04); // low byte of $1004
    expect(bytes[2]).toBe(0x10); // high byte of $1004
    // stp
    expect(bytes[3]).toBe(0xdb);
    // sub: lda #$ff
    expect(bytes[4]).toBe(0xa9);
    expect(bytes[5]).toBe(0xff);
    // rts
    expect(bytes[6]).toBe(0x60);
  });

  it("REP auto-tracks acc width for subsequent lda", () => {
    // After rep #$20 the assembler knows acc is 16-bit
    const bytes = asm("rep #$20\nlda #$1234");
    expect(bytes).toEqual([0xc2, 0x20, 0xa9, 0x34, 0x12]);
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────

describe("error handling", () => {
  it("unknown mnemonic produces error", () => {
    const errors = asmErrors("xyz");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("branch out of range produces error", () => {
    // Build a branch that's too far
    const src = ".org $1000\nbra $1200"; // 0x200 - 2 = 510 > 127
    const errors = asmErrors(src);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("range");
  });

  it("output has zero errors for valid program", () => {
    const result = assemble("nop\nnop\nstp");
    expect(result.errors).toHaveLength(0);
  });
});

// ─── Public API smoke test ────────────────────────────────────────────────────

describe("AssemblerOutput", () => {
  it("has bytes, origin, symbols, errors fields", () => {
    const result = assemble(".org $8000\nfoo: nop\nbar: stp");
    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(result.origin).toBe(0x8000);
    expect(result.symbols.get("foo")).toBe(0x8000);
    expect(result.symbols.get("bar")).toBe(0x8001);
    expect(result.errors).toBeInstanceOf(Array);
  });
});
