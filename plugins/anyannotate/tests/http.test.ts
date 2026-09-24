import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "anyannotate-http-"));
process.env.ANYANNOTATE_DATA_FILE = path.join(temporaryDirectory, "draft.json");

const { createHttpApp, validateHost } = await import("../server/index.js");

test.after(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("accepts only loopback listening addresses", () => {
  assert.equal(validateHost("127.0.0.1"), "127.0.0.1");
  assert.equal(validateHost("::1"), "::1");
  assert.throws(() => validateHost("0.0.0.0"), /local-only/);
});

test("rejects cross-origin access to the local preview API", async () => {
  const server = createHttpApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;

  try {
    const rejected = await fetch(`${origin}/api/draft`, {
      headers: { Origin: "https://example.com" },
    });
    assert.equal(rejected.status, 403);

    const accepted = await fetch(`${origin}/api/draft`, {
      headers: { Origin: origin },
    });
    assert.equal(accepted.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("validates REST input lengths", async () => {
  const server = createHttpApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${origin}/api/clips`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ quote: "x".repeat(50_001) }),
    });
    assert.equal(response.status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
