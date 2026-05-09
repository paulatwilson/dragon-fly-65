import { bootMonitorComputer, ComputerBootError, runInteractiveComputer } from "./boot";

try {
  const { machine } = bootMonitorComputer();
  await runInteractiveComputer(machine);
  process.exit(0);
} catch (error) {
  if (error instanceof ComputerBootError) {
    for (const asmError of error.errors) {
      process.stderr.write(`monitor/monitor.asm:${asmError.line}: error: ${asmError.message}\n`);
    }
    process.exit(1);
  }

  throw error;
}

export { bootMonitorComputer, ComputerBootError, runInteractiveComputer } from "./boot";
