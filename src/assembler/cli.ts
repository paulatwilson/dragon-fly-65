#!/usr/bin/env bun

import { createInterface } from "readline";
import { readFileSync, writeFileSync } from "fs";
import { assemble } from "./assembler";

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtAddr(n: number): string {
  return "$" + n.toString(16).padStart(6, "0").toUpperCase();
}

function fmtByte(n: number): string {
  return n.toString(16).padStart(2, "0").toUpperCase();
}

function hexDump(bytes: Uint8Array, origin: number): string {
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const addr = fmtAddr(origin + i);
    const chunk = Array.from(bytes.slice(i, i + 16));
    const hex = chunk.map(fmtByte).join(" ").padEnd(47);
    const ascii = chunk
      .map(b => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "."))
      .join("");
    lines.push(`${addr}  ${hex}  ${ascii}`);
  }
  return lines.join("\n");
}

function inlineHex(bytes: Uint8Array, from: number, count: number): string {
  return Array.from(bytes.slice(from, from + count)).map(fmtByte).join(" ");
}

// ── CLI mode ──────────────────────────────────────────────────────────────────

function runCli(args: string[]): void {
  let inputFile: string | undefined;
  let outputFile: string | undefined;
  let printHex = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "-o" || arg === "--output") {
      outputFile = args[++i];
    } else if (arg === "--hex") {
      printHex = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: asm <input.asm> [-o output.bin] [--hex]");
      console.log("       asm --repl");
      process.exit(0);
    } else if (!arg.startsWith("-")) {
      inputFile = arg;
    }
  }

  if (!inputFile) {
    console.error("Error: no input file specified. Use --help for usage.");
    process.exit(1);
  }

  let source: string;
  try {
    source = readFileSync(inputFile, "utf8");
  } catch {
    console.error(`Error: cannot read '${inputFile}'`);
    process.exit(1);
  }

  const result = assemble(source);

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      console.error(`${inputFile}:${err.line}: error: ${err.message}`);
    }
    process.exit(1);
  }

  if (printHex) {
    console.log(hexDump(result.bytes, result.origin));
    return;
  }

  const outPath = outputFile ?? inputFile.replace(/\.[^.]+$/, "") + ".bin";
  writeFileSync(outPath, result.bytes);

  const origin = fmtAddr(result.origin);
  const end = fmtAddr(result.origin + result.bytes.length - 1);
  console.log(`Assembled ${result.bytes.length} bytes  ${origin}–${end}  → ${outPath}`);
  if (result.symbols.size > 0) {
    console.log(`${result.symbols.size} symbol(s) defined`);
  }
}

// ── REPL mode ─────────────────────────────────────────────────────────────────

const REPL_HELP = `
Commands:
  .help              Show this help
  .symbols           Show symbol table
  .hex               Hex dump of assembled bytes
  .list              List entered source lines
  .reset             Clear all input and reset origin
  .origin <addr>     Set origin (e.g. .origin $1000 or .origin 4096)
  .save <file>       Save assembled binary to file
  .load <file>       Load and assemble a source file
  .quit              Exit REPL
`.trim();

function currentPc(lines: string[]): number {
  if (lines.length === 0) return 0;
  const r = assemble(lines.join("\n"));
  return r.origin + r.bytes.length;
}

