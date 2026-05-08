# Lovelace Language Design Notes

## Overview

**Lovelace** is a statically typed procedural systems programming language designed for the
DragonFly 65 computer platform and the NeedleOS operating system.

Source files use the `.lace` extension.

The language is intended to be:

- Simple
- Readable
- Deterministic
- Efficient
- Small enough to fully understand
- Powerful enough to write an operating system

Lovelace takes inspiration from:

- C
- Oberon
- Modula-2
- Go
- Swift
- JavaScript/TypeScript

However, Lovelace deliberately avoids unnecessary complexity.

---

# Core Philosophy

```text
Clear enough to read.
Sharp enough to build an operating system.
```

## Design Goals

- Small keyword set
- Static typing with type inference
- Immutable by default
- No hidden behaviour
- No global mutable state
- Explicit error handling
- Direct hardware access
- Inline assembly support
- Readable syntax
- Tiny compiler
- Self-hosting (the Lovelace compiler is written in Lovelace)

---

# Bootstrapping

Lovelace is designed to be self-hosting. The bootstrapping path is:

1. Write the Lovelace compiler in TypeScript (cross-compiler running on Bun)
2. Rewrite the compiler in Lovelace itself
3. Use the TypeScript compiler to compile the Lovelace-written compiler
4. The result is a native W65C832 binary that is the Lovelace compiler
5. DragonFly 65 can now compile Lovelace code on-device

---

# Variable Model

Lovelace uses only two variable keywords:

| Keyword | Meaning          |
|---------|------------------|
| `const` | Immutable value  |
| `var`   | Mutable value    |

## `const`

`const` values cannot be reassigned. The compiler determines whether the value is a
compile-time constant or a runtime immutable binding.

```lovelace
const SCREEN_WIDTH = 640
const VERSION = "0.1"
const username = getUser()
```

### Global Constants

`const` values may exist at module scope and are globally accessible within that module.

```lovelace
const VIDEO_MEMORY = $A000
const MAX_PROCESSES = 256
```

---

## `var`

`var` values are mutable and local-only. Global mutable variables are forbidden.

```lovelace
func draw()

    var x = 0
    var y = 0
    x = x + 1

end
```

The following is invalid:

```lovelace
var globalCounter = 0   // ERROR: global mutable state is not permitted
```

This prevents hidden state, race conditions, and unpredictable behaviour.

---

# Type System

Lovelace is statically typed with type inference where the type is obvious.

```lovelace
const name = "NeedleOS"    // inferred as string
var counter = 0             // inferred as int (32-bit native)
```

Explicit typing is always available:

```lovelace
const name: string = "NeedleOS"
var counter: int = 0
```

Numeric literals default to the native type (`int` or `float`). Use an explicit type
annotation or `cast` when a specific width or reinterpretation is required:

```lovelace
var flag: uint8 = 0
var port = cast<uint16>(0x8000)
var ratio: float32 = cast<float32>(0.5)
var addr: pointer<byte> = cast<pointer<byte>>(0xA000)
```

## Integer Types

| Type     | Description                             |
|----------|-----------------------------------------|
| `int8`   | Signed 8-bit integer                    |
| `int16`  | Signed 16-bit integer                   |
| `int32`  | Signed 32-bit integer                   |
| `uint8`  | Unsigned 8-bit integer                  |
| `uint16` | Unsigned 16-bit integer                 |
| `uint32` | Unsigned 32-bit integer                 |
| `int`    | Native integer size (32-bit on W65C832) |
| `uint`   | Native unsigned integer (32-bit)        |
| `byte`   | Alias for `uint8`                       |

## Floating Point Types

| Type      | Description                                        |
|-----------|----------------------------------------------------|
| `float32` | 32-bit floating point (software-emulated on W65C832 — carries a performance cost) |
| `float`   | Alias for `float32`                                |

## Boolean Type

| Type   | Description           |
|--------|-----------------------|
| `bool` | Boolean true/false    |

## String Type

| Type     | Description                                                       |
|----------|-------------------------------------------------------------------|
| `string` | Null-terminated byte sequence. A `string` is a pointer to bytes ending in `0x00`. Passes in a single register. |
| `char`   | Single byte character                                             |

## Built-in String Operations

Two zero-cost operations are built into the language. Everything else (concat,
substring, split, etc.) lives in the standard library, where allocation is explicit.
`len()` works on both strings and arrays.

