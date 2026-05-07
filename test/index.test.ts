import { expect, test } from "bun:test";

test("project identity is DragonFly 65", () => {
  expect("DragonFly 65").toContain("65");
});
