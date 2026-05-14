# Monitor Assembly Test Programs

These programs are entered through the DragonFly 65 monitor `A` command. They
are not side-loaded by the host. Each example records what it does, how to enter
it, how to inspect it with `D`, and what the expected result is when run with
`G`.

Use this file as the source of truth for manual smoke tests and monitor
workflow tests.

## Program 1: Print A

Purpose:

- Proves `lda #imm8`, `sta abs`, `rts`, output through `$F000`, and `G` return.

Enter:

```text
* A0300
0300> lda #'A'
0302> sta $F000
0305> rts
0306> end
OK
```

Disassemble:

```text
* D0300
0300 A9 41 LDA #$41
0302 8D 00 F0 STA $F000
0305 60 RTS
0306 00 DB $00
0307 00 DB $00
0308 00 DB $00
0309 00 DB $00
030A 00 DB $00
```

Run:

```text
* G0300
A
Returned
```

Expected:

- Terminal prints `A`.
- Monitor prints `Returned`.
- `R` shows `A=41`.

## Program 2: Print HI

Purpose:

- Proves multiple immediate loads and repeated writes to `CHAR_OUT`.

Enter:

```text
* A0310
0310> lda #'H'
0312> sta $F000
0315> lda #'I'
0317> sta $F000
031A> rts
031B> end
OK
```

Disassemble:

```text
* D0310
0310 A9 48 LDA #$48
0312 8D 00 F0 STA $F000
0315 A9 49 LDA #$49
0317 8D 00 F0 STA $F000
031A 60 RTS
031B 00 DB $00
031C 00 DB $00
031D 00 DB $00
```

Run:

```text
* G0310
HI
Returned
```

Expected:

- Terminal prints `HI`.
- Monitor prints `Returned`.
- `R` shows `A=49`.

## Program 3: Hex And Decimal Immediates

Purpose:

- Proves immediate parsing for hex and decimal values.

Enter:

```text
* A0320
0320> lda #$58
0322> sta $F000
0325> lda #89
0327> sta $F000
032A> rts
032B> end
OK
```

Disassemble:

```text
* D0320
0320 A9 58 LDA #$58
0322 8D 00 F0 STA $F000
0325 A9 59 LDA #$59
0327 8D 00 F0 STA $F000
032A 60 RTS
032B 00 DB $00
032C 00 DB $00
032D 00 DB $00
```

Run:

```text
* G0320
XY
Returned
```

Expected:

- Terminal prints `XY`.
- Monitor prints `Returned`.
- `R` shows `A=59`.

## Program 4: Subroutine Call

Purpose:

- Proves `jsr abs`, nested `rts`, and continued execution after the subroutine.

Enter:

```text
* A0330
0330> jsr $0339
0333> lda #'B'
0335> sta $F000
0338> rts
0339> lda #'A'
033B> sta $F000
033E> rts
033F> end
OK
```

Disassemble:

```text
* D0330
0330 20 39 03 JSR $0339
0333 A9 42 LDA #$42
0335 8D 00 F0 STA $F000
0338 60 RTS
0339 A9 41 LDA #$41
033B 8D 00 F0 STA $F000
033E 60 RTS
033F 00 DB $00
```

Run:

```text
* G0330
AB
Returned
```

Expected:

- Terminal prints `AB`.
- Monitor prints `Returned`.
- `R` shows `A=42`.

## Program 5: Jump

Purpose:

- Proves `jmp abs` transfers control and skipped code is not executed.

Enter:

```text
* A0340
0340> jmp $0348
0343> lda #'X'
0345> sta $F000
0348> lda #'J'
034A> sta $F000
034D> rts
034E> end
OK
```

Disassemble:

```text
* D0340
0340 4C 48 03 JMP $0348
0343 A9 58 LDA #$58
0345 8D 00 F0 STA $F000
0348 A9 4A LDA #$4A
034A 8D 00 F0 STA $F000
034D 60 RTS
034E 00 DB $00
```

Run:

```text
* G0340
J
Returned
```

Expected:

- Terminal prints `J`, not `XJ`.
- Monitor prints `Returned`.
- `R` shows `A=4A`.

## Program 6: NOP Padding

Purpose:

- Proves `nop` assembles, disassembles, and does not affect output.

Enter:

```text
* A0350
0350> nop
0351> nop
0352> lda #'N'
0354> sta $F000
0357> rts
0358> end
OK
```