```lovelace
const name = "NeedleOS"
const length = len(name)   // count bytes to null terminator
const first  = name[0]     // read a single char by index

var buffer: array<byte, 256>
const size = len(buffer)   // 256
```

## Structured Types

| Type          | Description                                                 |
|---------------|-------------------------------------------------------------|
| `struct`      | Structured data type                                        |
| `pointer<T>`  | Typed pointer — also used for heap arrays (`pointer<byte>`) |
| `array<T, N>` | Fixed-size stack array                                      |

## Special Types

| Type   | Description |
|--------|-------------|
| `void` | No value    |

`any` and `json` are not language-level types. JSON parsing and dynamic values are
handled through the standard library.

---

# Functions

```lovelace
func boot()

    print("Starting NeedleOS")

end
```

Functions that return a value declare the return type after the parameter list:

```lovelace
func add(a: int, b: int): int

    return a + b

end
```

Parameters may have default values. Defaults must be compile-time constants.

```lovelace
func connect(host: string, port: int = 80): bool

    return open(host, port)

end

connect("localhost")                    // port defaults to 80
connect("localhost", 8080)              // positional
connect(host: "localhost", port: 8080)  // named — recommended
```

## Visibility

Nothing is visible outside a module unless marked `pub`. This applies to functions,
types, and constants.

```lovelace
module Kernel.Memory

pub func alloc(size: int): pointer<byte>
pub type Block = struct
    size: int
    next: pointer<Block>
end

const HEAP_START = $010000   // private to this module
func coalesce()              // private to this module
```

## Entry Point

There is no required `main` function. The entry point is any public function,
specified to the linker or build system at link time:

```lovelace
pub func boot()
    // this becomes the entry point if the linker is told to start here
end
```

This keeps the language free of magic function names. The OS or bootloader decides
what gets called first.

## Calling Convention (W65C832)

- First argument → accumulator (A, 32-bit in native mode)
- Additional arguments → pushed on the stack, right to left
- Return value → accumulator (A)
- Caller cleans up the stack after the call returns

---

# Error Handling

Every Lovelace function implicitly returns two values: a result and an error.
You never declare this — it is always present.

If the function succeeds, the error is `null`.
If the function fails, the error has `.code` and `.description`.

## Signalling an error

```lovelace
func readFile(path: string): string

    if path == null then
        return null, Error(404, "Path is null")
    end

    return data

end
```

## Handling an error at the call site

```lovelace
const data, err = readFile("/boot/config")

if err != null then
    print(err.description)
    halt()
end
```

## Ignoring the error

```lovelace
boot()
```

## Discarding a return value

```lovelace
const _, err = readFile("/boot/config")
```

## The Error type

```lovelace
type Error = struct
    code: int
    description: string
end
```

---

# Memory Model

Lovelace has two memory regions:

## Stack

Function-local `var` and `const` values, arguments, and return values live on the
hardware stack. Automatic and zero-cost. Values are gone when the function returns.

## Heap

Explicitly allocated via the `system.allocator` module. Returns a `pointer<T>`.
Freed explicitly with `mem.free(p)`. No garbage collector. You own it, you free it.
Moving allocation to a module means the allocator can be swapped without touching
the language.

```lovelace
import system.allocator: mem

const process: pointer<Process> = mem.alloc<Process>()
process.id = 1
process.state = RUNNING

mem.free(process)
```

---

# Arrays

## Stack Array

Fixed size known at compile time. Lives on the stack.

```lovelace
var buffer: array<byte, 256>
buffer[0] = $ff
```

## Heap Array

Allocated explicitly. Size may be a runtime value.

```lovelace
import system.allocator: mem

const buffer: pointer<byte> = mem.alloc<byte>(size)
buffer[0] = $ff
mem.free(buffer)
```

---

# Structs

## Defining a struct

```lovelace
type Process = struct
    id: int
    state: int
end
```

## Stack struct — named fields at creation

```lovelace
const p = Process { id: 1, state: RUNNING }
```

## Heap struct — allocate then assign fields

```lovelace
import system.allocator: mem

const p: pointer<Process> = mem.alloc<Process>()
p.id = 1
p.state = RUNNING
```

Field access uses dot notation in both cases:

```lovelace
print(p.id)
print(p.state)
```

Pointers are automatically dereferenced when accessing fields.

---

# Modules

Module names map directly to file paths. `import system.console` resolves to
`system/console.lace` relative to the source root.

