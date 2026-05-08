import { readFileSync } from "fs";
import { resolve } from "path";
import { assemble } from "../assembler";
import { Machine } from "../machine";

const asmPath = resolve(import.meta.dir, "../../monitor/monitor.asm");
const source = readFileSync(asmPath, "utf8");

const result = assemble(source);
if (result.errors.length > 0) {
  for (const e of result.errors) {
    process.stderr.write(`monitor/monitor.asm:${e.line}: error: ${e.message}\n`);
  }
  process.exit(1);
}

const machine = new Machine();
machine.load(result.bytes, result.origin);
machine.setResetVector(result.origin);
machine.reset();

// Feed stdin into the machine's input queue as it arrives
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("data", (chunk: Buffer) => {
  for (const byte of chunk) {
    if (byte === 0x03) {
      // Ctrl-C — exit
      process.stdout.write("\r\n");
      process.exit(0);
    }
    machine.pushInput(byte);
  }
});

await machine.run();
process.exit(0);
