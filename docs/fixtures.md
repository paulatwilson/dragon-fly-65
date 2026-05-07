# Test Fixtures

Fixtures are hand-authored binary programs loaded into emulator RAM to verify end-to-end
execution of realistic machine code. Each fixture is original work, not derived from any
GPL-licensed source.

## sum5_loop

**Goal**: Sum five bytes from the direct page using an indexed loop and store the result.

**Instructions exercised**: LDX imm, STX dp, LDA dp+X, CLC, ADC dp, STA dp, INX, CPX imm, BNE, STP

**Memory layout** (all addresses within 64 KB RAM):

| Range | Purpose |
|-------|---------|
| 0x0000–0x0010 | Program code |
| 0x0050–0x0054 | Input data: [10, 20, 30, 40, 50] |
| 0x0070 | Output: expected 150 (0x96) |
| 0xFFFC–0xFFFD | Reset vector → 0x0000 |

**Logic**: Initialise running sum in dp 0x0070 to zero via STX. Loop five times: load
`data[X]` via `LDA dp,X`, add running sum via `ADC dp`, write back via `STA dp`, then
increment X and test with `CPX #5 / BNE`. Stop with STP.

---

## subroutine

**Goal**: Call a subroutine that doubles the accumulator value, confirming JSR/RTS conventions.

**Instructions exercised**: LDA imm, JSR abs, ASL A, RTS, STA dp, STP

**Memory layout**:

| Range | Purpose |
|-------|---------|
| 0x0000–0x0007 | Main program |
| 0x0010–0x0011 | Subroutine: ASL A, RTS |
| 0x0080 | Output: expected 14 |
| 0xFFFC–0xFFFD | Reset vector → 0x0000 |

**Logic**: Load 7 into A, JSR to the doubling subroutine (which executes `ASL A` then
`RTS`), store the result to dp 0x0080, halt.

---

## dispatch_loop

**Goal**: Process a sentinel-terminated command buffer through a dispatch table — the
simplest monitor-like loop.

**Instructions exercised**: LDA imm, STA dp, LDX imm, LDA dp+X, BEQ, CMP imm, INC dp,
DEC dp, INX, JMP abs, STP

**Memory layout**:

| Range | Purpose |
|-------|---------|
| 0x0000–0x001A | Program code |
| 0x0050–0x0053 | Command buffer: [0x01, 0xFF, 0x01, 0x00] |
| 0x0070 | Counter: expected 1 after halt |
| 0xFFFC–0xFFFD | Reset vector → 0x0000 |

**Command encoding**:

| Byte | Action |
|------|--------|
| 0x01 | Increment counter at dp 0x0070 |
| 0xFF | Decrement counter at dp 0x0070 |
| 0x00 | Halt (BEQ → STP) |

**Execution trace**:

1. Load 0x01 → INC counter (0→1), advance index
2. Load 0xFF → DEC counter (1→0), advance index
3. Load 0x01 → INC counter (0→1), advance index
4. Load 0x00 → BEQ halt → STP; final counter = 1
