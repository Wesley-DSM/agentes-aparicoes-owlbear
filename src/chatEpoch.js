/**
 * The CHAT history uses an epoch that advances whenever the GM clears it.
 * Entries from an older epoch are ignored, even if a participant finishes an
 * in-flight metadata write after the clear operation has completed.
 */
export const CHAT_EPOCH_KEY = "com.agentesaparicoes.character-sheet/chat-epoch";

export function normalizeChatEpoch(value) {
  const epoch = Number(value);
  return Number.isSafeInteger(epoch) && epoch >= 0 ? epoch : 0;
}

export function nextChatEpoch(value) {
  const current = normalizeChatEpoch(value);
  return current < Number.MAX_SAFE_INTEGER ? current + 1 : 1;
}

export function stampChatEntry(entry, epoch) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
  return { ...entry, chatEpoch: normalizeChatEpoch(epoch) };
}

export function filterChatEntriesByEpoch(entries, epoch) {
  const expectedEpoch = normalizeChatEpoch(epoch);
  return (Array.isArray(entries) ? entries : []).filter((entry) =>
    normalizeChatEpoch(entry?.chatEpoch) === expectedEpoch);
}
