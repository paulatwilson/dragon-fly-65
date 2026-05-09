#!/usr/bin/env bun

import { readFileSync } from "fs";
import { resolve } from "path";
import { assemble } from "../src/assembler";
import { compileLovelace } from "../src/compiler";
import { Machine } from "../src/machine";

interface Options {
  sourcePath?: string;
  origin: number;
}

const DEFAULT_ORIGIN = 0x0300;

function usage(): string {
  return [
    "Usage: bun run scripts/run-lovelace-monitor.ts <input.lace> [--origin $0300]",
    "",
    "Compiles a Lovelace file, loads it beside the DragonFly monitor,",
    "and runs the generated lace_init entry through the monitor G command.",
  ].join("\n");
}

function parseArgs(args: string[]): Options {
  const options: Options = { origin: DEFAULT_ORIGIN };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "-h" || arg === "--help") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--origin") {
      const value = args[++i];
      if (value === undefined) fail("--origin requires an address.");
      options.origin = parseAddress(value);
      continue;
    }
    if (arg.startsWith("-")) fail(`Unknown option '${arg}'.`);
    options.sourcePath = arg;
  }

  if (options.sourcePath === undefined) fail("No input file specified.");
  return options;
}

function parseAddress(value: string): number {
  const normalized = value.startsWith("$")
    ? `0x${value.slice(1)}`
    : value;
  const address = Number(normalized);
  if (!Number.isInteger(address) || address < 0 || address > 0xffff) {
    fail(`Invalid 16-bit address '${value}'.`);
  }
  return address;
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  console.error(usage());
  process.exit(1);
}

function formatAddress(address: number): string {
  return address.toString(16).toUpperCase().padStart(4, "0");
}

const options = parseArgs(Bun.argv.slice(2));
const sourcePath = options.sourcePath!;
const source = readFileSync(sourcePath, "utf8");

const compiled = compileLovelace(source, { sourcePath });
if (!compiled.ok) {
  for (const diagnostic of compiled.diagnostics) {
    const position = diagnostic.span.start;
    console.error(
      `${diagnostic.sourcePath ?? sourcePath}:${position.line}:${position.column}: ${diagnostic.severity}: ${diagnostic.code}: ${diagnostic.message}`,
    );
  }
  process.exit(1);
}

const program = assemble(`.org $${formatAddress(options.origin)}\n${compiled.value.assembly}`);
if (program.errors.length > 0) {
  for (const error of program.errors) {
    console.error(`${sourcePath}: assembler line ${error.line}: ${error.message}`);
  }
  process.exit(1);
}

const monitorSource = readFileSync(resolve(import.meta.dir, "../monitor/monitor.asm"), "utf8");
const monitor = assemble(monitorSource);
if (monitor.errors.length > 0) {
  for (const error of monitor.errors) {
    console.error(`monitor/monitor.asm:${error.line}: ${error.message}`);
  }
  process.exit(1);
}

const initAddress = program.symbols.get("lace_init");
if (initAddress === undefined) {
  console.error("Generated program did not contain lace_init.");
  process.exit(1);
}

const machine = new Machine();
machine.load(monitor.bytes, monitor.origin);
machine.load(program.bytes, program.origin);
machine.setResetVector(monitor.origin);
machine.reset();

const command = `G${formatAddress(initAddress)}\r`;
const inputBytes = [...command].map(char => char.charCodeAt(0));
let inputIndex = 0;
let outputLength = 0;
let lastOutputStep = 0;

const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = ((chunk: string | Uint8Array) => {
  outputLength += typeof chunk === "string" ? chunk.length : chunk.length;
  return originalWrite(chunk);
}) as typeof process.stdout.write;

try {
  for (let step = 0; step < 2_000_000; step++) {
    if (inputIndex < inputBytes.length && step % 200 === 0) {
      machine.pushInput(inputBytes[inputIndex++]!);
    }

    if (machine.step()) break;
    if (outputLength > 0) lastOutputStep = step;

    if (inputIndex >= inputBytes.length && step - lastOutputStep > 50_000) {
      break;
    }
  }
} finally {
  process.stdout.write = originalWrite;
}
