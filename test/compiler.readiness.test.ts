import { describe, expect, it } from "bun:test";
import { compileLovelace } from "../src/compiler";

function compile(source: string) {
  return compileLovelace(source);
}

function compileOk(source: string) {
  const result = compile(source);
  if (!result.ok) {
    throw new Error(result.diagnostics.map(d => d.message).join("; "));
  }
  return result.value;
}

// ---------------------------------------------------------------------------
// Supported patterns
// ---------------------------------------------------------------------------

describe("NeedleOS readiness — kernel boot patterns", () => {
  it("compiles the kernel_boot fixture", async () => {
    const source = await Bun.file("test/fixtures/lovelace/kernel_boot.lace").text();
    const out = compileOk(source);
    expect(out.assembly).toContain("lace_fn_boot");
    expect(out.assembly).toContain("sei");
    expect(out.assembly).toContain("jsr lace_fn_print");
  });

  it("compiles the task_sched fixture", async () => {
    const source = await Bun.file("test/fixtures/lovelace/task_sched.lace").text();
    const out = compileOk(source);
    expect(out.assembly).toContain("lace_fn_tick");
    expect(out.assembly).toContain("lace_fn_yield");
    expect(out.assembly).toContain("lace_fn_findslot");
  });

  it("compiles module declaration with pub functions", () => {
    const out = compileOk(`
module kernel.boot
const VERSION = "0.1"
pub func boot()
    print(VERSION)
end
`);
    expect(out.assembly).toContain("lace_fn_boot");
  });

  it("compiles global const integers and string literals", () => {
    const out = compileOk(`
const HEAP_BASE = $010000
const BLOCK_SIZE = 64
const MSG = "boot"
pub func boot(): int
    return HEAP_BASE
end
`);
    expect(out.assembly).toContain("lace_global_heap_base");
  });
});

describe("NeedleOS readiness — control flow", () => {
  it("compiles while loops with break and continue", () => {
    const out = compileOk(`
pub func boot(): int
    var i = 0
    while i < 16
        if i == 8 then
            break
        end
        i = i + 1
    end
    return i
end
`);
    expect(out.assembly).toContain("bcc"); // < comparison
    expect(out.assembly).toContain("beq"); // == comparison
  });

  it("compiles for counting loops", () => {
    const out = compileOk(`
pub func boot(): int
    var sum = 0
    for i = 0 to 7
        sum = sum + i
    end
    return sum
end
`);
    expect(out.assembly).toContain("lace_fn_boot");
  });

  it("compiles if/else branches", () => {
    const out = compileOk(`
pub func boot(flag: int): int
    if flag == 1 then
        return 1
    else
        return 0
    end
end
`);
    expect(out.assembly).toContain("beq");
  });

  it("compiles switch dispatch on integer", () => {
    const out = compileOk(`
const CMD_HALT = 1
const CMD_INFO = 2
pub func boot(cmd: int): int
    switch cmd
        case CMD_HALT
            return 1
        end
        case CMD_INFO
            return 2
        end
        default
            return 0
        end
    end
    return cmd
end
`);
    expect(out.assembly).toContain("lace_fn_boot");
  });

  it("compiles boolean and / or in conditions", () => {
    const out = compileOk(`
pub func boot(a: int, b: int): int
    if a == 1 and b == 1 then
        return 1
    end
    if a == 0 or b == 0 then
        return 0
    end
    return -1
end
`);
    expect(out.assembly).toContain("lace_fn_boot");
  });

  it("compiles not with parentheses", () => {
    const out = compileOk(`
pub func boot(flag: int): int
    if not (flag == 0) then
        return 1
    end
    return 0
end
`);
    expect(out.assembly).toContain("lace_fn_boot");
  });
});

describe("NeedleOS readiness — arithmetic and types", () => {
  it("compiles all integer arithmetic operators", () => {
    const out = compileOk(`
pub func boot(): int
    var x = 100
    x = x + 10
    x = x - 5
    x = x & $FF
    x = x | $01
    x = x ^ $10
    return x
end
`);
    expect(out.assembly).toContain("adc");
    expect(out.assembly).toContain("sbc");
    expect(out.assembly).toContain("and");
    expect(out.assembly).toContain("ora");
    expect(out.assembly).toContain("eor");
  });

  it("compiles compound assignment operators", () => {
    const out = compileOk(`
pub func boot(): int
    var x = 10
    x += 5
    x -= 2
    x &= $FF
    x |= $01
    return x
end
`);
    expect(out.assembly).toContain("adc");
    expect(out.assembly).toContain("sbc");
  });

  it("compiles negative literals and unary minus", () => {
    const out = compileOk(`
pub func boot(): int
    var x = -1
    var y = -x
    return y
end
`);
    expect(out.assembly).toContain("lace_fn_boot");
  });

  it("compiles hex and binary literals", () => {
    const out = compileOk(`
pub func boot(): int
    const addr = $F000
    const mask = %11110000
    return addr
end
`);
    expect(out.assembly).toContain("0xF000");
  });

  it("compiles cast expressions", () => {
    const out = compileOk(`
pub func boot(): int
    const raw = 65535
    const narrow = cast<uint8>(raw)
    return narrow
end
`);
    expect(out.assembly).toContain("lace_fn_boot");
  });
});

