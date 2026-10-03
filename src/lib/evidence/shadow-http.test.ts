import { describe, expect, it } from "vitest";

import { readJsonBodyLimited } from "./shadow-http";

describe("readJsonBodyLimited", () => {
  it("parses a bounded JSON body", async () => {
    const request = new Request("https://pisac.test", {
      method: "POST",
      body: '{"x":1}',
      headers: { "content-type": "application/json" },
    });
    await expect(readJsonBodyLimited(request, 1024)).resolves.toEqual({
      ok: true,
      value: { x: 1 },
    });
  });

  it("rejects declared or actual oversized bodies before use", async () => {
    const declared = new Request("https://pisac.test", {
      method: "POST",
      body: "{}",
      headers: { "content-length": "9999" },
    });
    await expect(readJsonBodyLimited(declared, 100)).resolves.toMatchObject({
      ok: false,
      status: 413,
    });

    const actual = new Request("https://pisac.test", {
      method: "POST",
      body: JSON.stringify({ x: "a".repeat(200) }),
    });
    await expect(readJsonBodyLimited(actual, 100)).resolves.toMatchObject({
      ok: false,
      status: 413,
    });
  });

  it("rejects malformed JSON", async () => {
    const request = new Request("https://pisac.test", {
      method: "POST",
      body: "{",
    });
    await expect(readJsonBodyLimited(request, 100)).resolves.toEqual({
      ok: false,
      status: 400,
      reason: "invalid JSON body",
    });
  });
});
