# DragonFly 65 Monitor

The DragonFly 65 monitor is the first interactive software environment for the
machine. It is written in W65C832 assembly and is intended to behave like the
initial firmware monitor on early personal computers: after boot, the user lands
at a prompt, can inspect memory, write bytes, run code, and return to the
monitor.

Source: `monitor/monitor.asm`

Run current monitor build:

```sh
bun run monitor
```

## Current Status

The monitor exists and is test-covered, but it is not yet packaged as a complete
"bootable computer" workflow.

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

Missing:

- A named `bun run computer` entrypoint that clearly represents booting the
  DragonFly 65 computer.
- A documented host-side binary loader workflow.
- A monitor-aware assembler output workflow.
- Stable examples for loading and running assembly programs.
- A documented monitor ABI for compiled languages such as Lovelace.

## Memory Map

The monitor currently uses bank 0 and a 64 KiB machine profile.

```text
$0000-$01FF   zero page + hardware stack
$0200-$0260   monitor work RAM
$0300-$BFFF   user program RAM
$C000-$DFFF   user program RAM / expansion area
$E000-$EFFF   monitor ROM
$F000-$F002   memory-mapped I/O
$F003-$FFFF   RAM, including vectors
```

Memory-mapped I/O:

```text
$F000  CHAR_OUT   write byte to terminal
$F001  CHAR_IN    read next input byte, or $FF if no input is queued
$F002  CHAR_STS   read 1 if input is available, otherwise 0
```

## Boot Behavior

The current monitor runner:

1. Assembles `monitor/monitor.asm`.
2. Loads the assembled bytes at the monitor origin, currently `$E000`.
3. Sets the reset vector at `$FFFC-$FFFD` to the monitor origin.
4. Resets the CPU.
5. Runs instructions until stopped or interrupted.

On monitor entry, the monitor:

- switches out of initial emulation state,
- sets up the hardware stack,
- sets data bank 0,
- prints the banner,
- enters the prompt loop.

## CPU Conventions

The monitor expects:

```text
Accumulator: 8-bit
Index:       16-bit
Data bank:   0
Stack:       $0100-$01FF
```

Programs launched with `G` should preserve enough machine state to return
cleanly. The simplest valid monitor-launched program ends with `RTS`.

## Commands

The monitor command format is intentionally compact. Commands are entered at
the `*` prompt. Hex values are packed directly after the command letter.

### `H`

Show help.

```text
* H
```

### `M`

Dump 16 bytes of memory starting at a 16-bit address.

Format:

```text
MAAAA
```

Example:

```text
* M0300
```

### `S`

Set memory bytes at a 16-bit address.

Format:

```text
SAAAADD...
```

Where:

- `AAAA` is the destination address.
- `DD...` is one or more data bytes encoded as hex pairs.

Example:

```text
* S0300A9418D00F060
```

This writes bytes at `$0300`.

### `G`

Run code at a 16-bit address using `JSR`.

Format:

```text
GAAAA
```

Example:

```text
* G0300
```

The launched program should return with `RTS`. After return, the monitor prints
`Returned` and saves register state for the `R` command.

### `R`

Show saved register state from the last returned `G` command.

```text
* R
```

If no program has returned yet, the monitor reports that no program data is
available.

## Minimal Assembly Program

This program prints `A` and returns to the monitor.

```asm
    .65816
    .org $0300

    lda #'A'
    sta $F000
    rts
```

Build as a binary:

```sh
bun run asm examples/asm/hello.asm -o /tmp/hello.bin
```

Current manual monitor loading uses the `S` command with hex bytes. A proper
host loader is a required next milestone.

## Monitor ABI

This is the initial ABI for programs launched from the monitor.

Entry:

- Program is loaded in bank 0.
- Program entry is a 16-bit address.
- Monitor calls the entry address with `JSR`.
- Accumulator is 8-bit.
- Index registers are 16-bit.
- Data bank is 0.

Exit:

- Program returns to the monitor with `RTS`.
- Program output is produced by writing bytes to `$F000`.
- A program that executes `STP` stops the machine instead of returning to the
  monitor.

This ABI is the target that assembly examples and future Lovelace monitor
output should support.
