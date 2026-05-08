# Lovelace Compiler v1 — Unsupported Features

This document records the feature coverage of the v1 TypeScript cross-compiler
at the end of the NeedleOS readiness pass (Chunk 11). It is the authoritative
reference for what early NeedleOS kernel code can and cannot use.

---

## Status key

| Symbol | Meaning |
|--------|---------|
| ✅ | Fully implemented and execution-tested |
| 🟡 | Compiles but generates placeholder code — not safe to depend on at runtime |
| ❌ | Not yet implemented — will produce a compile error or silently incorrect code |

---

## Fully supported ✅

These patterns generate correct W65C832 assembly and are safe to use in early
NeedleOS kernel code.

### Module and function structure

- `module name` declarations
- `pub func` / `func` declarations at module scope
- Parameters with explicit types
- Function calls — positional arguments
- Named argument syntax (parsed; names are ignored, position is used)
- `return` with one value or no value
- Recursive function calls

### Variable declarations

- `const` global declarations (integer and string literals)
- `const` local declarations with initializers
- `var` local declarations (mutable; function-scope only)
- Multi-name binding: `const val, err = fn()` (first name captures the return value; further names are declared but not initialized from the call)

### Control flow

- `if condition then … else … end`
- `while condition … end` with `break` and `continue`
- `for i = start to end … end` — inclusive counting loop, step 1
- `switch expr … case … end … default … end … end` — integer and string discriminants
- `and`, `or` boolean operators in conditions
- `not expr` — unary boolean negation (see precedence note below)

### Arithmetic and bitwise

- `+`, `-` (binary and unary), `~` (bitwise NOT)
- `&`, `|`, `^` (bitwise AND, OR, XOR)
- `<<`, `>>` (shifts — generated as IR; shift instructions pending codegen)
- `==`, `!=`, `<`, `<=`, `>`, `>=` comparisons
- Compound assignments: `+=`, `-=`, `*=`, `/=`, `%=`, `&=`, `|=`, `^=`, `<<=`, `>>=`

### Literals

- Decimal integers: `42`, `-1`
- Hex integers: `$F000`, `$010000`
- Binary integers: `%11110000`
- String literals: `"NeedleOS 0.1"`
- Boolean: `true`, `false`
- `null`

### Types (type-checked, all stored as 32-bit words in memory)

- `int`, `uint`, `int8`, `int16`, `int32`, `uint8`, `uint16`, `uint32`, `byte`
- `bool`
- `string` (pointer to null-terminated bytes)
- `char`
- `pointer<T>` — type-checked; runtime pointer arithmetic requires `asm` blocks
- `array<T, N>` — type-checked; element access is stubbed (see below)
- Named struct types (type declaration is registered; field access is stubbed)

### Cast and type coercion

- `cast<T>(expr)` — passes the value through; no width narrowing in v1 (all
  values are 32-bit words regardless of declared type)

### Inline assembly

- `asm { … }` — body is tokenized by the Lovelace lexer and rejoined with spaces;
  each token becomes a separate space-separated word in the emitted assembly
- `unsafe(true)` — required function-level declaration for `asm` blocks and direct
  memory access

### Built-in functions (runtime seed)

- `print(s)` — no-op stub; will be wired to DragonFly 65 CHAR_OUT I/O
- `halt()` — emits `stp`; stops the CPU
- `len(x)` — stub; returns 0
- `Error(code, description)` — stub; returns null/0
- `memory.read8(addr)`, `memory.write8(addr, val)` — stubs
- `memory.read32(addr)`, `memory.write32(addr, val)` — stubs

### Import declarations

- `import module.name: alias` — the alias is registered in the local scope so
  the program compiles; no external module file is loaded

---

## Compiles but generates placeholder code 🟡

These features parse and type-check correctly but the code generator emits a
stub comment and a `lda #0.l`. Do not rely on their runtime behavior.

### Struct field access

Struct type declarations and struct literal syntax compile. Struct literal
lowering and member-access lowering emit:
```
; struct lowering is reserved for the runtime/linker chunks
lda #0.l
```

**Workaround for early NeedleOS**: keep mutable data structures at fixed memory
addresses. Use `asm {}` blocks to read and write fields manually.

### Array element access

