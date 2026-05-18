# DragonFly 65 Monitor

The DragonFly 65 monitor is the first interactive software environment for the
machine. It is written in W65C832 assembly and is intended to behave like the
initial firmware monitor on early personal computers: after boot, the user lands
at a prompt, can inspect memory, write bytes, run code, and return to the
monitor.

Source: `monitor/monitor.asm`

Boot the DragonFly 65 computer into the monitor:

```sh
bun run computer
```

Run the monitor compatibility entrypoint:

```sh
bun run monitor
```

## Current Status

The monitor exists, is test-covered, and is the current DragonFly 65 boot
environment.

Implemented:

- Assemble monitor ROM from `monitor/monitor.asm`.
- Load monitor into the emulator-backed `Machine`.
- Boot to an interactive prompt.
- Read keyboard input through memory-mapped I/O.
- Print terminal output through memory-mapped I/O.
- Inspect memory.
- Set memory bytes.
- Run a subroutine at a supplied address.
- Return to the monitor with `RTS`.
- Display registers saved after a `G` command.
- Assemble a small instruction subset into RAM with the `A` command.
- Disassemble the same small instruction subset from RAM with the `D` command.

- Additional directives and wider opcode coverage in assembly mode.
- Compiler targets, such as Lovelace, that emit monitor ABI-compatible programs.

## Memory Map

The monitor currently uses bank 0 and a 64 KiB machine profile.

```text
$0000-$01FF   zero page + hardware stack
$0200-$02D2   monitor work RAM
$0300-$BFFF   user program RAM
$C000-$FFFF   monitor ROM and vectors, with I/O hole at $F000-$F002
$F000-$F002   memory-mapped I/O
```

Memory-mapped I/O:

```text
$F000  CHAR_OUT   write byte to terminal
$F001  CHAR_IN    read next input byte, or $FF if no input is queued
$F002  CHAR_STS   read 1 if input is available, otherwise 0
```

### Zero-Page Layout

The monitor reserves nine bytes of zero page for its own use. Programs must
not clobber these while inside a monitor subroutine call.

```text
$00-$01  ZP_PTR    16-bit pointer used by PRINT_ZP
$02-$03  ZP_ADDR   16-bit working address (parse target and dump address)
$04      ZP_TMP    temporary byte (also used as a 2-byte spill at $04-$05)
$05      ZP_TMP2   temporary byte
$06-$07  ZP_OPER   parsed operand word for assembly mode
$08      ZP_ERR    non-zero when assembly parsing fails
```

### Monitor Work RAM

```text
$0200-$023F  INBUF       64-byte input line buffer
$0240        INBUF_LEN   length of the last input line (1 byte)
$0250        A_SAVE      A register saved after last G return
$0251-$0252  X_SAVE      X register saved after last G return (little-endian)
$0253-$0254  Y_SAVE      Y register saved after last G return (little-endian)
$0255        P_SAVE      processor status byte saved after last G return
$0256        REG_VALID   0 = no program run yet; 1 = save area is valid
$0257        ASM_LABEL_COUNT
$0258-$0267  ASM_LABEL_HASHES  16 compact symbol hashes
$0268-$0287  ASM_LABEL_ADDRS   16 two-byte symbol values
$0288        ASM_FIXUP_COUNT
$0289        ASM_PENDING_KIND
$028A        ASM_PENDING_HASH
$028B-$029A  ASM_FIXUP_HASHES  16 compact unresolved symbol hashes
$029B-$02BA  ASM_FIXUP_ADDRS   16 two-byte patch addresses
$02BB-$02CA  ASM_FIXUP_KINDS   16 one-byte patch kinds
$02CB        ASM_ACC_BYTES     assembly-mode accumulator immediate width
$02CC        ASM_IDX_BYTES     assembly-mode index immediate width
$02CD        DISASM_ACC_BYTES  disassembly-mode accumulator immediate width
$02CE        DISASM_IDX_BYTES  disassembly-mode index immediate width
$02CF-$02D2  ASM_IMM_BYTES     4-byte immediate scratch
```

