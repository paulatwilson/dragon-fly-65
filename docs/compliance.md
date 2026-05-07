# Compliance Notes

This document records how DragonFly 65 should use upstream W65C832-related projects while keeping our own TypeScript implementation clear, reusable, and open-source friendly.

## Goals

- Keep DragonFly 65 itself MIT licensed unless the maintainer explicitly changes that.
- Give visible credit to upstream authors.
- Preserve required notices when using permissively licensed code.
- Avoid accidentally mixing GPL-derived code into MIT-licensed modules.
- Keep our emulator and assembler implementations original where practical.

## W65C832 FPGA Core

Michael Kohn's `w65c832` FPGA core is MIT licensed. DragonFly 65 may use it as a practical implementation reference.

Allowed uses:

- Read the Verilog to understand behavior.
- Create original TypeScript modules that implement the same documented CPU behavior.
- Port small or large parts deliberately, provided derived files preserve the upstream copyright and MIT license notice.
- Build tests from observed behavior, with attribution.

Required practice:

- Prefer idiomatic TypeScript over line-by-line Verilog translation.
- Mark files that are derived from the FPGA core.
- Keep `THIRD_PARTY_NOTICES.md` updated if derived code appears.
- Document any choice where the FPGA behavior differs from the WDC datasheet.

## naken_asm

Michael Kohn's `naken_asm` is GPL-3.0 licensed. DragonFly 65 can use it as a compatibility and syntax reference, but GPL code must not be copied into the MIT codebase by accident.

Allowed uses:

- Read documentation and behavior to understand expected assembler syntax.
- Use `naken_asm` as an external developer tool.
- Compare output from our own assembler against `naken_asm` in tests, if the tool is installed separately.
- Write original TypeScript assembler code from the WDC syntax rules, our own design notes, and observed expected behavior.

Not allowed without an explicit licensing decision:

- Copying GPL source into `src/`.
- Translating GPL implementation code file-by-file into TypeScript.
- Vendoring `naken_asm` into this repository as if it were MIT code.
- Linking or packaging GPL-derived code into the reusable MIT assembler without documenting the resulting GPL obligations.

## Clean Implementation Rule

For the emulator and assembler, prefer this workflow:

1. Read upstream docs, datasheets, and behavior notes.
2. Write a DragonFly 65 design note describing the behavior in our own words.
3. Implement from that design note in TypeScript.
4. Add focused tests.
5. Credit any upstream behavior source in docs or comments where useful.

When direct porting is genuinely the right choice, do it deliberately: add attribution in the source file, update `THIRD_PARTY_NOTICES.md`, and confirm the license is compatible with the target module.