Disassemble:

```text
* D0350
0350 EA NOP
0351 EA NOP
0352 A9 4E LDA #$4E
0354 8D 00 F0 STA $F000
0357 60 RTS
0358 00 DB $00
0359 00 DB $00
035A 00 DB $00
```

Run:

```text
* G0350
N
Returned
```

Expected:

- Terminal prints `N`.
- Monitor prints `Returned`.
- `R` shows `A=4E`.

## Program 7: Register Width Directives

Purpose:

- Proves `sep #imm8` and `rep #imm8` assemble and disassemble. This program
  leaves the monitor's expected accumulator width restored before returning.

Enter:

```text
* A0360
0360> rep #$20
0362> sep #$20
0364> lda #'W'
0366> sta $F000
0369> rts
036A> end
OK
```

Disassemble:

```text
* D0360
0360 C2 20 REP #$20
0362 E2 20 SEP #$20
0364 A9 57 LDA #$57
0366 8D 00 F0 STA $F000
0369 60 RTS
036A 00 DB $00
036B 00 DB $00
036C 00 DB $00
```

Run:

```text
* G0360
W
Returned
```

Expected:

- Terminal prints `W`.
- Monitor prints `Returned`.
- `R` shows `A=57`.

Important:

- Programs should return with accumulator 8-bit and index registers 16-bit
  until the monitor saves and restores widths explicitly.

## Program 8: Accumulator Immediate Operations

Purpose:

- Proves `cmp #imm8`, `and #imm8`, `ora #imm8`, `eor #imm8`, `adc #imm8`,
  and `sbc #imm8` assemble, disassemble, and run from the monitor.
- Uses `cmp` to set carry before `adc` and `sbc`, because the monitor does not
  yet support `clc` or `sec`.

Enter:

```text
* A0370
0370> lda #'A'
0372> and #$0F
0374> ora #$40
0376> eor #$00
0378> sta $F000
037B> cmp #'A'
037D> adc #$00
037F> sta $F000
0382> lda #$46
0384> cmp #$46
0386> sbc #$03
0388> sta $F000
038B> rts
038C> end
OK
```

Disassemble the first eight instructions:

```text
* D0370
0370 A9 41 LDA #$41
0372 29 0F AND #$0F
0374 09 40 ORA #$40
0376 49 00 EOR #$00
0378 8D 00 F0 STA $F000
037B C9 41 CMP #$41
037D 69 00 ADC #$00
037F 8D 00 F0 STA $F000
```

Disassemble the remaining instructions:

```text
* D0382
0382 A9 46 LDA #$46
0384 C9 46 CMP #$46
0386 E9 03 SBC #$03
0388 8D 00 F0 STA $F000
038B 60 RTS
038C 00 DB $00
038D 00 DB $00
038E 00 DB $00
```

Run:

```text
* G0370
ABC
Returned
```

Expected:

- Terminal prints `ABC`.
- Monitor prints `Returned`.
- `R` shows `A=43`.

## Program 9: Accumulator Absolute Operations

Purpose:

- Proves `lda abs`, `cmp abs`, `and abs`, `ora abs`, `eor abs`, `adc abs`,
  and `sbc abs` assemble, disassemble, and run from the monitor.
- Reads test data from RAM at `$0500`.
- Uses `cmp` to set carry before `adc` and `sbc`, because the monitor does not
  yet support `clc` or `sec`.

Enter data:

```text
* S0500F10F400041004603
OK
```

This writes:

```text
$0500 = F1
$0501 = 0F
$0502 = 40
$0503 = 00
$0504 = 41
$0505 = 00
$0506 = 46
$0507 = 03
```

Enter:

```text
* A03A0
03A0> lda $0500
03A3> and $0501
03A6> ora $0502
03A9> eor $0503
03AC> sta $F000
03AF> cmp $0504
03B2> adc $0505
03B5> sta $F000
03B8> lda $0506
03BB> cmp $0506
03BE> sbc $0507
03C1> sta $F000
03C4> rts
03C5> end
OK
```

Disassemble the first eight instructions:

```text
* D03A0
03A0 AD 00 05 LDA $0500
03A3 2D 01 05 AND $0501
03A6 0D 02 05 ORA $0502
03A9 4D 03 05 EOR $0503
03AC 8D 00 F0 STA $F000
03AF CD 04 05 CMP $0504
03B2 6D 05 05 ADC $0505
03B5 8D 00 F0 STA $F000
```