async function runRepl(): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const lines: string[] = [];

  console.log('W65C832 Assembler REPL  —  type .help for commands, .quit to exit');
  console.log("");

  const showPrompt = () => {
    const pc = currentPc(lines);
    rl.setPrompt(`${fmtAddr(pc)} > `);
    rl.prompt();
  };

  rl.on("line", (raw: string) => {
    const input = raw.trim();

    // ── REPL commands ─────────────────────────────────────────────────────
    if (input.startsWith(".")) {
      const parts = input.split(/\s+/);
      const cmd = parts[0] ?? "";

      switch (cmd) {
        case ".quit":
        case ".exit":
          console.log("Bye.");
          rl.close();
          process.exit(0);
          break;

        case ".help":
          console.log(REPL_HELP);
          break;

        case ".symbols": {
          if (lines.length === 0) { console.log("(no source)"); break; }
          const r = assemble(lines.join("\n"));
          if (r.symbols.size === 0) {
            console.log("(no symbols defined)");
          } else {
            for (const [name, value] of r.symbols) {
              console.log(`  ${name.padEnd(24)} ${fmtAddr(value)}`);
            }
          }
          break;
        }

        case ".hex": {
          if (lines.length === 0) { console.log("(no source)"); break; }
          const r = assemble(lines.join("\n"));
          if (r.errors.length > 0) {
            for (const e of r.errors) console.error(`  line ${e.line}: ${e.message}`);
          } else if (r.bytes.length === 0) {
            console.log("(no bytes)");
          } else {
            console.log(hexDump(r.bytes, r.origin));
          }
          break;
        }

        case ".list":
          if (lines.length === 0) {
            console.log("(empty)");
          } else {
            lines.forEach((l, i) =>
              console.log(`  ${String(i + 1).padStart(3)}: ${l}`)
            );
          }
          break;

        case ".reset":
          lines.length = 0;
          console.log("Reset.");
          break;

        case ".origin": {
          const raw2 = parts[1] ?? "";
          const val = raw2.startsWith("$")
            ? parseInt(raw2.slice(1), 16)
            : parseInt(raw2, 10);
          if (isNaN(val)) {
            console.error("Usage: .origin $addr  or  .origin decimal");
          } else {
            lines.length = 0;
            lines.push(`.org $${val.toString(16)}`);
            console.log(`Origin set to ${fmtAddr(val)}`);
          }
          break;
        }

        case ".save": {
          const filename = parts[1];
          if (!filename) { console.error("Usage: .save <filename>"); break; }
          if (lines.length === 0) { console.log("(no source)"); break; }
          const r = assemble(lines.join("\n"));
          if (r.errors.length > 0) {
            for (const e of r.errors) console.error(`  line ${e.line}: ${e.message}`);
          } else {
            writeFileSync(filename, r.bytes);
            console.log(`Saved ${r.bytes.length} bytes → ${filename}`);
          }
          break;
        }

        case ".load": {
          const filename = parts[1];
          if (!filename) { console.error("Usage: .load <filename>"); break; }
          try {
            const src = readFileSync(filename, "utf8");
            lines.length = 0;
            lines.push(...src.split("\n"));
            const r = assemble(lines.join("\n"));
            if (r.errors.length > 0) {
              for (const e of r.errors) console.error(`  line ${e.line}: ${e.message}`);
            } else {
              console.log(
                `Loaded ${filename}: ${r.bytes.length} bytes, origin ${fmtAddr(r.origin)}`
              );
              if (r.symbols.size > 0) console.log(`  ${r.symbols.size} symbol(s)`);
            }
          } catch {
            console.error(`Cannot read '${filename}'`);
          }
          break;
        }

        default:
          console.error(`Unknown command: ${cmd} — type .help for a list`);
      }

      showPrompt();
      return;
    }

    // ── Empty line ────────────────────────────────────────────────────────
    if (input === "") {
      showPrompt();
      return;
    }

    // ── Assemble the new line in context ──────────────────────────────────
    const prevByteCount = lines.length > 0
      ? assemble(lines.join("\n")).bytes.length
      : 0;

    lines.push(input);
    const result = assemble(lines.join("\n"));

    if (result.errors.length > 0) {
      // Show only errors on the line just added; revert if there are any.
      const lastLineNum = lines.length;
      const fresh = result.errors.filter(e => e.line >= lastLineNum);
      const toShow = fresh.length > 0 ? fresh : result.errors;
      for (const e of toShow) console.error(`  error: ${e.message}`);
      lines.pop();
    } else {
      const newByteCount = result.bytes.length - prevByteCount;
      if (newByteCount > 0) {
        const addr = fmtAddr(result.origin + prevByteCount);
        const hex = inlineHex(result.bytes, prevByteCount, newByteCount);
        console.log(`  ${addr}: ${hex}`);
      }
    }

    showPrompt();
  });

  rl.on("close", () => {
    console.log("\nBye.");
    process.exit(0);
  });

  showPrompt();
}

// ── Entry point ───────────────────────────────────────────────────────────────

const args = Bun.argv.slice(2);

if (args.length === 0 || args.includes("--repl")) {
  runRepl();
} else {
  runCli(args);
}
