import { describe, it, expect } from "bun:test";
import { spawnSync } from "bun";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const CLI = join(import.meta.dir, "../src/assembler/cli.ts");

function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync(["bun", "run", CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode ?? 1,
  };
}

describe("assembler CLI", () => {
  it("shows usage when no arguments given and stdin is not a TTY", () => {
    // Without --repl and without a file, and stdin closed, it still exits cleanly
    // We test the --help flag instead as a reliable way to check usage output
    const r = runCli(["--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Usage:");
  });

  it("errors on missing input file", () => {
    const r = runCli(["--hex"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("no input file");
  });

  it("errors when file does not exist", () => {
    const r = runCli(["nonexistent.asm"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("cannot read");
  });

  it("assembles a file and writes a binary", () => {
    const dir = mkdtempSync(join(tmpdir(), "asm-cli-"));
    try {
      const src = join(dir, "test.asm");
      const out = join(dir, "test.bin");
      writeFileSync(src, ".org $1000\nlda #$ff\nrts\n");

      const r = runCli([src, "-o", out]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("bytes");

      const bytes = readFileSync(out);
      expect(bytes[0]).toBe(0xa9); // LDA #imm
      expect(bytes[1]).toBe(0xff);
      expect(bytes[2]).toBe(0x60); // RTS
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("defaults output filename to input with .bin extension", () => {
    const dir = mkdtempSync(join(tmpdir(), "asm-cli-"));
    try {
      const src = join(dir, "prog.asm");
      writeFileSync(src, "nop\n");

      const r = runCli([src]);
      expect(r.exitCode).toBe(0);

      const bytes = readFileSync(join(dir, "prog.bin"));
      expect(bytes[0]).toBe(0xea); // NOP
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("prints hex dump with --hex flag", () => {
    const dir = mkdtempSync(join(tmpdir(), "asm-cli-"));
    try {
      const src = join(dir, "test.asm");
      writeFileSync(src, ".org $0010\nlda #$42\n");

      const r = runCli([src, "--hex"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("$000010");
      expect(r.stdout).toContain("A9");
      expect(r.stdout).toContain("42");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("exits with code 1 and reports errors on bad source", () => {
    const dir = mkdtempSync(join(tmpdir(), "asm-cli-"));
    try {
      const src = join(dir, "bad.asm");
      writeFileSync(src, "zzz #$ff\n");

      const r = runCli([src]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("error:");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("includes filename and line number in error output", () => {
    const dir = mkdtempSync(join(tmpdir(), "asm-cli-"));
    try {
      const src = join(dir, "bad.asm");
      writeFileSync(src, "nop\nzzz\n");

      const r = runCli([src]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("bad.asm:");
      expect(r.stderr).toMatch(/:\d+:/); // filename:line:
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("reports origin and size in success output", () => {
    const dir = mkdtempSync(join(tmpdir(), "asm-cli-"));
    try {
      const src = join(dir, "test.asm");
      writeFileSync(src, ".org $2000\nnop\nnop\n");

      const r = runCli([src]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("$002000");
      expect(r.stdout).toContain("2 bytes");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
