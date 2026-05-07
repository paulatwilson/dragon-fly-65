const port = Number(Bun.env.PORT ?? 3000);

const server = Bun.serve({
  port,
  fetch() {
    return Response.json({
      name: "Dragon Fly 65",
      status: "booting",
      target: "W65C832-inspired TypeScript computer",
    });
  },
});

console.log(`Dragon Fly 65 listening on http://localhost:${server.port}`);

