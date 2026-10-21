import test from "node:test";
import assert from "node:assert/strict";
import { activeDieValue, calculateTestResult } from "../src/diceRules.js";

const dice = (...values) => values.map((value) => ({ rolls: [value] }));

test("A&A 0.8: criticals count non-highest dice at or above the DT", () => {
  assert.deepEqual(calculateTestResult({ dice: dice(9, 6, 5) }, 5), {
    dt: 5, total: 11, criticals: 2, success: true,
  });
});

test("A&A 0.8: failed test with no criticals", () => {
  assert.deepEqual(calculateTestResult({ dice: dice(4, 2) }, 5), {
    dt: 5, total: 4, criticals: 0, success: false,
  });
});

test("A&A 0.8: a highest 10 and another 10 each grant a critical", () => {
  assert.deepEqual(calculateTestResult({ dice: dice(10, 10, 7) }, 12), {
    dt: 12, total: 12, criticals: 2, success: true,
  });
});

test("A&A 0.8: a single 10 at DT 12 is one critical and still fails", () => {
  assert.deepEqual(calculateTestResult({ dice: dice(10, 8, 3) }, 12), {
    dt: 12, total: 11, criticals: 1, success: false,
  });
});

test("a rerolled die contributes only its newest result", () => {
  const entry = { dice: [{ rolls: [2, 6] }, { rolls: [5] }] };
  assert.equal(activeDieValue(entry.dice[0]), 6);
  assert.deepEqual(calculateTestResult(entry, 5), {
    dt: 5, total: 7, criticals: 1, success: true,
  });
});

test("a missing or invalid DT does not produce a test result", () => {
  const entry = { dice: dice(10, 5) };
  assert.equal(calculateTestResult(entry, ""), null);
  assert.equal(calculateTestResult(entry, 1.5), null);
});

test("DT 0 is accepted and produces a result", () => {
  assert.deepEqual(calculateTestResult({ dice: dice(10, 5) }, 0), {
    dt: 0, total: 12, criticals: 2, success: true,
  });
});