An optional alias can be given with `:`:

```lovelace
module Kernel.Memory

import system.console
import system.allocator: mem   // accessible as mem.alloc(), mem.free() etc.
```

---

# Control Flow

## If / else

```lovelace
if ready then
    start()
else
    halt()
end
```

## While

```lovelace
while running

    tick()

end
```

## For — counting loop

Both bounds are inclusive. `for i = 0 to 255` runs 256 times, with `i` reaching 255.
The loop variable defaults to `int`. An explicit type can be declared with `:`.

```lovelace
for i = 0 to 255
    process(i)
end

for i: uint8 = 0 to 255
    process(i)
end
```

## For — iterator loop

Any type that implements the iterator protocol can be used in a `for in` loop.

```lovelace
for item in processList
    tick(item)
end

for char in name
    print(char)
end
```

The iterator protocol is defined in the standard library.

## Switch

Works on `string`, `int`, and `char`. Cases do not fall through. Each `case` block
ends automatically. One value per `case`. Comparison is type-strict — cast first if
types differ. Compiler warns if `default` is missing.

```lovelace
switch command

    case "quit"
        shutdown()
    end

    case "reboot"
        reboot()
    end

    default
        print("Unknown command")
    end

end
```

## Break and continue

```lovelace
while running

    if done then
        break
    end

    if skip then
        continue
    end

    tick()

end
```

---

# Operators

| Category            | Operators                                                      |
|---------------------|----------------------------------------------------------------|
| Arithmetic          | `+`, `-`, `*`, `/`, `%`                                       |
| Comparison          | `==`, `!=`, `<`, `>`, `<=`, `>=`                              |
| Boolean             | `and`, `or`, `not`                                            |
| Bitwise             | `&`, `\|`, `^`, `~`, `<<`, `>>`                               |
| Assignment          | `=`                                                           |
| Compound assignment | `+=`, `-=`, `*=`, `/=`, `%=`, `&=`, `\|=`, `^=`, `<<=`, `>>=`|
| Shorthand           | `x++`, `x--`, `x**`                                          |
| Address-of          | `&` (unary — binary `&` is bitwise AND)                       |

## Shorthand Operators

Shorthand operators are **statement-only** — they cannot be used inside an expression.
This avoids the hidden pre/post increment ambiguity found in C.

| Shorthand | Meaning              | Equivalent        |
|-----------|----------------------|-------------------|
| `x++`     | Increment x by 1     | `x = x + 1`       |
| `x--`     | Decrement x by 1     | `x = x - 1`       |
| `x**`     | Square x             | `x = x * x`       |

```lovelace
var i = 0
i++          // i is now 1
i--          // i is now 0
i**          // i is now 0 (0 * 0)

var n = 4
n**          // n is now 16 (4 * 4)
```

---

# Comments

```lovelace
// single line comment

/*
    multi-line comment
    useful for documentation blocks
*/

const VERSION = "0.1"  // inline comment
```

---

# Pointers

```lovelace
const window: pointer<Window> = &mainWindow
```

Pointers are automatically dereferenced when accessing fields:

```lovelace
window.width = 800
```

Direct memory access:

```lovelace
memory[$D000] = value
```

---

# Unsafe Functions

Raw pointer arithmetic, direct memory access, and `asm` blocks are only permitted
inside functions declared with `unsafe(true)`. The compiler refuses to compile them
without it, forcing a conscious opt-in.

```lovelace
func writeHardware()
    unsafe(true)

    memory[$D000] = value
    asm { sei }
end
```

`unsafe(true)` applies to the entire function body.

---

# Inline Assembly

```lovelace
asm {
    sei
    lda #$00
    sta $D020
}
```

Inline assembly uses the same W65C832 syntax as the Lovelace assembler. Used for
interrupts, hardware control, and direct CPU feature access. Requires `unsafe(true)`.

---

# Template Strings

```lovelace
print(`NeedleOS ${VERSION} — loaded ${count} modules in ${time} ms`)
```

---

# Example Program

```lovelace
module System.Boot

import system.console
import system.fs

const VERSION = "0.1"

pub func boot()

    const data, err = fs.readFile("/system/config")

    if err != null then
        print(err.description)
        halt()
    end

    var loaded = 0
    loaded = loaded + 1

    print(`NeedleOS ${VERSION}`)
    print(`Loaded ${loaded} modules`)

    asm {
        sei
    }

end
```