Disassemble the remaining instructions:

```text
* D03B8
03B8 AD 06 05 LDA $0506
03BB CD 06 05 CMP $0506
03BE ED 07 05 SBC $0507
03C1 8D 00 F0 STA $F000
03C4 60 RTS
03C5 00 DB $00
03C6 00 DB $00
03C7 00 DB $00
```

Run:

```text
* G03A0
ABC
Returned
```

Expected:

- Terminal prints `ABC`.
- Monitor prints `Returned`.
- `R` shows `A=43`.

## Program 10: Branches With Absolute Target Syntax

Purpose:

- Proves `beq addr`, `bne addr`, `bcc addr`, `bcs addr`, `bmi addr`, and
  `bpl addr` assemble with absolute target syntax.
- Proves the monitor emits relative branch offsets internally.
- Proves the disassembler prints resolved absolute target addresses.
- Proves all six branch opcodes run from the monitor.

Enter:

```text
* A04A0
04A0> lda #0
04A2> cmp #0
04A4> beq $04AB
04A6> lda #'X'
04A8> sta $F000
04AB> bcs $04B2
04AD> lda #'X'
04AF> sta $F000
04B2> bpl $04B9
04B4> lda #'X'
04B6> sta $F000
04B9> lda #1
04BB> cmp #2
04BD> bne $04C4
04BF> lda #'X'
04C1> sta $F000
04C4> bcc $04CB
04C6> lda #'X'
04C8> sta $F000
04CB> bmi $04D2
04CD> lda #'X'
04CF> sta $F000
04D2> lda #'B'
04D4> sta $F000
04D7> lda #'R'
04D9> sta $F000
04DC> rts
04DD> end
OK
```

Disassemble the first eight instructions:

```text
* D04A0
04A0 A9 00 LDA #$00
04A2 C9 00 CMP #$00
04A4 F0 05 BEQ $04AB
04A6 A9 58 LDA #$58
04A8 8D 00 F0 STA $F000
04AB B0 05 BCS $04B2
04AD A9 58 LDA #$58
04AF 8D 00 F0 STA $F000
```

Disassemble the next branch group:

```text
* D04B2
04B2 10 05 BPL $04B9
04B4 A9 58 LDA #$58
04B6 8D 00 F0 STA $F000
04B9 A9 01 LDA #$01
04BB C9 02 CMP #$02
04BD D0 05 BNE $04C4
04BF A9 58 LDA #$58
04C1 8D 00 F0 STA $F000
```

Disassemble the final branch group:

```text
* D04C4
04C4 90 05 BCC $04CB
04C6 A9 58 LDA #$58
04C8 8D 00 F0 STA $F000
04CB 30 05 BMI $04D2
04CD A9 58 LDA #$58
04CF 8D 00 F0 STA $F000
04D2 A9 42 LDA #$42
04D4 8D 00 F0 STA $F000
```

Run:

```text
* G04A0
BR
Returned
```

Expected:

- Terminal prints `BR`.
- Terminal does not print `X`.
- Monitor prints `Returned`.
- `R` shows `A=52`.

## Program 11: Byte Data Entry

Purpose:

- Proves `.byte` and `db` emit raw data from monitor assembly mode.
- Proves byte data accepts hex, decimal, and character literals.
- Proves emitted data can be inspected with `M`, disassembled as `DB $xx`, and
  used by a monitor program.

Enter data:

```text
* A0500
0500> .byte $41, 66, 'C'
0503> db $00, 68
0505> end
OK
```

Inspect memory:

```text
* M0500
0500: 41 42 43 00 44 ...
```

Disassemble:

```text
* D0500
0500 41 DB $41
0501 42 DB $42
0502 43 DB $43
0503 00 DB $00
0504 44 DB $44
0505 00 DB $00
0506 00 DB $00
0507 00 DB $00
```

Use the data from a program:

```text
* A0520
0520> .byte 'D', $41, 84, $41
0524> end
OK
* A0530
0530> lda $0520
0533> sta $F000
0536> lda $0521
0539> sta $F000
053C> lda $0522
053F> sta $F000
0542> lda $0523
0545> sta $F000
0548> rts
0549> end
OK
* G0530
DATA
Returned
```

