# Compliance Notes

This document records how DragonFly 65 should use upstream W65C832-related projects while
keeping our own TypeScript implementation clear and correctly attributed.

## Goals

- DragonFly 65 is licensed under GPL-3.0-only.
- Give visible credit to upstream authors.
- Preserve required notices when using or porting upstream code.
- Keep our emulator and assembler implementations original where practical.

## W65C832 FPGA Core

Michael Kohn's `w65c832` FPGA core is MIT licensed. DragonFly 65 may use it as a practical
implementation reference and may port from it with attribution.

Allowed uses:

- Read the Verilog to understand behavior.
- Create original TypeScript modules that implement the same documented CPU behavior.
- Port small or large parts deliberately, provided derived files preserve the upstream copyright
  and MIT license notice.
- Build tests from observed behavior, with attribution.

Required practice:

- Prefer idiomatic TypeScript over line-by-line Verilog translation.
- Mark files that are derived from the FPGA core.
- Keep `THIRD_PARTY_NOTICES.md` updated if derived code appears.
- Document any choice where the FPGA behavior differs from the WDC datasheet.

## naken_asm

Michael Kohn's `naken_asm` is GPL-3.0 licensed. DragonFly 65 is also GPL-3.0, so porting from
`naken_asm` is permitted provided attribution is maintained.

Allowed uses:

- Read documentation and behavior to understand expected assembler syntax.
- Port TypeScript assembler code from `naken_asm` with attribution.
- Use `naken_asm` as an external developer tool for testing and comparison.
- Compare output from our own assembler against `naken_asm` in tests.

Required practice when porting from naken_asm:

- Preserve Michael Kohn's copyright notice in any derived source file.
- Record the upstream file path and commit reference in `THIRD_PARTY_NOTICES.md`.
- Prefer re-implementing in idiomatic TypeScript over mechanical line-by-line translation.

## Clean Implementation Rule

For the emulator and assembler, prefer this workflow:

1. Read upstream docs, datasheets, and behavior notes.
2. Write a DragonFly 65 design note describing the behavior in our own words.
3. Implement from that design note in TypeScript.
4. Add focused tests.
5. Credit any upstream behavior source in docs or comments where useful.

When direct porting is the right choice, do it deliberately: add attribution in the source
file, update `THIRD_PARTY_NOTICES.md`, and confirm the license is compatible.
