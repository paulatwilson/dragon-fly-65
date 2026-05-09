import { readFileSync } from "fs";
import { resolve } from "path";
import { assemble, type AssemblerError } from "../assembler";
import { Machine } from "../machine";

export interface BootMonitorComputerOptions {
  monitorPath?: string;
}

export interface BootedMonitorComputer {
  machine: Machine;
  monitorOrigin: number;
}

export class ComputerBootError extends Error {
  constructor(
    message: string,
    readonly errors: AssemblerError[],
  ) {
    super(message);
    this.name = "ComputerBootError";
  }
}

export function bootMonitorComputer(
  options: BootMonitorComputerOptions = {},
): BootedMonitorComputer {
  const monitorPath = options.monitorPath
    ?? resolve(import.meta.dir, "../../monitor/monitor.asm");
  const source = readFileSync(monitorPath, "utf8");
  const monitor = assemble(source);

  if (monitor.errors.length > 0) {
    throw new ComputerBootError("Monitor ROM assembly failed.", monitor.errors);
  }

  const machine = new Machine();
  machine.load(monitor.bytes, monitor.origin);
  machine.setResetVector(monitor.origin);
  machine.reset();

  return {
    machine,
    monitorOrigin: monitor.origin,
  };
}

export async function runInteractiveComputer(machine: Machine): Promise<void> {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  process.stdin.resume();
  process.stdin.on("data", (chunk: Buffer) => {
    for (const byte of chunk) {
      if (byte === 0x03) {
        process.stdout.write("\r\n");
        process.exit(0);
      }
      machine.pushInput(byte);
    }
  });

  await machine.run();
}