Expected:

- `$0500-$0504` contains `41 42 43 00 44`.
- `D0500` shows each data byte as `DB $xx`.
- The program at `$0530` prints `DATA`.
- `R` shows `A=41`.

## Program 12: Unknown Byte Disassembly

Purpose:

- Proves unknown or unsupported opcodes are rendered as `DB $xx`.

Enter bytes:

```text
* S039002
OK
```

Disassemble:

```text
* D0390
0390 02 DB $02
0391 00 DB $00
0392 00 DB $00
0393 00 DB $00
0394 00 DB $00
0395 00 DB $00
0396 00 DB $00
0397 00 DB $00
```

Expected:

- The first line is `0390 02 DB $02`.
- This program should not be run with `G`.

## Program 13: Core Implied And Status Instructions

Purpose:

- Proves the monitor assembler accepts the N10 implied/status instruction group.
- Proves the disassembler renders the same N10 mnemonics.
- Runs the safe transfer, increment/decrement, and status subset without using
  `txs`, which changes the stack pointer.

Enter:

```text
* A06C0
06C0> sep #$10
06C2> lda #'A'
06C4> tax
06C5> inx
06C6> dex
06C7> txa
06C8> sta $F000
06CB> lda #'B'
06CD> tay
06CE> iny
06CF> dey
06D0> tya
06D1> sta $F000
06D4> clc
06D5> sec
06D6> clv
06D7> cld
06D8> sed
06D9> cli
06DA> sei
06DB> rep #$10
06DD> rts
06DE> end
OK
```

Disassemble the implied/status opcode group:

```text
* A0800
0800> tax
0801> tay
0802> txa
0803> tya
0804> tsx
0805> txs
0806> inx
0807> dex
0808> iny
0809> dey
080A> clc
080B> sec
080C> cli
080D> sei
080E> clv
080F> cld
0810> sed
0811> end
OK
* D0800
0800 AA TAX
0801 A8 TAY
0802 8A TXA
0803 98 TYA
0804 BA TSX
0805 9A TXS
0806 E8 INX
0807 CA DEX
* D0808
0808 C8 INY
0809 88 DEY
080A 18 CLC
080B 38 SEC
080C 58 CLI
080D 78 SEI
080E B8 CLV
080F D8 CLD
* D0810
0810 F8 SED
0811 00 DB $00
0812 00 DB $00
0813 00 DB $00
0814 00 DB $00
0815 00 DB $00
0816 00 DB $00
0817 00 DB $00
```

Run:

```text
* G06C0
AB
Returned
```

Expected:

- The program prints `AB`.
- `D0800`, `D0808`, and `D0810` show every N10 opcode listed above.
- `txs` should be treated as a disassembly/parity case until a program
  intentionally manages its own stack.

## Program 14: STA Direct Page And Indexed Forms

Purpose:

- Proves the monitor assembler accepts the N11 `sta` direct page and indexed
  forms.
- Proves the disassembler renders the same N11 `sta` forms.
- Runs the stores and verifies direct page plus absolute target memory.

Enter:

```text
* A0820
0820> sep #$30
0822> ldx #$01
0824> ldy #$02
0826> lda #'Q'
0828> sta $20
082A> sta $20,x
082C> sta $0390
082F> sta $0390,x
0832> sta $0390,y
0835> rts
0836> end
OK
```

Disassemble:

```text
* D0828
0828 85 20 STA $20
082A 95 20 STA $20,X
082C 8D 90 03 STA $0390
082F 9D 90 03 STA $0390,X
0832 99 90 03 STA $0390,Y
0835 60 RTS
0836 00 DB $00
0837 00 DB $00
```

Run and inspect:

```text
* G0820
Returned
* M0020
0020: 51 51 ...
* M0390
0390: 51 51 51 ...
```

Expected:

- `$0020` and `$0021` contain `$51`.
- `$0390`, `$0391`, and `$0392` contain `$51`.
- `D0828` shows `STA $20`, `STA $20,X`, `STA $0390`, `STA $0390,X`, and
  `STA $0390,Y`.

## Program 15: LDA Direct Page And Indexed Forms

Purpose:

- Proves the monitor assembler accepts the N12 `lda` direct page and indexed
  forms.
- Proves the disassembler renders the same N12 `lda` forms.
- Runs the loads against direct page and absolute data.

Enter:

```text
* A0840
0840> sep #$30
0842> ldx #$01
0844> ldy #$02
0846> lda #'A'
0848> sta $22
084A> lda #'B'
084C> sta $23
084E> lda #'C'
0850> sta $0394
0853> lda #'D'
0855> sta $0395
0858> lda #'E'
085A> sta $0396
085D> lda $22
085F> sta $F000
0862> lda $22,x
0864> sta $F000
0867> lda $0394
086A> sta $F000
086D> lda $0394,x
0870> sta $F000
0873> lda $0394,y
0876> sta $F000
0879> rts
087A> end
OK
```

Disassemble:

```text
* D085D
085D A5 22 LDA $22
085F 8D 00 F0 STA $F000
0862 B5 22 LDA $22,X
0864 8D 00 F0 STA $F000
0867 AD 94 03 LDA $0394
086A 8D 00 F0 STA $F000
086D BD 94 03 LDA $0394,X
0870 8D 00 F0 STA $F000
* D0873
0873 B9 94 03 LDA $0394,Y
0876 8D 00 F0 STA $F000
0879 60 RTS
087A 00 DB $00
087B 00 DB $00
087C 00 DB $00
087D 00 DB $00
087E 00 DB $00
```

Run:

```text
* G0840
ABCDE
Returned
```

Expected:

- The program prints `ABCDE`.
- `D085D` and `D0873` show `LDA $22`, `LDA $22,X`, `LDA $0394`,
  `LDA $0394,X`, and `LDA $0394,Y`.

## Program 16: Accumulator ALU Direct Page And Indexed Forms

Purpose:

- Proves the monitor assembler accepts the N13 direct page and indexed forms
  for `cmp`, `and`, `ora`, `eor`, `adc`, and `sbc`.
- Proves the disassembler renders the same N13 forms.

Enter:

```text
* A0890
0890> cmp $24
0892> cmp $24,x
0894> cmp $0398,x
0897> cmp $0398,y
089A> and $25
089C> and $25,x
089E> and $0399,x
08A1> and $0399,y
08A4> end
OK
* A08B0
08B0> ora $26
08B2> ora $26,x
08B4> ora $039A,x
08B7> ora $039A,y
08BA> eor $27
08BC> eor $27,x
08BE> eor $039B,x
08C1> eor $039B,y
08C4> end
OK
* A08D0
08D0> adc $28
08D2> adc $28,x
08D4> adc $039C,x
08D7> adc $039C,y
08DA> sbc $29
08DC> sbc $29,x
08DE> sbc $039D,x
08E1> sbc $039D,y
08E4> end
OK
```

Disassemble:

```text
* D0890
0890 C5 24 CMP $24
0892 D5 24 CMP $24,X
0894 DD 98 03 CMP $0398,X
0897 D9 98 03 CMP $0398,Y
089A 25 25 AND $25
089C 35 25 AND $25,X
089E 3D 99 03 AND $0399,X
08A1 39 99 03 AND $0399,Y
* D08B0
08B0 05 26 ORA $26
08B2 15 26 ORA $26,X
08B4 1D 9A 03 ORA $039A,X
08B7 19 9A 03 ORA $039A,Y
08BA 45 27 EOR $27
08BC 55 27 EOR $27,X
08BE 5D 9B 03 EOR $039B,X
08C1 59 9B 03 EOR $039B,Y
* D08D0
08D0 65 28 ADC $28
08D2 75 28 ADC $28,X
08D4 7D 9C 03 ADC $039C,X
08D7 79 9C 03 ADC $039C,Y
08DA E5 29 SBC $29
08DC F5 29 SBC $29,X
08DE FD 9D 03 SBC $039D,X
08E1 F9 9D 03 SBC $039D,Y
```

Expected:

- The three `D` commands show every N13 opcode listed above.
- This parity example should not be run with `G` unless the referenced data
  bytes are initialized first.

## Growth Test Template

Every new native assembler/disassembler chunk should add examples in this
shape:

```text
## Program N: Name

Purpose:
- The exact opcode, addressing mode, directive, or parser behavior under test.

Enter:
- The exact monitor commands/source.

Disassemble:
- The exact `D` output expected.

Run:
- The exact `G` command, if executable.

Expected:
- Terminal output.
- Register state from `R`, if meaningful.
- Memory state from `M`, if meaningful.
```