---

# Keywords

Keywords are lowercase. Module names and standard library identifiers use
dot-separated lowercase names (`system.console`, `kernel.memory`).

## Full Keyword List

```text
module    import    pub
const     var       type      struct
func      return
if        then      else
while     for       in        to
break     continue
switch    case      default
end
asm       unsafe
pointer
true      false     null
and       or        not
cast
```

## Reserved for Future Use

```text
atomic
shared
```

---

# Status

## Decided

- Language name: Lovelace, source files `.lace`
- Bootstrapping: self-hosting via TypeScript cross-compiler
- Variable model: `const` / `var`, no global mutable state
- Type system: static with inference, native `int`/`float` default
- String representation: null-terminated byte sequences
- Float: software-emulated `float32` only
- Memory model: stack + explicit heap via `system.allocator` module (`alloc`/`free`) — swappable without language changes
- Arrays: stack `array<T, N>` and heap `array<T>`
- Struct creation: named fields `{}` for stack, field assignment for heap
- Error handling: implicit `(value, error)` return, `Error(code, description)`; `_` discards return values only — not valid in loop variables
- Module system: file-path based, dots as directory separators; optional alias with `import module.name: alias`
- Visibility: explicit `pub`, everything else private to the module
- Calling convention: first arg in A register, rest on stack, return in A
- Recursion: supported but compiler warns — stack depth is limited on W65C832
- Function pointers: not a language feature — use `asm` blocks for dispatch tables and interrupt handlers
- `unsafe(true)`: function-level declaration required to use raw pointers, direct memory access, or `asm` blocks — forces conscious opt-in
- Variadic functions: not supported — all functions have a fixed, declared parameter list
- Default parameter values: supported — e.g. `func connect(host: string, port: int = 80)`
- Named arguments: both positional and named (`connect(host: "localhost", port: 8080)`) are valid — named style recommended for clarity
- Nested functions: not supported — all functions are declared at module scope
- Entry point: no required `main` — any public function, specified to the linker at link time
- Loops: `while`, `for i = 0 to N` (inclusive, step always 1 — use `while` for custom step), `for item in collection` (iterator protocol)
- Switch: works on `string`, `int`, `char` — one value per case, type-strict, no fallthrough, compiler warns if `default` is missing
- Operators: symbolic arithmetic/comparison, word-based boolean, bitwise (`&`, `|`, `^`, `~`, `<<`, `>>`) — built-in types only, no operator overloading
- Compound assignment: `+=`, `-=`, `*=`, `/=`, `%=`, `&=`, `|=`, `^=`, `<<=`, `>>=`
- Shorthand operators (statement-only): `x++` (increment), `x--` (decrement), `x**` (square)
- Type aliases: documentation sugar only — `type Pid = int` is interchangeable with `int` at the type-checker level
- Casting: `cast<T>(value)` — explicit keyword form, easy to spot in code
- Null safety: compiler warns if a pointer or string is used without a prior null check
- Integer overflow: compiler warns when overflow is detectable at compile time; runtime wraps silently (hardware behaviour)
- Compile-time constants: constant expressions (`BUFFER_START + BUFFER_SIZE`) are evaluated at compile time — no runtime cost
- String built-ins: `len(s)` and `s[i]` only — allocation-dependent operations (concat, split, etc.) go to the standard library
- `len()` works on both strings and arrays
- Bounds checking: compiler warns on out-of-bounds array/string access when detectable at compile time
- `print()` is a built-in — no import required
- `halt()` is a built-in — stops execution immediately
- Comments: `//` and `/* */`
- Inline assembly: `asm {}` blocks using W65C832 syntax
- `json` and `any` moved to standard library

## Still To Design

- Memory allocator implementation
- Concurrency model
- Multitasking APIs
- Filesystem APIs
- Kernel ABI
- Graphics APIs
- Standard library
- Boot process
- NeedleOS shell
- Debugger
- Linker and object format
- Build system
- Foreign function interface
- Interrupt handling APIs
- Scheduler design
- Device driver model

---

# Assembler Notes

Lovelace inline assembly syntax matches the DragonFly 65 assembler, which is informed
by Michael Kohn's open-source `naken_asm` (GPL-3.0):

https://github.com/mikeakohn/naken_asm

This provides existing 65xx syntax support, W65C832 extensions, and interoperability
with standalone assembly modules.
