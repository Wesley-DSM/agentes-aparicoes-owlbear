
/**
 * Legacy entries keep their established order because their timestamps came
 * from device clocks. Entries stamped by the synchronized Brasília clock are
 * sorted by that shared timestamp, with persisted order as a stable tie-break.
 */
export function orderHistoryByAuthoritativeTimestamp(history, limit = 20) {
  const source = Array.isArray(history) ? history : [];
  const legacy = [];
  const synchronized = [];
  source.forEach((entry, index) => {
    if (entry?.timestampSource === "brasilia" && Number.isFinite(Number(entry.rolledAt))) {
      synchronized.push({ entry, index, timestamp: Number(entry.rolledAt) });
    } else {
      legacy.push(entry);
    }
  });
  synchronized.sort((a, b) => a.timestamp - b.timestamp || a.index - b.index);
  return [...legacy, ...synchronized.map(({ entry }) => entry)].slice(-limit);
}

/**
 * Merge a stale proposed history with the latest persisted history without
 * relying on client-generated timestamps. Existing storage order is canonical.
 * A newly proposed event is placed after concurrent events already persisted.
 */
export function mergeHistoryInPersistedOrder(proposedHistory, currentHistory, limit = 20) {
  const proposed = Array.isArray(proposedHistory) ? proposedHistory : [];
  const current = Array.isArray(currentHistory) ? currentHistory : [];
  const currentIds = new Set(current.map((entry) => entry?.id).filter(Boolean));
  const proposedIds = new Set(proposed.map((entry) => entry?.id).filter(Boolean));
  const firstNewIndex = proposed.findIndex((entry) => !currentIds.has(entry?.id));
  const concurrentEntries = current.filter((entry) => !proposedIds.has(entry?.id));
  const merged = firstNewIndex < 0
    ? [...proposed, ...concurrentEntries]
    : [...proposed.slice(0, firstNewIndex), ...concurrentEntries, ...proposed.slice(firstNewIndex)];
  const seen = new Set();
  return merged.filter((entry) => {
    if (!entry || typeof entry.id !== "string" || !entry.id || seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  }).slice(-limit);
}

/** The UI intentionally shows the newest stored event first. */
export function newestFirstHistory(history) {
  return [...(Array.isArray(history) ? history : [])].reverse();
}


/**
 * Rebuild order after a recently-observed event was overwritten by a racing
 * metadata write. The prior snapshot represents events already persisted; any
 * entries present only in the new snapshot happened later in the persisted
 * stream and are appended after it.
 */
export function mergeRecoveredHistory(previousHistory, latestHistory, pendingEntries = [], limit = 20) {
  const ordered = [
    ...(Array.isArray(previousHistory) ? previousHistory : []),
    ...(Array.isArray(latestHistory) ? latestHistory : []).filter((entry) =>
      !new Set((Array.isArray(previousHistory) ? previousHistory : []).map((item) => item?.id)).has(entry?.id)),
    ...(Array.isArray(pendingEntries) ? pendingEntries : []),
  ];
  const seen = new Set();
  return ordered.filter((entry) => {
    if (!entry || typeof entry.id !== "string" || !entry.id || seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  }).slice(-limit);
}
