# Opcode Matrix

Status legend: **✓** implemented · **—** planned · **·** reserved/unsupported

Each cell shows the mnemonic (abbreviated where needed). Addressing mode abbreviations:
`A`=accumulator, `imm`=immediate, `dp`=direct, `abs`=absolute, `rel`=relative,
`dpX`=dp+X, `dpY`=dp+Y, `absX`=abs+X, `absY`=abs+Y, `lng`=long, `ind`=indirect,
`iabs`=indirect-abs, `sr`=stack-relative, `bm`=block-move, `imp`=implied.

```
     x0        x1        x2        x3        x4        x5        x6        x7
0x   BRK✓imm8  ORA—dpX   COP✓imm8  ORA—sr    TSB✓dp    ORA✓dp    ASL✓dp    ORA—[dp]
1x   BPL✓rel   ORA—dpYi  ORA—ind   ORA—sri   TRB✓dp    ORA—dpX   ASL—dpX   ORA—[dp]X
2x   JSR✓abs   AND—dpX   JSL✓lng   AND—sr    BIT✓dp    AND✓dp    ROL✓dp    AND—[dp]
3x   BMI✓rel   AND—dpYi  AND—ind   AND—sri   BIT—dpX   AND—dpX   ROL—dpX   AND—[dp]X
4x   RTI✓imp   EOR—dpX   MVP✓bm    EOR—sr    MVN✓bm    EOR✓dp    LSR✓dp    EOR—[dp]
5x   BVC✓rel   EOR—dpYi  EOR—ind   EOR—sri   ·         EOR—dpX   LSR—dpX   EOR—[dp]X
6x   RTS✓imp   ADC—dpX   JMP✓iabs  ADC—sr    STZ✓dp    ADC✓dp    ROR✓dp    ADC—[dp]
7x   BVS✓rel   ADC—dpYi  ADC—ind   ADC—sri   STZ—dpX   ADC—dpX   ROR—dpX   ADC—[dp]X
8x   BRA—rel   STA—dpX   BRL—lng   STA—sr    STY✓dp    STA✓dp    STX✓dp    STA—[dp]
9x   BCC✓rel   STA—dpYi  STA✓ind   STA—sri   STZ✓abs   STA✓absX  STX✓dpY   STA—[dp]X
Ax   LDY✓imm   LDA—dpX   LDX✓imm   LDA—sr    LDY✓dp    LDA✓dp    LDX✓dp    LDA—[dp]
Bx   BCS✓rel   LDA—dpYi  LDA✓ind   LDA—sri   LDY—dpX   LDA✓dpX   LDX✓dpY   LDA—[dp]X
Cx   CPY✓imm   CMP—dpX   REP✓imm   CMP—sr    CPY✓dp    CMP✓dp    DEC✓dp    CMP—[dp]
Dx   BNE✓rel   CMP—dpYi  CMP—ind   CMP—sri   PEI—dp    CMP—dpX   DEC—dpX   CMP—[dp]X
Ex   CPX✓imm   SBC—dpX   SEP✓imm   SBC—sr    CPX✓dp    SBC✓dp    INC✓dp    SBC—[dp]
Fx   BEQ✓rel   SBC—dpYi  SBC—ind   SBC—sri   PEA—abs   SBC—dpX   INC—dpX   SBC—[dp]X

     x8        x9        xA        xB        xC        xD        xE        xF
0x   PHP✓imp   ORA✓imm   ASL✓A     PHD✓imp   TSB✓abs   ORA—abs   ASL✓abs   ORA—lng
1x   CLC✓imp   ORA✓absY  INC✓A     TCS—imp   TRB✓abs   ORA—absX  ASL—absX  ORA—lngX
2x   PLP✓imp   AND✓imm   ROL✓A     PLD✓imp   BIT✓abs   AND—abs   ROL✓abs   AND—lng
3x   SEC✓imp   AND✓absY  DEC✓A     TSC—imp   BIT—absX  AND—absX  ROL—absX  AND—lngX
4x   PHA✓imp   EOR✓imm   LSR✓A     PHK✓imp   JMP✓abs   EOR—abs   LSR✓abs   EOR—lng
5x   CLI✓imp   EOR✓absY  PHY✓imp   TCD—imp   JML✓lng   EOR—absX  LSR—absX  EOR—lngX
6x   PLA✓imp   ADC✓imm   ROR✓A     RTL✓imp   JMP✓iabs  ADC—abs   ROR✓abs   ADC—lng
7x   SEI✓imp   ADC✓absY  PLY✓imp   TDC—imp   JMP✓absX  ADC—absX  ROR—absX  ADC—lngX
8x   DEY✓imp   BIT✓imm   TXA✓imp   PHB✓imp   STY✓abs   STA✓abs   STX✓abs   STA✓lng
9x   BCC✓rel   STA✓absY  TXS✓imp   TXY—imp   STZ✓abs   STA✓absX  STX—·     STA—lngX
Ax   TAY✓imp   LDA✓imm   TAX✓imp   PLB✓imp   LDY✓abs   LDA✓abs   LDX✓abs   LDA✓lng
Bx   CLV✓imp   LDA✓absY  TSX✓imp   TYX—imp   LDY—absX  LDA✓absX  LDX✓absY  LDA—lngX
Cx   INY✓imp   CMP✓imm   DEX✓imp   WAI—imp   CPY—abs   CMP—abs   DEC✓abs   CMP—lng
Dx   CLD✓imp   CMP✓absY  PHX✓imp   STP✓imp   JMP✓[abs] CMP—absX  DEC—absX  CMP—lngX
Ex   INX✓imp   SBC✓imm   ·         XBA—imp   CPX—abs   SBC—abs   INC✓abs   SBC—lng
Fx   SED✓imp   SBC✓absY  PLX✓imp   XCE✓imp   JSR✓absX  SBC—absX  INC—absX  SBC—lngX
```

