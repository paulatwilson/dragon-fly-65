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

## Program 10: Unknown Byte Disassembly

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