### Interrupt Vectors

The monitor ROM populates both native-mode and emulation-mode vector tables.
These vector bytes live in the ROM range.

```text
$FFE4  COP  (native)   → DUMMY_IRQ (RTI)
$FFE6  BRK  (native)   → DUMMY_IRQ (RTI)
$FFE8  ABORT (native)  → DUMMY_IRQ (RTI)
$FFEA  NMI  (native)   → DUMMY_IRQ (RTI)
$FFEE  IRQ  (native)   → DUMMY_IRQ (RTI)
$FFFA  NMI  (emul.)    → DUMMY_IRQ (RTI)
$FFFC  RESET (emul.)   → MONITOR_ENTRY
$FFFE  IRQ/BRK (emul.) → DUMMY_IRQ (RTI)
```

All unhandled interrupts execute a single RTI. Programs that need real
interrupt handlers must install their own vectors before enabling interrupts.

## Boot Behavior

The current computer boot path:

1. Assembles `monitor/monitor.asm`.
2. Loads the assembled bytes as monitor ROM at the monitor origin, currently
   `$C000`.
3. Uses the reset vector emitted by the monitor ROM at `$FFFC-$FFFD`.
4. Resets the CPU.
5. Runs instructions until stopped or interrupted.

On reset, the monitor entry code (`MONITOR_ENTRY`):

1. Switches from emulation mode to W65C816 native mode (`CLC; XCE`).
2. Sets accumulator and index registers to 16-bit, loads `SP = $01FF`.
3. Narrows accumulator to 8-bit; leaves index at 16-bit.
4. Sets data bank register to 0.
5. Prints the banner: `DragonFly 65 Monitor` / `Type H for help`.
6. Enters the main prompt loop.

## CPU Conventions

The monitor operates with these register widths throughout:

```text
Accumulator: 8-bit  (M flag = 1, SEP #$20 at boot)
Index X, Y:  16-bit (X flag = 0, REP #$10 at boot)
Data bank:   0
Stack:       $0100-$01FF (SP initialised to $01FF at reset)
```

Programs launched with `G` inherit these settings. The simplest valid
monitor-launched program ends with `RTS`.

## Command Line

The monitor prints a prompt, reads one line of input, and dispatches on the
first character. Input mechanics:

- Prompt: `CRLF` + `*` + space (a blank line, then an asterisk and a space).
- Commands are **not** space-delimited. The command letter is immediately
  followed by hex digits; no spaces are used.
- Input is **case-insensitive**. The command character is converted to
  uppercase before dispatch.
- The line buffer holds at most 63 characters. Input beyond that limit is
  silently discarded.
- Backspace (`$08`) and DEL (`$7F`) erase the previous character and echo a
  backspace-space-backspace sequence.
- Carriage return (`$0D`) ends input. Line feed (`$0A`) is ignored.
- An empty line re-displays the prompt.
- An unrecognised command prints `?` and re-prompts.

## Commands

### `H` — Help

Print the command reference.

```text
* H
```

Output:

```text
H           help
MAAAA       memory dump (16 bytes at AAAA)
SAAAADD..   set bytes at AAAA
GAAAA       run at AAAA (program returns with RTS)
R           show registers from last G
AAAAA       assemble at AAAA, end to finish
DAAAA       disassemble 8 instructions at AAAA
```

### `M` — Memory dump

Dump 16 bytes of memory starting at a 16-bit address.

Format:

```text
MAAAA
```

`AAAA` is a four-digit hex address (no `$` prefix).

Example:

```text
* M0300
```

Output format:

```text
0300: A9 41 8D 00 F0 60 00 00  00 00 00 00 00 00 00 00  |.A..p`..........| 
```

The address label, sixteen space-separated hex byte pairs, a `|` separator,
sixteen ASCII characters (non-printable bytes shown as `.`), and a closing `|`.

### `S` — Set memory

Write one or more bytes at a 16-bit address.

Format:

```text
SAAAADD...
```

- `AAAA`: four-digit hex destination address.
- `DD...`: one or more byte values as consecutive hex pairs. There is no
  separator between bytes.

Example — write a short program at `$0300`:

```text
* S0300A9418D00F060
```

This stores `$A9 $41 $8D $00 $F0 $60` starting at `$0300`. On success the
monitor prints `OK`.

The monitor does not echo what was written. Use `M` to verify.

### `G` — Go

Run user code at a 16-bit address and return to the monitor when the program
executes `RTS`.

Format:

```text
GAAAA
```

Example:

```text
* G0300
```

The monitor uses an RTS-stack trick rather than a raw `JSR`:

1. It pushes the return address for `DO_GO_RETURNED` (minus one, per 65816
   `RTS` convention) onto the stack.
2. It pushes the target address (minus one) onto the stack.
3. It executes `RTS`, which transfers control to the target.
4. When the program executes its own `RTS`, the return falls to
   `DO_GO_RETURNED`.

On return, the monitor:

- Saves A, X, Y, and P to the register save area (`$0250–$0256`).
- Sets `REG_VALID` to 1.
- Prints `Returned`.
- Re-enters the prompt loop.

If the program executes `STP` the machine halts rather than returning.

### `R` — Registers

Show the register state saved when the last `G` program returned.

```text
* R
```

Output format:

```text
A=41  X=0000  Y=0000  P=30
```

If no program has returned since boot, the monitor prints `No program run yet`.

The P byte reflects the processor status register at the moment the program's
`RTS` executed. Bit interpretation follows the standard 65816 P register:

```text
Bit 7  N  Negative
Bit 6  V  Overflow
Bit 5  M  Accumulator width (1 = 8-bit)
Bit 4  X  Index width (1 = 8-bit)
Bit 3  D  Decimal mode
Bit 2  I  IRQ disable
Bit 1  Z  Zero
Bit 0  C  Carry
```

### `A` — Assemble

Enter monitor assembly mode at a 16-bit address. This is implemented inside the
monitor ROM as a W65C832 assembly mini assembler. It does not call the
TypeScript host assembler.

Format:

```text
AAAAA
```

Where the first `A` is the command and the remaining four hex digits are the
assembly address.

Example:

```text
* A0300
0300> lda #'H'
0302> sta $F000
0305> lda #'I'
0307> sta $F000
030A> rts
030B> end
OK
* G0300
HI
Returned
*
```

Semantics:

- `A` followed by a four-digit address starts assembly mode at that address.
- The prompt displays the current assembly address.
- Each accepted source line emits bytes at the current address.
- The current address advances by the emitted byte count.
- `end` exits assembly mode and returns to the normal monitor prompt.
- Invalid source should print an error and keep the current address unchanged.

Current instruction subset:

```text
lda #imm8
cmp #imm8
cpx #imm8
cpy #imm8
bit #imm8
and #imm8
ora #imm8
eor #imm8
adc #imm8
sbc #imm8
lda dp
lda dp,x
lda abs
lda abs,x
lda abs,y
cmp dp
cmp dp,x
cmp abs
cmp abs,x
cmp abs,y
cpx dp
cpx abs
cpy dp
cpy abs
bit dp
bit dp,x
bit abs
bit abs,x
inc
inc dp
inc dp,x
inc abs
inc abs,x
dec
dec dp
dec dp,x
dec abs
dec abs,x
asl
asl dp
asl dp,x
asl abs
asl abs,x
lsr
lsr dp
lsr dp,x
lsr abs
lsr abs,x
rol
rol dp
rol dp,x
rol abs
rol abs,x
ror
ror dp
ror dp,x
ror abs
ror abs,x
and dp
and dp,x
and abs
and abs,x
and abs,y
ora dp
ora dp,x
ora abs
ora abs,x
ora abs,y
eor dp
eor dp,x
eor abs
eor abs,x
eor abs,y
adc dp
adc dp,x
adc abs
adc abs,x
adc abs,y
sbc dp
sbc dp,x
sbc abs
sbc abs,x
sbc abs,y
ldx #imm8
ldy #imm8
ldx dp
ldy dp
stx dp
sty dp
ldx abs
ldy abs
stx abs
sty abs
ldx dp,y
ldy dp,x
stx dp,y
sty dp,x
ldx abs,y
ldy abs,x
sta dp
sta dp,x
sta abs,x
sta abs,y
tax
tay
txa
tya
tsx
txs
inx
dex
iny
dey
clc
sec
cli
sei
clv
cld
sed
beq abs
bne abs
bcc abs
bcs abs
bmi abs
bpl abs
bra abs
bvc abs
bvs abs
pha
pla
php
plp
phx
plx
phy
ply
phb
plb
phd
pld
phk
brk [#imm8]
rti
cop #imm8
wdm #imm8
wai
stp
.byte value-or-string[,value-or-string...]
db value-or-string[,value-or-string...]
.word value[,value...]
.dw value[,value...]
.long value[,value...]
.dl value[,value...]
.ascii "text"
.asciiz "text"
.resb count
.a8
.a16
.a32
.i8
.i16
.i32
label:
label: instruction
NAME .equ value
<expr
!expr
>expr
sta abs
lda long
sta long
lda long,x
sta long,x
rts
nop
sep #imm8
rep #imm8
jsr abs
jsr (abs,x)
jsl long
jmp abs
jmp (abs)
jmp (abs,x)
jmp [abs]
jml long
```

Current parser limits:

- accumulator and index immediate forms default to one-byte immediates and can
  be changed with `.a8`, `.a16`, `.a32`, `.i8`, `.i16`, and `.i32`; visible
  `sep #$10`/`rep #$10` and `sep #$20`/`rep #$20` also update assembly width
  state for following immediates,
- memory load/store width is controlled by CPU status flags at runtime, not by
  address syntax,
- direct page syntax uses two hex digits, such as `$10`; absolute syntax uses
  four hex digits, such as `$0010`,
- `<expr` forces direct page addressing and emits the low byte of the value,
  such as `lda <$1000`,
- `!expr` forces absolute addressing, such as `lda !$10` or `jsr !$10`,
- `>expr` selects long addressing, such as `lda >$1000` or `sta >target,x`,
- six-digit hex operands such as `$010000` select long addressing automatically
  for opcodes that support it,
- labels may be on their own line or before an instruction, such as `loop:` or
  `loop: lda #0`,
- constants use host-compatible `NAME .equ value` syntax,
- labels are scoped to one `A` assembly session,
- `.equ` constants are scoped to one `A` assembly session,
- label references may point backward or forward within the current session,
- unresolved labels are rejected when `end` is entered,
- the native symbol table stores 16 compact one-byte-hashed label/constant
  entries, and the fixup table stores 16 unresolved references; names with the
  same compact hash are treated as duplicates until full symbol storage is
  added,
- assembly errors print `?` for a generic parse failure, `?DUP` for duplicate
  symbol hashes, `?UNRES` for unresolved symbols at `end`, and `?TABLE` when a
  compact symbol or fixup table is full,
- branch targets may be written as absolute addresses such as `$0310` or as
  labels; the monitor emits the relative byte internally,
- branch targets must fit the signed 8-bit relative branch range,
- no directives except `.byte`, `db`, `.word`, `.dw`, `.long`, `.dl`,
  `.ascii`, `.asciiz`, `.resb`, `.equ`, and the native width directives,
- no expressions beyond literal values,
- case-insensitive mnemonics,
- hex immediates such as `$41`,
- one- or two-digit decimal immediates such as `65`,
- character literals such as `'A'`,
- absolute addresses such as `$F000`.
- `.byte` and `db` accept comma-separated hex byte, decimal byte, character
  literals, and double-quoted string literals such as `.byte "AB", $43, 'D'`.
- `.word`/`.dw` emit little-endian two-byte values, and `.long`/`.dl` emit
  little-endian three-byte values.
- `.ascii` emits raw double-quoted string bytes, `.asciiz` appends one zero
  byte, and `.resb` emits a run of zero bytes.
- `D` starts with `.a8`/`.i8` disassembly state and updates 8/16-bit immediate
  rendering when it sees `sep`/`rep` in the bytes being disassembled; it cannot
  infer source-only `.a16`, `.a32`, `.i16`, or `.i32` directives that emitted no
  bytes before the disassembly start address.

The full TypeScript assembler remains useful as a cross-assembler for ROM
builds and tests. It should not be treated as the implementation for monitor
assembly mode.

### `D` — Disassemble

Disassemble eight instructions starting at a 16-bit address. `D` intentionally
matches the current `A` command subset. When native assembler support grows, the
disassembler must be updated in the same change.

Format:

```text
DAAAA
```

Example after assembling the `HI` program above:

```text
* D0300
0300 A9 48 LDA #$48
0302 8D 00 F0 STA $F000
0305 A9 49 LDA #$49
0307 8D 00 F0 STA $F000
030A 60 RTS
030B 00 DB $00
030C 00 DB $00
030D 00 DB $00
```

Current disassembly subset:

```text
lda #imm8
cmp #imm8
cpx #imm8
cpy #imm8
bit #imm8
and #imm8
ora #imm8
eor #imm8
adc #imm8
sbc #imm8
lda dp
lda dp,x
lda abs
lda abs,x
lda abs,y
cmp dp
cmp dp,x
cmp abs
cmp abs,x
cmp abs,y
cpx dp
cpx abs
cpy dp
cpy abs
bit dp
bit dp,x
bit abs
bit abs,x
inc
inc dp
inc dp,x
inc abs
inc abs,x
dec
dec dp
dec dp,x
dec abs
dec abs,x
asl
asl dp
asl dp,x
asl abs
asl abs,x
lsr
lsr dp
lsr dp,x
lsr abs
lsr abs,x
rol
rol dp
rol dp,x
rol abs
rol abs,x
ror
ror dp
ror dp,x
ror abs
ror abs,x
and dp
and dp,x
and abs
and abs,x
and abs,y
ora dp
ora dp,x
ora abs
ora abs,x
ora abs,y
eor dp
eor dp,x
eor abs
eor abs,x
eor abs,y
adc dp
adc dp,x
adc abs
adc abs,x
adc abs,y
sbc dp
sbc dp,x
sbc abs
sbc abs,x
sbc abs,y
ldx #imm8
ldy #imm8
ldx dp
ldy dp
stx dp
sty dp
ldx abs
ldy abs
stx abs
sty abs
ldx dp,y
ldy dp,x
stx dp,y
sty dp,x
ldx abs,y
ldy abs,x
sta dp
sta dp,x
sta abs,x
sta abs,y
tax
tay
txa
tya
tsx
txs
inx
dex
iny
dey
clc
sec
cli
sei
clv
cld
sed
beq abs
bne abs
bcc abs
bcs abs
bmi abs
bpl abs
bra abs
bvc abs
bvs abs
pha
pla
php
plp
phx
plx
phy
ply
phb
plb
phd
pld
phk
brk [#imm8]
rti
cop #imm8
wdm #imm8
wai
stp
sta abs
rts
nop
sep #imm8
rep #imm8
jsr abs
jsr (abs,x)
jmp abs
jmp (abs)
jmp (abs,x)
jmp [abs]
```

Unknown opcodes are shown as `DB $xx`.

Use `D` as the normal read-back step after assembly:

```text
* A0300
0300> lda #'A'
0302> sta $F000
0305> rts
0306> end
OK
* D0300
0300 A9 41 LDA #$41
0302 8D 00 F0 STA $F000
0305 60 RTS
0306 00 DB $00
0307 00 DB $00
0308 00 DB $00
0309 00 DB $00
030A 00 DB $00
* G0300
A
Returned
```

The disassembler output has three parts:

```text
address raw-bytes decoded-instruction
```

Examples:

```text
0300 A9 41 LDA #$41
0302 8D 00 F0 STA $F000
0305 60 RTS
0306 00 DB $00
```

The raw byte column is useful because the monitor assembler is intentionally
small. When a new mnemonic is added to `A`, its byte encoding should be visible
through `D` before relying on the program behavior.

For branches, `D` shows the resolved absolute target address rather than the raw
relative offset as the operand:

```text
0480 F0 06 BEQ $0488
0482 D0 FC BNE $0480
```

Monitor-entered test programs and their expected `D`, `G`, `R`, and output
results are recorded in `examples/asm/monitor-programs.md`.

## Minimal Assembly Program

This program prints `A` and returns to the monitor.

```text
* A0300
0300> lda #'A'
0302> sta $F000
0305> rts
0306> end
OK
```

As a byte sequence for the `S` command:

```text
* S0300A9418D00F060
```

Then run it:

```text
* G0300
```

Expected output: `A` printed, then `Returned`, then the prompt.

The host assembler remains useful for ROMs and cross-development, but normal
monitor development should use `A` assembly mode, verify with `D`, and then run
with `G`.

## Monitor ABI

This is the ABI for programs launched from the monitor. Assembly examples and
the future Lovelace monitor output mode must conform to it.

### Entry conditions

```text
Bank:        0 (program must be in bank 0)
Entry:       16-bit address called via the RTS-stack trick (equivalent to JSR)
Accumulator: 8-bit (M = 1)
Index X, Y:  16-bit (X = 0)
Data bank:   0
Stack:       $0100-$01FF, SP valid
```

### Exit

- Return with `RTS`. The monitor resumes at `DO_GO_RETURNED`.
- Output by writing bytes to `CHAR_OUT` at `$F000`.
- Do not assume any zero-page state is preserved across `G` calls; the monitor
  uses `$00–$04` internally.
- Executing `STP` halts the machine permanently.

### Register preservation

The monitor saves A, X, Y, and P immediately when the program returns. The
program may clobber any register freely; the saved values reflect the state at
the moment of `RTS`.

## Current Limitations

These are known gaps in the current monitor implementation.

| Limitation | Detail |
| --- | --- |
| Bank 0 only | All addresses are 16-bit. Programs and data must reside in bank 0. |
| Small assembly/disassembly subset | `A` and `D` support only `lda` immediate/direct page/absolute/long forms, accumulator immediate/direct page/absolute ops (`cmp`, `and`, `ora`, `eor`, `adc`, `sbc`), `cpx`/`cpy` immediate/direct page/absolute forms, `bit` immediate/direct page/absolute forms, `inc`/`dec` accumulator/direct page/absolute forms, `asl`/`lsr`/`rol`/`ror` accumulator/direct page/absolute forms, branch ops (`beq`, `bne`, `bcc`, `bcs`, `bmi`, `bpl`, `bra`, `bvc`, `bvs`) with absolute target syntax, stack push/pull forms, interrupt and machine-control forms (`brk [#imm8]`, `rti`, `cop #imm8`, `wdm #imm8`, `wai`, `stp`), `sta` direct page/absolute/long forms, `rts`, `nop`, `sep #imm8`, `rep #imm8`, `jsr abs`, `jsr (abs,x)`, `jsl long`, `jmp abs`, `jmp (abs)`, `jmp (abs,x)`, `jmp [abs]`, and `jml long`. `A` also supports labels, `NAME .equ` constants, address force modifiers (`<`, `!`, `>`), data entry (`.byte`, `db`, `.word`, `.dw`, `.long`, `.dl`, `.ascii`, `.asciiz`, `.resb`), and native immediate-width directives (`.a8`, `.a16`, `.a32`, `.i8`, `.i16`, `.i32`); `D` renders bytes back as instructions or `DB $xx`, not source-only directives. |
| M shows 16 bytes | A single `M` command displays exactly one 16-byte row. |
| S has no read-back | The `S` command writes silently; use `M` to verify. |
| 63-char line limit | Input lines longer than 63 characters are truncated. |
| No breakpoints | Single-step, breakpoints, and trace are not implemented. |
| No run-on-boot | There is no `--go` shortcut to run a program at startup. |
| Interrupts are stubs | All interrupt vectors point to a single `RTI` handler. |
| No decimal mode guard | Programs that enable decimal mode (`SED`) will confuse arithmetic in the monitor after returning. |
