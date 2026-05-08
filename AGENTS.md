# AGENTS.md

## Project

DragonFly 65 is a hypothetical W65C832-inspired computer, operating system, and SSH-accessible environment written in TypeScript for Bun.

The project is intended to become an open-source system that can run on Fly.io.

## Commands

- Install dependencies: `bun install`
- Run locally: `bun run dev`
- Run tests: `bun test`
- Typecheck: `bun run typecheck`

## Bootstrapping

The full system bootstraps in layers. Each layer depends on the one before it.
This is the authoritative build order for the project.

```text
Layer 1 — Tooling (TypeScript / Bun, runs on host machine)
  ✅ W65C832 emulator         src/emulator/
  ✅ W65C832 assembler        src/assembler/
  ✅ Assembler CLI / REPL
  [ ] Disassembler
  [ ] Lovelace compiler v1    src/compiler/   (TypeScript cross-compiler)
                              Reads .lace source, emits W65C832 binary
  [ ] SSH server              First Lovelace pilot project after compiler v1
  [ ] Lovelace VS Code extension
                              Syntax highlighting, diagnostics, commands

Layer 2 — Monitor (W65C832 assembly, runs in emulator / on hardware)
  ✅ Basic machine monitor   Written in W65C832 assembly
                              Memory inspect, load, run — minimal shell

Layer 3 — NeedleOS kernel (Lovelace source, compiled by Layer 1 compiler)
  [ ] NeedleOS kernel         Written in Lovelace
                              Memory management, task scheduler, filesystem,
                              interrupt handling, device drivers

Layer 4 — Self-hosting (Lovelace compiler rewritten in Lovelace)
  [ ] Lovelace compiler v2    Written in Lovelace
                              Compiled by v1 → produces native W65C832 binary
                              DragonFly 65 can now compile Lovelace on-device

Layer 5 — Platform (Fly.io deployment)
  [ ] Deploy to Fly.io
```

The Lovelace language design is complete — see `docs/lovelace-language-design.md`.

## Active Plans

- Processor emulator chunks are tracked in `docs/emulator-roadmap.md`.

## Roadmap

### ✅ W65C832 emulator

Complete. Details in `docs/emulator-roadmap.md`.

### W65C832 assembler

- [x] Core assembler (`src/assembler/`) — two-pass cross-assembler, 138 tests
  - Full W65C816 + W65C832 instruction set (all 256 opcodes)
  - Directives: `.org`, `.db`, `.dw`, `.dl`, `.ascii`, `.asciiz`, `.resb`, `.equ`, `.65816`, `.65832`, `.a8`, `.a16`, `.a32`, `.i8`, `.i16`, `.i32`
  - Address auto-selection (dp/abs/long) with `<`, `!`, `>` force modifiers
  - Two-pass label resolution with forward reference support
  - REP/SEP auto-track accumulator/index width for correct immediate encoding
  - Opcode table derived from Michael Kohn's `naken_asm` (GPL-3.0, with attribution)
- [x] Assembler CLI / REPL interface (`src/assembler/cli.ts`, `bun run asm`)
  - CLI: `bun run asm input.asm [-o output.bin] [--hex]`
  - REPL: `bun run asm` or `bun run asm --repl` — interactive, shows bytes per line
  - REPL commands: `.hex`, `.symbols`, `.list`, `.save`, `.load`, `.origin`, `.reset`
- [ ] Disassembler

- Informed by Michael Kohn's open-source `naken_asm`: <https://github.com/mikeakohn/naken_asm>. Give full credit to Michael Kohn and the `naken_asm` project wherever this work is documented.
- When porting from `naken_asm`, preserve Michael Kohn's copyright notice and document which parts are derived in `THIRD_PARTY_NOTICES.md`.

### ✅ Lovelace language design

Complete. Core language decisions documented in `docs/lovelace-language-design.md`.
Source files use the `.lace` extension.

### Lovelace compiler v1 (TypeScript cross-compiler)

Reads `.lace` source on the host machine, emits W65C832 binary. Runs on Bun.
This is the compiler used to build NeedleOS and the self-hosting v2 compiler.

- [x] Chunk 0 — Compiler project scaffold (`src/compiler/`)
  - Public compiler API
  - Shared result/error types
  - Test fixtures for `.lace` source files
  - Bun test coverage wired in from the start
- [x] Chunk 1 — Lexer
  - Tokenize keywords, identifiers, literals, operators, comments, punctuation, and newlines
  - Preserve source spans for useful compiler diagnostics
  - Cover examples from `docs/lovelace-language-design.md`
- [ ] Chunk 2 — Parser
  - Build an AST for modules, constants, variables, functions, blocks, statements, and expressions
  - Support `end`-terminated syntax, typed parameters, return types, and nested control flow
  - Report clear parse errors with line/column information
- [ ] Chunk 3 — Semantic analysis
  - Symbol table and lexical scopes
  - Visibility rules for `pub`
  - Reject global `var`
  - Validate function calls, assignments, returns, `break`, and `continue`
- [ ] Chunk 4 — Type checker
  - Primitive types, aliases, pointers, arrays, structs, and `void`
  - Type inference for obvious `const` and `var` initializers
  - Cast validation and type-strict comparisons
  - Function result/error pair model
- [ ] Chunk 5 — Intermediate representation
  - Lower AST into a simple typed IR before assembly generation
  - Normalize control flow, temporary values, labels, calls, and returns
  - Keep the IR small enough to later port to Lovelace v2
