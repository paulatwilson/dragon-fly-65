/**
 * W65C816/W65C832 opcode encoding table.
 * Derived from Michael Kohn's naken_asm (GPL-3.0):
 *   https://github.com/mikeakohn/naken_asm
 *   table/65816.cpp — Copyright 2010-2023 Michael Kohn, Joe Davisson
 */

import type { AsmMode, ImmKind } from "./types";

// [opcode, mnemonic, mode] for all 256 W65C816 opcodes
const RAW: [number, string, AsmMode][] = [
  [0x00, "brk", "imm8"],
  [0x01, "ora", "(dp,x)"],
  [0x02, "cop", "imm8"],
  [0x03, "ora", "sr"],
  [0x04, "tsb", "dp"],
  [0x05, "ora", "dp"],
  [0x06, "asl", "dp"],
  [0x07, "ora", "[dp]"],
  [0x08, "php", "implied"],
  [0x09, "ora", "imm"],
  [0x0a, "asl", "implied"],
  [0x0b, "phd", "implied"],
  [0x0c, "tsb", "abs"],
  [0x0d, "ora", "abs"],
  [0x0e, "asl", "abs"],
  [0x0f, "ora", "long"],

  [0x10, "bpl", "rel8"],
  [0x11, "ora", "(dp),y"],
  [0x12, "ora", "(dp)"],
  [0x13, "ora", "(sr),y"],
  [0x14, "trb", "dp"],
  [0x15, "ora", "dp,x"],
  [0x16, "asl", "dp,x"],
  [0x17, "ora", "[dp],y"],
  [0x18, "clc", "implied"],
  [0x19, "ora", "abs,y"],
  [0x1a, "inc", "implied"],
  [0x1b, "tcs", "implied"],
  [0x1c, "trb", "abs"],
  [0x1d, "ora", "abs,x"],
  [0x1e, "asl", "abs,x"],
  [0x1f, "ora", "long,x"],

  [0x20, "jsr", "abs"],
  [0x21, "and", "(dp,x)"],
  [0x22, "jsr", "long"],
  [0x23, "and", "sr"],
  [0x24, "bit", "dp"],
  [0x25, "and", "dp"],
  [0x26, "rol", "dp"],
  [0x27, "and", "[dp]"],
  [0x28, "plp", "implied"],
  [0x29, "and", "imm"],
  [0x2a, "rol", "implied"],
  [0x2b, "pld", "implied"],
  [0x2c, "bit", "abs"],
  [0x2d, "and", "abs"],
  [0x2e, "rol", "abs"],
  [0x2f, "and", "long"],

  [0x30, "bmi", "rel8"],
  [0x31, "and", "(dp),y"],
  [0x32, "and", "(dp)"],
  [0x33, "and", "(sr),y"],
  [0x34, "bit", "dp,x"],
  [0x35, "and", "dp,x"],
  [0x36, "rol", "dp,x"],
  [0x37, "and", "[dp],y"],
  [0x38, "sec", "implied"],
  [0x39, "and", "abs,y"],
  [0x3a, "dec", "implied"],
  [0x3b, "tsc", "implied"],
  [0x3c, "bit", "abs,x"],
  [0x3d, "and", "abs,x"],
  [0x3e, "rol", "abs,x"],
  [0x3f, "and", "long,x"],

  [0x40, "rti", "implied"],
  [0x41, "eor", "(dp,x)"],
  [0x42, "wdm", "imm8"],
  [0x43, "eor", "sr"],
  [0x44, "mvp", "block"],
  [0x45, "eor", "dp"],
  [0x46, "lsr", "dp"],
  [0x47, "eor", "[dp]"],
  [0x48, "pha", "implied"],
  [0x49, "eor", "imm"],
  [0x4a, "lsr", "implied"],
  [0x4b, "phk", "implied"],
  [0x4c, "jmp", "abs"],
  [0x4d, "eor", "abs"],
  [0x4e, "lsr", "abs"],
  [0x4f, "eor", "long"],

  [0x50, "bvc", "rel8"],
  [0x51, "eor", "(dp),y"],
  [0x52, "eor", "(dp)"],
  [0x53, "eor", "(sr),y"],
  [0x54, "mvn", "block"],
  [0x55, "eor", "dp,x"],
  [0x56, "lsr", "dp,x"],
  [0x57, "eor", "[dp],y"],
  [0x58, "cli", "implied"],
  [0x59, "eor", "abs,y"],
  [0x5a, "phy", "implied"],
  [0x5b, "tcd", "implied"],
  [0x5c, "jmp", "long"],
  [0x5d, "eor", "abs,x"],
  [0x5e, "lsr", "abs,x"],
  [0x5f, "eor", "long,x"],

  [0x60, "rts", "implied"],
  [0x61, "adc", "(dp,x)"],
  [0x62, "per", "rel16"],
  [0x63, "adc", "sr"],
  [0x64, "stz", "dp"],
  [0x65, "adc", "dp"],
  [0x66, "ror", "dp"],
  [0x67, "adc", "[dp]"],
  [0x68, "pla", "implied"],
  [0x69, "adc", "imm"],
  [0x6a, "ror", "implied"],
  [0x6b, "rtl", "implied"],
  [0x6c, "jmp", "(abs)"],
  [0x6d, "adc", "abs"],
  [0x6e, "ror", "abs"],
  [0x6f, "adc", "long"],

  [0x70, "bvs", "rel8"],
  [0x71, "adc", "(dp),y"],
  [0x72, "adc", "(dp)"],
  [0x73, "adc", "(sr),y"],
  [0x74, "stz", "dp,x"],
  [0x75, "adc", "dp,x"],
  [0x76, "ror", "dp,x"],
  [0x77, "adc", "[dp],y"],
  [0x78, "sei", "implied"],
  [0x79, "adc", "abs,y"],
  [0x7a, "ply", "implied"],
  [0x7b, "tdc", "implied"],
  [0x7c, "jmp", "(abs,x)"],
  [0x7d, "adc", "abs,x"],
  [0x7e, "ror", "abs,x"],
  [0x7f, "adc", "long,x"],

  [0x80, "bra", "rel8"],
  [0x81, "sta", "(dp,x)"],
  [0x82, "brl", "rel16"],
  [0x83, "sta", "sr"],
  [0x84, "sty", "dp"],
  [0x85, "sta", "dp"],
  [0x86, "stx", "dp"],
  [0x87, "sta", "[dp]"],
  [0x88, "dey", "implied"],
  [0x89, "bit", "imm"],
  [0x8a, "txa", "implied"],
  [0x8b, "phb", "implied"],
  [0x8c, "sty", "abs"],
  [0x8d, "sta", "abs"],
  [0x8e, "stx", "abs"],
  [0x8f, "sta", "long"],

  [0x90, "bcc", "rel8"],
  [0x91, "sta", "(dp),y"],
  [0x92, "sta", "(dp)"],
  [0x93, "sta", "(sr),y"],
  [0x94, "sty", "dp,x"],
  [0x95, "sta", "dp,x"],
  [0x96, "stx", "dp,y"],
  [0x97, "sta", "[dp],y"],
  [0x98, "tya", "implied"],
  [0x99, "sta", "abs,y"],
  [0x9a, "txs", "implied"],
  [0x9b, "txy", "implied"],
  [0x9c, "stz", "abs"],
  [0x9d, "sta", "abs,x"],
  [0x9e, "stz", "abs,x"],
  [0x9f, "sta", "long,x"],

  [0xa0, "ldy", "imm"],
  [0xa1, "lda", "(dp,x)"],
  [0xa2, "ldx", "imm"],
  [0xa3, "lda", "sr"],
  [0xa4, "ldy", "dp"],
  [0xa5, "lda", "dp"],
  [0xa6, "ldx", "dp"],
  [0xa7, "lda", "[dp]"],
  [0xa8, "tay", "implied"],
  [0xa9, "lda", "imm"],
  [0xaa, "tax", "implied"],
  [0xab, "plb", "implied"],
  [0xac, "ldy", "abs"],
  [0xad, "lda", "abs"],
  [0xae, "ldx", "abs"],
  [0xaf, "lda", "long"],

  [0xb0, "bcs", "rel8"],
  [0xb1, "lda", "(dp),y"],
  [0xb2, "lda", "(dp)"],
  [0xb3, "lda", "(sr),y"],
  [0xb4, "ldy", "dp,x"],
  [0xb5, "lda", "dp,x"],
  [0xb6, "ldx", "dp,y"],
  [0xb7, "lda", "[dp],y"],
  [0xb8, "clv", "implied"],
  [0xb9, "lda", "abs,y"],
  [0xba, "tsx", "implied"],
  [0xbb, "tyx", "implied"],
  [0xbc, "ldy", "abs,x"],
  [0xbd, "lda", "abs,x"],
  [0xbe, "ldx", "abs,y"],
  [0xbf, "lda", "long,x"],

  [0xc0, "cpy", "imm"],
  [0xc1, "cmp", "(dp,x)"],
  [0xc2, "rep", "imm8"],
  [0xc3, "cmp", "sr"],
  [0xc4, "cpy", "dp"],
  [0xc5, "cmp", "dp"],
  [0xc6, "dec", "dp"],
  [0xc7, "cmp", "[dp]"],
  [0xc8, "iny", "implied"],
  [0xc9, "cmp", "imm"],
  [0xca, "dex", "implied"],
  [0xcb, "wai", "implied"],
  [0xcc, "cpy", "abs"],
  [0xcd, "cmp", "abs"],
  [0xce, "dec", "abs"],
  [0xcf, "cmp", "long"],

  [0xd0, "bne", "rel8"],
  [0xd1, "cmp", "(dp),y"],
  [0xd2, "cmp", "(dp)"],
  [0xd3, "cmp", "(sr),y"],
  [0xd4, "pei", "(dp)"],
  [0xd5, "cmp", "dp,x"],
  [0xd6, "dec", "dp,x"],
  [0xd7, "cmp", "[dp],y"],
  [0xd8, "cld", "implied"],
  [0xd9, "cmp", "abs,y"],
  [0xda, "phx", "implied"],
  [0xdb, "stp", "implied"],
  [0xdc, "jmp", "[abs]"],
  [0xdd, "cmp", "abs,x"],
  [0xde, "dec", "abs,x"],
  [0xdf, "cmp", "long,x"],

  [0xe0, "cpx", "imm"],
  [0xe1, "sbc", "(dp,x)"],
  [0xe2, "sep", "imm8"],
  [0xe3, "sbc", "sr"],
  [0xe4, "cpx", "dp"],
  [0xe5, "sbc", "dp"],
  [0xe6, "inc", "dp"],
  [0xe7, "sbc", "[dp]"],
  [0xe8, "inx", "implied"],
  [0xe9, "sbc", "imm"],
  [0xea, "nop", "implied"],
  [0xeb, "xba", "implied"],
  [0xec, "cpx", "abs"],
  [0xed, "sbc", "abs"],
  [0xee, "inc", "abs"],
  [0xef, "sbc", "long"],

  [0xf0, "beq", "rel8"],
  [0xf1, "sbc", "(dp),y"],
  [0xf2, "sbc", "(dp)"],
  [0xf3, "sbc", "(sr),y"],
  [0xf4, "pea", "abs"],
  [0xf5, "sbc", "dp,x"],
  [0xf6, "inc", "dp,x"],
  [0xf7, "sbc", "[dp],y"],
  [0xf8, "sed", "implied"],
  [0xf9, "sbc", "abs,y"],
  [0xfa, "plx", "implied"],
  [0xfb, "xce", "implied"],
  [0xfc, "jsr", "(abs,x)"],
  [0xfd, "sbc", "abs,x"],
  [0xfe, "inc", "abs,x"],
  [0xff, "sbc", "long,x"],
];

