import { loadDragonFlyConfig } from "./config";

const config = loadDragonFlyConfig(Bun.env);

const server = Bun.serve({
  port: config.server.port,
  fetch() {
    return Response.json({
      name: "Dragon Fly 65",
      status: "booting",
      target: "W65C832-inspired TypeScript computer",
      cpuClockHz: config.cpu.clockHz,
    });
  },
});

console.log(`Dragon Fly 65 listening on http://localhost:${server.port}`);
