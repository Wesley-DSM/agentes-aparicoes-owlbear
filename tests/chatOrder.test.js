import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mergeHistoryInPersistedOrder, mergeRecoveredHistory, newestFirstHistory, orderHistoryByAuthoritativeTimestamp } from "../src/chatOrder.js";

const readme = await readFile(new URL("../src/rollHistory.js", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");

test("CHAT orders newly synchronized events by the shared timestamp instead of device clocks", () => {
  assert.match(readme, /orderHistoryByAuthoritativeTimestamp/);
  assert.match(readme, /timestampSource: value\.timestampSource === "brasilia" \? "brasilia" : "legacy"/);
  assert.match(main, /newestFirstHistory\(history\)/);
  assert.doesNotMatch(main, /sort\(\(a, b\) => b\.rolledAt - a\.rolledAt\)/);
});

test("official-time entries are timestamp-sorted while legacy events retain their stored order", () => {
  const history = [
    { id: "old-1", timestampSource: "legacy", rolledAt: 9_000_000_000_000 },
    { id: "new-later", timestampSource: "brasilia", rolledAt: 2000 },
    { id: "old-2", timestampSource: "legacy", rolledAt: 1 },
    { id: "new-earlier", timestampSource: "brasilia", rolledAt: 1000 },
  ];
  assert.deepEqual(
    orderHistoryByAuthoritativeTimestamp(history).map((entry) => entry.id),
    ["old-1", "old-2", "new-earlier", "new-later"],
  );
});

test("CHAT view reverses only display order, not persisted history", () => {
  const history = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(newestFirstHistory(history).map((entry) => entry.id), ["c", "b", "a"]);
  assert.deepEqual(history.map((entry) => entry.id), ["a", "b", "c"]);
});

test("stale concurrent append merges events already persisted before the new event", () => {
  const older = { id: "older" };
  const firstWriter = { id: "first-writer" };
  const secondWriter = { id: "second-writer" };
  const merged = mergeHistoryInPersistedOrder(
    [older, secondWriter],
    [older, firstWriter],
  );
  assert.deepEqual(merged.map((entry) => entry.id), ["older", "first-writer", "second-writer"]);
});

test("merge deduplicates IDs and retains only the newest stored-order window", () => {
  const entries = Array.from({ length: 5 }, (_, index) => ({ id: `e${index}` }));
  const merged = mergeHistoryInPersistedOrder([...entries, entries[4]], [], 3);
  assert.deepEqual(merged.map((entry) => entry.id), ["e2", "e3", "e4"]);
});

test("append race recovery is tied to room metadata change notifications", () => {
  assert.match(readme, /onMetadataChange/);
  assert.match(readme, /reconcilePendingRollHistory/);
  assert.match(readme, /PENDING_RECOVERY_WINDOW_MS/);
});


test("recovery preserves the last confirmed order when one writer overwrites another", () => {
  const earlier = { id: "earlier" };
  const overwritten = { id: "overwritten" };
  const later = { id: "later" };
  const merged = mergeRecoveredHistory([earlier, overwritten], [earlier, later], [overwritten]);
  assert.deepEqual(merged.map((entry) => entry.id), ["earlier", "overwritten", "later"]);
});