## Extended W65C832 Opcodes

| Opcode | Mnemonic | Status | Notes |
|--------|----------|--------|-------|
| 0xEB   | XFE      | ✓      | Exchange full emulation (C↔E16, V↔E8) |

## Implemented Instruction Summary

| Family            | Implemented                                                      |
|-------------------|------------------------------------------------------------------|
| Load              | LDA, LDX, LDY (imm, dp, abs, dpX, absX, absY, lng, ind, sr)     |
| Store             | STA, STX, STY (dp, abs, dpX, absX, absY, lng, ind, sr), STZ     |
| Transfer          | TAX, TAY, TXA, TYA, TXS, TSX                                     |
| Increment/Decrement| INX, INY, DEX, DEY, INC (A/dp/abs), DEC (A/dp/abs)             |
| Arithmetic        | ADC, SBC (imm, dp)                                               |
| Logic             | AND, ORA, EOR (imm, dp)                                          |
| Compare           | CMP, CPX, CPY (imm, dp)                                          |
| Shifts            | ASL, LSR, ROL, ROR (A, dp, abs)                                  |
| Bit tests         | BIT (imm, dp, abs), TSB (dp, abs), TRB (dp, abs)                |
| Branches          | BEQ, BNE, BCC, BCS, BMI, BPL, BVC, BVS                          |
| Jumps             | JMP (abs, iabs), JML, JSR, JSL, RTS, RTL                        |
| Stack             | PHA, PLA, PHP, PLP, PHX, PLX, PHY, PLY, PHB, PLB, PHD, PLD, PHK |
| Block move        | MVN, MVP                                                         |
| Flags             | CLC, SEC, CLI, SEI, CLD, SED, CLV                                |
| Interrupts        | BRK, COP, RTI                                                    |
| Mode switching    | REP, SEP, XCE, XFE                                               |
| Misc              | NOP, STP                                                         |