- [ ] Chunk 6 — W65C832 code generator
  - Emit W65C832 assembly for expressions, locals, calls, returns, branches, and loops
  - Follow the documented W65C832 calling convention
  - Generate stable labels and data sections
- [ ] Chunk 7 — Assembler and linker integration
  - Feed generated assembly into `src/assembler/`
  - Select entry point at build/link time
  - Emit binary images suitable for emulator loading
- [ ] Chunk 8 — Compiler CLI
  - `bun run lace input.lace -o output.bin`
  - Optional assembly output for debugging
  - Diagnostics formatted for terminal use
- [ ] Chunk 9 — Runtime and standard-library seed
  - Minimal runtime symbols required by compiled programs
  - Built-ins such as `len()`, `Error()`, and basic memory helpers
  - Clear boundary between compiler built-ins and Lovelace standard library
- [ ] Chunk 10 — Emulator execution tests
  - Compile small Lovelace programs
  - Assemble and load them into the emulator
  - Verify return values, memory writes, function calls, and control flow
- [ ] Chunk 11 — NeedleOS readiness pass
  - Compile enough Lovelace to start the NeedleOS kernel work
  - Document unsupported language features
  - Mark v1 compiler as usable for early OS code

### SSH server and Fly.io deployment

First real Lovelace application after compiler v1. Use this to exercise the
language, compiler, assembler, emulator, and monitor boundary before starting
the full NeedleOS kernel.

- [ ] Basic Auth System for Monitor
- [ ] SSH server in Lovelace
- [ ] Connect to monitor to allow remote connection to it
- [ ] Deploy to Fly.io

### Lovelace VS Code extension

Editor support for `.lace` source files. This should reuse the v1 compiler's lexer,
parser, and diagnostics instead of maintaining a separate language implementation.

- [ ] Extension scaffold
  - VS Code extension package and activation events
  - `.lace` language registration
  - Workspace settings for compiler path and build output
- [ ] Syntax highlighting
  - TextMate grammar for Lovelace keywords, literals, comments, types, functions, and inline assembly
  - Lovelace file icon and language configuration
  - Bracket, quote, and comment rules
- [ ] Diagnostics
  - Surface compiler lexer/parser/type errors in the editor
  - Preserve line/column spans from `src/compiler/`
  - Keep diagnostics fast enough for normal editing
- [ ] Editor commands
  - Build current `.lace` file
  - Build project
  - Emit assembly for current file
  - Run compiled binary in the DragonFly 65 emulator
- [ ] Language features
  - Outline symbols for modules, constants, structs, and functions
  - Go to definition for local symbols
  - Hover type information for checked programs
  - Basic completion for keywords and visible symbols
- [ ] Packaging
  - Document local extension development
  - Add extension tests
  - Prepare open-source publishing metadata

### ✅ Basic machine monitor (W65C832 assembly)

Interactive monitor written in W65C832 assembly. Runs in the emulator (and
eventually on hardware). Commands: H (help), M (memory dump), S (set bytes),
G (JSR to address, RTS returns to monitor), R (show saved registers).

- `monitor/monitor.asm` — source; `bun run monitor` to run
- `src/machine/` — Machine class wrapping CPU + memory-mapped I/O
- 9 integration tests in `test/monitor.test.ts`

### Lovelace compiler v2 (self-hosting)

The Lovelace compiler rewritten in Lovelace. Compiled by v1 to produce a native
W65C832 binary. Once complete, DragonFly 65 can compile Lovelace code on-device.

### NeedleOS kernel (Lovelace)

The operating system for DragonFly 65, written in Lovelace and compiled by v1.

- [ ] Memory allocator (`system.allocator`)
- [ ] Task scheduler
- [ ] Filesystem
- [ ] Interrupt handling
- [ ] Device drivers
- [ ] NeedleOS shell

## Guidelines

- Prefer small, focused changes that match the existing project structure.
- Follow `docs/emulator-roadmap.md` when working on the W65C832 emulator. Complete one chunk at a time and keep tests close to the behavior being added.
- Keep the W65C832 emulator reusable as an independent TypeScript library. Do not couple `src/emulator/` to DragonFly 65 OS, SSH, Fly.io, or server concerns.
- Keep CPU clock behavior externally configurable. DragonFly 65's fictional 40 MHz variant belongs in app/machine config, while the reusable emulator only validates and reports supplied clock metadata.
- Keep TypeScript strict and explicit around CPU, memory, operating system, and network state.
- Add tests for emulator, operating system, SSH, and protocol behavior as those areas are introduced.
- Document invented architecture decisions in `docs/`.
- Do not treat real W65C832 behavior as guessed fact. Verify it, cite it in docs, or clearly mark the behavior as DragonFly 65-specific design.
- Keep runtime assumptions compatible with Bun and container deployment.
- Keep `THIRD_PARTY_NOTICES.md` and `docs/compliance.md` accurate when using upstream code or behavior.

## Open Source

- Keep public-facing files clear and welcoming.
- The project is licensed under GPL-3.0-only.
- Use issues or design documents for large architecture decisions before implementation.
- Treat Michael Kohn's MIT `w65c832` core as portable with attribution. GPL-3.0 `naken_asm` code may be ported into DragonFly 65 with attribution, since both projects are now GPL-3.0.
