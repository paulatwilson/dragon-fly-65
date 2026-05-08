import { describe, expect, it } from "bun:test";
import { spawnSync } from "bun";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const CLI = join(import.meta.dir, "../src/compiler/cli.ts");

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

describe("Lovelace compiler CLI", () => {
  it("shows usage with --help", () => {
    const result = runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: lace");
  });

  it("errors on missing input file", () => {
    const result = runCli(["--print-asm"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no input file");
  });

  it("errors when an option value is missing", () => {
    const result = runCli(["--entry"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--entry requires a value");
  });

  it("errors when file does not exist", () => {
    const result = runCli(["missing.lace"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("cannot read");
  });

  it("compiles a Lovelace file and writes a binary", () => {
    const dir = mkdtempSync(join(tmpdir(), "lace-cli-"));
    try {
      const source = join(dir, "boot.lace");
      const output = join(dir, "boot.bin");
      writeFileSync(source, "pub func boot()\nend\n");

      const result = runCli([source, "-o", output]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Compiled");
      expect(result.stdout).toContain("entry boot");
      expect(readFileSync(output).length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("defaults output filename to input with .bin extension", () => {
    const dir = mkdtempSync(join(tmpdir(), "lace-cli-"));
    try {
      const source = join(dir, "program.lace");
      writeFileSync(source, "pub func boot()\nend\n");

      const result = runCli([source]);

      expect(result.exitCode).toBe(0);
      expect(readFileSync(join(dir, "program.bin")).length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("writes generated assembly with --asm", () => {
    const dir = mkdtempSync(join(tmpdir(), "lace-cli-"));
    try {
      const source = join(dir, "boot.lace");
      const assembly = join(dir, "boot.asm");
      writeFileSync(source, "pub func boot()\nend\n");

      const result = runCli([source, "--asm", assembly]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Assembly ->");
      expect(readFileSync(assembly, "utf8")).toContain("lace_start:");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("writes default generated assembly with --emit-asm", () => {
    const dir = mkdtempSync(join(tmpdir(), "lace-cli-"));
    try {
      const source = join(dir, "boot.lace");
      writeFileSync(source, "pub func boot()\nend\n");

      const result = runCli([source, "--emit-asm"]);

      expect(result.exitCode).toBe(0);
      expect(readFileSync(join(dir, "boot.asm"), "utf8")).toContain("lace_fn_boot:");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("prints assembly without writing a binary with --print-asm", () => {
    const dir = mkdtempSync(join(tmpdir(), "lace-cli-"));
    try {
      const source = join(dir, "boot.lace");
      writeFileSync(source, "pub func boot()\nend\n");

      const result = runCli([source, "--print-asm"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("lace_start:");
      expect(result.stdout).toContain("lace_fn_boot:");
      expect(existsSync(join(dir, "boot.bin"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("selects a custom entry point", () => {
    const dir = mkdtempSync(join(tmpdir(), "lace-cli-"));
    try {
      const source = join(dir, "start.lace");
      writeFileSync(source, "pub func start()\nend\n");

      const result = runCli([source, "--entry", "start", "--print-asm"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("jsr lace_fn_start");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("formats compiler diagnostics for the terminal", () => {
    const dir = mkdtempSync(join(tmpdir(), "lace-cli-"));
    try {
      const source = join(dir, "bad.lace");
      writeFileSync(source, "pub func boot()\nend\n");

      const result = runCli([source, "--entry", "start"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("bad.lace:1:1: error: LACE5001");
      expect(result.stderr).toContain("Entry point 'start' was not found.");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
