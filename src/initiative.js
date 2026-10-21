import OBR from "@owlbear-rodeo/sdk";

export const EXTENSION_ID = "com.agentesaparicoes.character-sheet";
export const INITIATIVE_KEY = `${EXTENSION_ID}/initiative-state`;

const MAX_INITIATIVE_ENTRIES = 50;

function safeInitiative(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? Math.max(-9999, Math.min(99999, number)) : null;
}

export function sortInitiativeEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.initiative === null && b.initiative !== null) return 1;
    if (a.initiative !== null && b.initiative === null) return -1;
    if (a.initiative !== null && b.initiative !== null && a.initiative !== b.initiative) {
      return b.initiative - a.initiative;
    }
    return a.addedAt - b.addedAt;
  });
}

export function normalizeInitiativeState(raw) {
  const seenIds = new Set();
  const entries = (Array.isArray(raw?.entries) ? raw.entries : [])
    .filter((entry) => entry && typeof entry.tokenId === "string" && entry.tokenId.trim())
    .slice(0, MAX_INITIATIVE_ENTRIES)
    .filter((entry) => {
      if (seenIds.has(entry.tokenId)) return false;
      seenIds.add(entry.tokenId);
      return true;
    })
    .map((entry, index) => ({
      tokenId: entry.tokenId.slice(0, 200),
      name: String(entry.name ?? "Personagem").slice(0, 100),
      initiative: safeInitiative(entry.initiative),
      addedAt: Number.isFinite(Number(entry.addedAt)) ? Number(entry.addedAt) : index,
    }));
  const requestedActive = typeof raw?.activeTokenId === "string" ? raw.activeTokenId : null;
  const activeTokenId = entries.some((entry) => entry.tokenId === requestedActive)
    ? requestedActive
    : sortInitiativeEntries(entries)[0]?.tokenId ?? null;
  const round = Number.isFinite(Number(raw?.round)) ? Math.max(1, Math.min(999999, Math.trunc(Number(raw.round)))) : 1;
  return { version: 1, entries, round, activeTokenId };
}

export async function readInitiativeState() {
  const metadata = await OBR.room.getMetadata();
  return normalizeInitiativeState(metadata?.[INITIATIVE_KEY]);
}

export async function writeInitiativeState(state) {
  const normalized = normalizeInitiativeState(state);
  await OBR.room.setMetadata({ [INITIATIVE_KEY]: normalized });
  return normalized;
}

export async function toggleTokenInitiative(token) {
  if (!token?.id) throw new Error("Token inválido para a iniciativa.");
  const state = await readInitiativeState();
  const existingIndex = state.entries.findIndex((entry) => entry.tokenId === token.id);
  if (existingIndex >= 0) {
    state.entries.splice(existingIndex, 1);
    if (state.activeTokenId === token.id) {
      state.activeTokenId = sortInitiativeEntries(state.entries)[0]?.tokenId ?? null;
    }
    await writeInitiativeState(state);
    return { added: false, state };
  }

  if (state.entries.length >= MAX_INITIATIVE_ENTRIES) {
    throw new Error(`A iniciativa suporta até ${MAX_INITIATIVE_ENTRIES} personagens.`);
  }

  state.entries.push({
    tokenId: token.id,
    name: String(token.name ?? "Personagem").slice(0, 100),
    initiative: null,
    addedAt: Date.now(),
  });
  if (!state.activeTokenId) state.activeTokenId = token.id;
  await writeInitiativeState(state);
  return { added: true, state };
}
