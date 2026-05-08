#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "fs";
import { compileLovelace } from "./compiler";
import type { LovelaceDiagnostic } from "./types";

interface CliOptions {
  inputFile?: string;
  outputFile?: string;
  assemblyFile?: string;
  entryPoint?: string;
  printAssembly: boolean;
}

function usage(): string {
  return [
    "Usage: lace <input.lace> [-o output.bin] [--entry name] [--asm output.asm] [--emit-asm] [--print-asm]",
    "",
    "Options:",
    "  -o, --output <file>      Write compiled binary to file",
    "  --entry <name>           Select public entry point at build time (default: boot)",
    "  --asm <file>             Write generated W65C832 assembly to file",
    "  --emit-asm               Write generated assembly beside the input as .asm",
    "  --print-asm              Print generated assembly to stdout instead of writing a binary",
    "  -h, --help               Show this help",
  ].join("\n");
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { printAssembly: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    switch (arg) {
      case "-o":
      case "--output":
        options.outputFile = requireValue(args, ++i, arg);
        break;
      case "--entry":
        options.entryPoint = requireValue(args, ++i, arg);
        break;
      case "--asm":
      case "--assembly":
        options.assemblyFile = requireValue(args, ++i, arg);
        break;
      case "--emit-asm":
        options.assemblyFile = "";
        break;
      case "--print-asm":
        options.printAssembly = true;
        break;
      case "-h":
      case "--help":
        console.log(usage());
        process.exit(0);
        break;
      default:
        if (arg.startsWith("-")) {
          console.error(`Error: unknown option '${arg}'. Use --help for usage.`);
          process.exit(1);
        }
        options.inputFile = arg;
        break;
    }
  }

  return options;
}

function requireValue(args: string[], index: number, option: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("-")) {
    console.error(`Error: ${option} requires a value. Use --help for usage.`);
    process.exit(1);
  }
  return value;
}

function runCli(args: string[]): void {
  const options = parseArgs(args);

  if (!options.inputFile) {
    console.error("Error: no input file specified. Use --help for usage.");
    process.exit(1);
  }

  let source: string;
  try {
    source = readFileSync(options.inputFile, "utf8");
  } catch {
    console.error(`Error: cannot read '${options.inputFile}'`);
    process.exit(1);
  }

  const result = compileLovelace(source, {
    sourcePath: options.inputFile,
    ...(options.entryPoint === undefined ? {} : { entryPoint: options.entryPoint }),
  });

  if (!result.ok) {
    printDiagnostics(result.diagnostics, options.inputFile);
    process.exit(1);
  }

  if (options.printAssembly) {
    process.stdout.write(result.value.assembly);
    return;
  }

  const outputFile = options.outputFile ?? replaceExtension(options.inputFile, ".bin");
  writeFileSync(outputFile, result.value.binary);

  if (options.assemblyFile !== undefined) {
    const assemblyFile = options.assemblyFile === ""
      ? replaceExtension(options.inputFile, ".asm")
      : options.assemblyFile;
    writeFileSync(assemblyFile, result.value.assembly);
  }

  console.log(
    `Compiled ${result.value.binary.length} bytes  entry ${result.value.entryPoint}  -> ${outputFile}`,
  );
  if (options.assemblyFile !== undefined) {
    const assemblyFile = options.assemblyFile === ""
      ? replaceExtension(options.inputFile, ".asm")
      : options.assemblyFile;
    console.log(`Assembly -> ${assemblyFile}`);
  }
}

function printDiagnostics(diagnostics: LovelaceDiagnostic[], fallbackPath: string): void {
  for (const diagnostic of diagnostics) {
    const path = diagnostic.sourcePath ?? fallbackPath;
    const position = diagnostic.span.start;
    console.error(
      `${path}:${position.line}:${position.column}: ${diagnostic.severity}: ${diagnostic.code}: ${diagnostic.message}`,
    );
  }
}

function replaceExtension(path: string, extension: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dot = path.lastIndexOf(".");
  if (dot > slash) {
    return `${path.slice(0, dot)}${extension}`;
  }
  return `${path}${extension}`;
}

runCli(Bun.argv.slice(2));