describe("NeedleOS readiness — functions and calls", () => {
  it("compiles function calls with multiple arguments", () => {
    const out = compileOk(`
func add(a: int, b: int): int
    return a + b
end
pub func boot(): int
    return add(3, 4)
end
`);
    expect(out.assembly).toContain("jsr lace_fn_add");
    expect(out.assembly).toContain("pha");
  });

  it("compiles recursive functions", () => {
    const out = compileOk(`
func count(n: int): int
    if n == 0 then
        return 0
    end
    return count(n - 1)
end
pub func boot(): int
    return count(5)
end
`);
    expect(out.assembly).toContain("jsr lace_fn_count");
  });

  it("compiles multiple functions calling each other", () => {
    const out = compileOk(`
func double(n: int): int
    return n + n
end
func quad(n: int): int
    return double(double(n))
end
pub func boot(): int
    return quad(3)
end
`);
    expect(out.assembly).toContain("jsr lace_fn_double");
    expect(out.assembly).toContain("jsr lace_fn_quad");
  });

  it("compiles halt() and print() builtins", () => {
    const out = compileOk(`
pub func boot()
    print("starting")
    halt()
end
`);
    expect(out.assembly).toContain("jsr lace_fn_print");
    expect(out.assembly).toContain("jsr lace_fn_halt");
  });

  it("compiles multi-value return binding (first value captured)", () => {
    const out = compileOk(`
func mayFail(): int
    return 42
end
pub func boot(): int
    const val, err = mayFail()
    return val
end
`);
    expect(out.assembly).toContain("jsr lace_fn_mayfail");
  });
});

describe("NeedleOS readiness — inline assembly", () => {
  it("compiles asm blocks for hardware init", () => {
    const out = compileOk(`
pub func boot()
    unsafe(true)
    asm {
        sei
        clc
        xce
        rep #$30
    }
end
`);
    expect(out.assembly).toContain("sei");
    expect(out.assembly).toContain("clc");
    expect(out.assembly).toContain("xce");
    expect(out.assembly).toContain("rep");
  });

  it("compiles asm blocks for direct memory writes", () => {
    const out = compileOk(`
pub func boot()
    unsafe(true)
    asm {
        lda #65
        sta $F000
    }
end
`);
    expect(out.assembly).toContain("lda # 65");
    expect(out.assembly).toContain("sta $F000");
  });

  it("compiles asm blocks for interrupt handler prologue/epilogue", () => {
    const out = compileOk(`
pub func handleIrq()
    unsafe(true)
    asm {
        pha
        phx
        phy
    }
    asm {
        ply
        plx
        pla
        rti
    }
end
`);
    expect(out.assembly).toContain("pha");
    expect(out.assembly).toContain("rti");
  });

  it("compiles import alias without loading external module", () => {
    const out = compileOk(`
import system.console: console
pub func boot()
    print("hello")
end
`);
    expect(out.assembly).toContain("jsr lace_fn_print");
  });
});

// ---------------------------------------------------------------------------
// Stubbed patterns — compile successfully but emit placeholder code
// ---------------------------------------------------------------------------

describe("NeedleOS readiness — stubbed (compile ok, runtime placeholder)", () => {
  it("struct literal lowering emits placeholder", () => {
    const out = compileOk(`
type Task = struct
    id: int
    state: int
end
pub func boot(): int
    const t = Task { id: 1, state: 0 }
    return 0
end
`);
    expect(out.assembly).toContain("struct lowering is reserved");
  });

  it("memory index read emits placeholder (use asm instead)", () => {
    const out = compileOk(`
pub func boot(): int
    unsafe(true)
    const ch = memory[$F001]
    return ch
end
`);
    expect(out.assembly).toContain("lowering is reserved");
  });

  it("for-in loop body runs but iteration is not wired", () => {
    const result = compile(`
pub func boot()
    for item in memory
        print("x")
    end
end
`);
    expect(result.ok).toBe(true);
  });

  it("print() is a no-op stub in the runtime seed", () => {
    const out = compileOk(`
pub func boot()
    print("hello")
end
`);
    expect(out.assembly).toContain("runtime seed");
  });
});