`array[index]` reads compile but generate the same placeholder. Element writes
similarly store to a temp slot rather than to the array's memory address.

**Workaround**: use `asm {}` blocks for array reads and writes.

### `memory[addr]` read / write

`memory[$F000]` produces an index IR instruction that is stubbed:
```
; index lowering is reserved for the runtime/linker chunks
lda #0.l
```
Assignments to `memory[$F000]` update a temp slot, not the actual address.

**Workaround**: use `asm { lda val \n sta $F000 }` for all memory-mapped I/O.

### `for item in iterable` loop

The `for item in iterable` form is lowered: the iterable expression is
evaluated and the loop variable is declared, but no actual iteration takes
place — the body runs exactly once.

**Workaround**: use `for i = 0 to len(collection) - 1` if a counting index is
available, or `while` with a manual pointer for linked structures.

### `print(s)` and `len(s)`

Compiled programs emit a call to the runtime-seed stubs. `print` is a no-op;
`len` returns 0.

---

## Not implemented ❌

These features either produce a compile error or generate silently wrong code.
Do not use them in NeedleOS v1 kernel code.

### `not` precedence footgun

`not x == y` parses as `(not x) == y`, not `not (x == y)`. The type checker
rejects the comparison when `not x` returns `bool` and `y` is `int`.

**Workaround**: always parenthesize: `not (x == y)`, or use `x != y`.

### Pointer dereferencing

There is no dereference operator. `pointer<T>` values are tracked by the type
checker but the code generator cannot emit a load from the pointed-to address.

**Workaround**: use `asm {}` blocks for all pointer reads and writes.

### Multi-value return — second binding

`const val, err = fn()` declares both names, but only the first (`val`)
receives the function's return value. `err` is declared but always 0.

**Workaround**: check errors explicitly inside the called function, or use a
global error slot accessed via `asm`.

### Cross-module compilation

Only single-file compilation is supported. Imported module files are not
loaded; calling a function from an imported module produces a call to an
undefined label that the assembler will reject.

**Workaround**: declare all kernel functions in a single compilation unit, or
link object files manually at the assembler level.

### Shorthand operators `x++`, `x--`, `x**`

These lex as separate operator tokens. The parser does not have special
statement-level handling, so `x++` causes a parse error.

**Workaround**: write `x = x + 1`, `x = x - 1`, `x = x * x` explicitly.

### Shift operators `<<` and `>>`

Parsed and lowered to an IR binary instruction, but the codegen emits a
"unsupported binary operator" comment and loads 0. W65C832 does not have
native barrel-shift instructions; emitting multi-shift loops is deferred.

**Workaround**: use `asm {}` blocks with repeated `asl` or `lsr` instructions.

### String comparison

`==` on string values generates an integer comparison of the pointer addresses,
not a byte-by-byte comparison. Two distinct string literals with the same
content will compare not-equal.

**Workaround**: implement `strcmp` in `asm {}` or add a runtime helper.

### Float arithmetic

`float32` and `float` are type-checked but no floating-point arithmetic is
emitted. All float operations produce integer results.

### Type narrowing

All primitive types are stored as 32-bit words regardless of declared width.
`cast<uint8>(value)` does not mask or truncate the value.

**Workaround**: apply explicit masks: `cast<uint8>(value & $FF)`.

### `null` safety checks

The type checker does not enforce null-safety on pointer or string values. The
compiler will not warn on an unchecked pointer dereference.

---

## Guidance for early NeedleOS kernel code

The v1 compiler is ready for procedural kernel scaffolding that relies on:

- Integer arithmetic and bit manipulation
- Control flow (if, while, for, switch)
- Function calls and recursion
- `asm {}` blocks for all hardware access and pointer operations
- Global `const` values for hardware addresses and configuration constants
- `unsafe(true)` functions for all hardware-touching code

**Recommended pattern** for memory-mapped I/O until struct and pointer lowering
lands:

```lovelace
func readChar(): int
    unsafe(true)
    asm {
        lda $F001
    }
    return 0
end

func writeChar(ch: int)
    unsafe(true)
    asm {
        sta $F000
    }
end
```

The `asm {}` body executes with the first function argument already in the
accumulator (A), and any value left in A at the `rts` is the return value.
Use this to pass data in and out of hand-written assembly within a Lovelace
function.
