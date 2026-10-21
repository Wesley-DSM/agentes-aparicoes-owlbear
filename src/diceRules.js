export function activeDieValue(die) {
  return die.rolls[die.rolls.length - 1];
}

/**
 * Resolve the test exactly as described in A&A 0.8:
 * - one designated highest die grants a critical only when it is 10;
 * - every other die grants a critical when it is 10 or at least the DT;
 * - result = highest die + criticals, success when result >= DT.
 */
export function calculateTestResult(entry, rawDt = entry.dt) {
  if (rawDt === null || rawDt === undefined || rawDt === "") return null;
  const dt = Number(rawDt);
  if (!Number.isInteger(dt) || dt < 0 || dt > 9999 || !Array.isArray(entry.dice) || !entry.dice.length) return null;
  const values = entry.dice.map(activeDieValue);
  if (!values.every((value) => Number.isInteger(value) && value >= 1 && value <= 10)) return null;
  const largest = Math.max(...values);
  const largestIndex = values.indexOf(largest);
  let criticals = 0;
  values.forEach((value, index) => {
    if (index === largestIndex) {
      if (value === 10) criticals += 1;
    } else if (value === 10 || value >= dt) {
      criticals += 1;
    }
  });
  const total = largest + criticals;
  return { dt, total, criticals, success: total >= dt };
}
