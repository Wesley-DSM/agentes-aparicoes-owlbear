import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createBrasiliaClock, BRASILIA_TIME_ZONE } from "../src/brasiliaTime.js";

const primaryProvider = {
  name: "fake time server",
  url: "https://time.example.test/now",
  readEpoch: (payload) => Number(payload?.unix_ms),
};

function response(payload, ok = true, status = 200) {
  return { ok, status, json: async () => payload };
}

test("timestamps are based on synchronized server time and monotonic performance, not Date.now", async () => {
  let monotonic = 100;
  const clock = createBrasiliaClock({
    fetchImpl: async () => {
      monotonic += 40;
      return response({ unix_ms: 1_800_000_000_000 });
    },
    monotonicNow: () => monotonic,
    providers: [primaryProvider],
    syncIntervalMs: 1000,
  });
  const originalDateNow = Date.now;
  Date.now = () => { throw new Error("device wall clock must not be read"); };
  try {
    const first = await clock.now();
    monotonic += 15;
    const second = await clock.now();
    assert.equal(first, 1_800_000_000_020);
    assert.equal(second, first + 15);
  } finally {
    Date.now = originalDateNow;
  }
});

test("uses a backup time provider when the first source is unavailable", async () => {
  let monotonic = 1000;
  const clock = createBrasiliaClock({
    fetchImpl: async (url) => {
      monotonic += 10;
      if (url.includes("primary")) return response({}, false, 503);
      return response({ datetime: "2026-10-26T12:00:00.000-03:00" });
    },
    monotonicNow: () => monotonic,
    providers: [
      { name: "primary", url: "https://primary.test/now", readEpoch: () => null },
      {
        name: "backup",
        url: "https://backup.test/now",
        readEpoch: (payload) => Date.parse(payload?.datetime ?? ""),
      },
    ],
  });
  const timestamp = await clock.now();
  assert.ok(timestamp >= Date.parse("2026-10-26T12:00:00.000-03:00"));
  assert.ok(timestamp < Date.parse("2026-10-26T12:00:00.100-03:00"));
});

test("a previously synchronized clock can continue from monotonic time during a temporary outage", async () => {
  let monotonic = 500;
  let online = true;
  const clock = createBrasiliaClock({
    fetchImpl: async () => {
      if (!online) throw new Error("offline");
      monotonic += 20;
      return response({ unix_ms: 1_800_000_000_000 });
    },
    monotonicNow: () => monotonic,
    providers: [primaryProvider],
    syncIntervalMs: 100,
    maxStaleMs: 10_000,
  });
  const first = await clock.now();
  online = false;
  monotonic += 150;
  const second = await clock.now();
  assert.ok(second > first);
  assert.equal(second - first, 150);
});

test("chat timestamps are created at append time and displayed in Brasília time", async () => {
  const history = await readFile(new URL("../src/rollHistory.js", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const sheet = await readFile(new URL("../src/sheet.js", import.meta.url), "utf8");
  assert.match(history, /const officialTimestamp = await getBrasiliaTimestamp\(\)/);
  assert.match(history, /\.\.\.value, rolledAt: officialTimestamp, usedAt: officialTimestamp, timestampSource: "brasilia"/);
  assert.match(main, /timeZone: BRASILIA_TIME_ZONE/);
  assert.doesNotMatch(main, /rolledAt: Date\.now\(\)|usedAt: Date\.now\(\)/);
  assert.doesNotMatch(sheet, /rolledAt: Date\.now\(\)|usedAt: Date\.now\(\)/);
});

test("the display timezone is fixed to Brasília independently of device settings", () => {
  assert.equal(BRASILIA_TIME_ZONE, "America/Sao_Paulo");
});
