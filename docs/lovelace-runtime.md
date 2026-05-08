# Lovelace Runtime Seed

Chunk 9 defines the boundary between compiler built-ins and the future Lovelace
standard library.

The TypeScript v1 compiler owns a tiny runtime seed so compiled programs can link
against known symbols before NeedleOS and the Lovelace standard library exist.
These symbols are listed in `src/compiler/runtime.ts` and are used by semantic
analysis, type checking, and code generation.

## Runtime Seed Symbols

- `print(value)` — placeholder console output hook.
- `halt()` — stops the processor with `stp`.
- `len(value)` — placeholder string/array length hook.
- `Error(code, description)` — placeholder error value constructor.
- `memory.read8(address)` / `memory.write8(address, value)` — placeholder byte memory helpers.
- `memory.read32(address)` / `memory.write32(address, value)` — placeholder 32-bit memory helpers.

## Boundary

The runtime seed is intentionally small. It provides linkable symbols and stable
type signatures only. Real console I/O, allocator-backed error objects, length
calculation, and memory ABI behavior belong in the Lovelace standard library and
NeedleOS runtime work.

Code generation emits only the runtime stubs actually used by a program.