// encode map: "mnemonic:mode" → opcode byte
export const ENCODE = new Map<string, number>();

for (const [opcode, mnemonic, mode] of RAW) {
  const key = `${mnemonic}:${mode}`;
  if (!ENCODE.has(key)) {
    ENCODE.set(key, opcode);
  }
}

// Mnemonic aliases (WDC notation → naken_asm notation)
// jsl = jsr long, jml = jmp long
ENCODE.set("jsl:long", 0x22);
ENCODE.set("jml:long", 0x5c);
ENCODE.set("jml:[abs]", 0xdc);

// Whether an instruction's "imm" operand uses accumulator or index width
// Default (absent) = acc width
const IDX_IMM = new Set(["ldx", "ldy", "cpx", "cpy", "stx", "sty"]);
const FIXED8_IMM = new Set(["brk", "rep", "sep", "cop", "wdm"]);

export function immKind(mnemonic: string): ImmKind {
  if (FIXED8_IMM.has(mnemonic)) return "fixed8";
  if (IDX_IMM.has(mnemonic)) return "idx";
  return "acc";
}

// Operand byte counts for each AsmMode (not counting the opcode byte itself)
export function modeOperandBytes(mode: AsmMode, accWidth: 8 | 16 | 32, idxWidth: 8 | 16 | 32, mnemonic: string): number {
  switch (mode) {
    case "implied":   return 0;
    case "imm8":      return 1;
    case "imm": {
      const k = immKind(mnemonic);
      const w = k === "idx" ? idxWidth : accWidth;
      return w / 8;
    }
    case "dp":
    case "dp,x":
    case "dp,y":
    case "(dp)":
    case "[dp]":
    case "(dp,x)":
    case "(dp),y":
    case "[dp],y":
    case "sr":
    case "(sr),y":
    case "rel8":
      return 1;
    case "abs":
    case "abs,x":
    case "abs,y":
    case "(abs)":
    case "[abs]":
    case "(abs,x)":
    case "rel16":
      return 2;
    case "long":
    case "long,x":
      return 3;
    case "block":
      return 2;
  }
}
