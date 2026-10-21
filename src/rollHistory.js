import OBR from "@owlbear-rodeo/sdk";

export const EXTENSION_ID = "com.agentesaparicoes.character-sheet";
export const ROLL_HISTORY_KEY = `${EXTENSION_ID}/roll-history`;
// Room metadata is limited to 16 kB. Keep the shared event log compact.
export const MAX_ROLL_HISTORY = 40;
export const MAX_REACTION_TYPES_PER_ENTRY = 4;
export const MAX_REACTORS_PER_EMOJI = 6;
export const MAX_DIE_RESULTS = 6; // Initial result plus at most five rerolls.

const REACTION_EMOJIS = new Set(["👍", "❤️", "😂", "😮", "😢", "🎉", "🔥", "👀", "💀", "🤔", "👏", "✅"]);
let historyWriteQueue = Promise.resolve();

function normalizeReactions(value) {
  const seenEmojis = new Set();
  const source = Array.isArray(value) ? value : [];
  const result = [];
  for (const item of source) {
    const emoji = Array.isArray(item) ? item[0] : item?.emoji;
    const usersValue = Array.isArray(item) ? item[1] : item?.users;
    if (typeof emoji !== "string" || !REACTION_EMOJIS.has(emoji) || seenEmojis.has(emoji)) continue;
    const users = [...new Set((Array.isArray(usersValue) ? usersValue : [])
      .filter((user) => typeof user === "string" && /^[a-z0-9]{1,8}$/i.test(user)))].slice(0, MAX_REACTORS_PER_EMOJI);
    if (!users.length) continue;
    seenEmojis.add(emoji);
    result.push({ emoji, users });
    if (result.length >= MAX_REACTION_TYPES_PER_ENTRY) break;
  }
  return result;
}

function normalizeDt(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 && numeric <= 9999 ? numeric : null;
}

function normalizeDice(rawDice, sortLegacy = true) {
  if (!Array.isArray(rawDice) || rawDice.length < 1 || rawDice.length > 5) return null;
  const legacyNumeric = rawDice.every((die) => Number.isInteger(die));
  const dice = [];
  for (const rawDie of rawDice) {
    const rawRolls = Number.isInteger(rawDie)
      ? [rawDie]
      : Array.isArray(rawDie)
        ? rawDie
        : Array.isArray(rawDie?.rolls)
          ? rawDie.rolls
          : null;
    if (!rawRolls || rawRolls.length < 1 || rawRolls.length > MAX_DIE_RESULTS) return null;
    if (!rawRolls.every((value) => Number.isInteger(value) && value >= 1 && value <= 10)) return null;
    dice.push({ rolls: [...rawRolls] });
  }
  // Old log entries stored values as a descending number array. Preserve that
  // ordering for backward compatibility while leaving rerolled dice in place.
  if (legacyNumeric && sortLegacy) dice.sort((a, b) => b.rolls[0] - a.rolls[0]);
  return dice;
}

function normalizeInlineRolls(value) {
  const source = Array.isArray(value) ? value : [];
  const result = [];
  for (const raw of source) {
    if (result.length >= 10 || !raw || typeof raw !== "object") break;
    const diceSource = Array.isArray(raw.dice) ? raw.dice : null;
    if (!diceSource || diceSource.length < 1 || diceSource.length > 5) continue;
    const dice = [];
    for (const die of diceSource) {
      const rolls = Number.isInteger(die)
        ? [die]
        : Array.isArray(die)
          ? die
          : Array.isArray(die?.rolls)
            ? die.rolls
            : null;
      if (!rolls || !rolls.length || rolls.length > MAX_DIE_RESULTS || !rolls.every((value) => Number.isInteger(value) && value >= 1 && value <= 10)) {
        dice.length = 0;
        break;
      }
      dice.push({ rolls: [...rolls] });
    }
    if (!dice.length) continue;
    const type = raw.type === "skill-roll" ? "skill-roll" : "dice-roll";
    result.push({
      type,
      syntax: String(raw.syntax ?? "").slice(0, 80),
      label: String(raw.label ?? raw.skillName ?? `${diceSource.length}d10`).slice(0, 100),
      skillName: type === "skill-roll" ? String(raw.skillName ?? raw.label ?? "Perícia").slice(0, 100) : "",
      skillId: type === "skill-roll" ? String(raw.skillId ?? "").slice(0, 60) : "",
      rank: type === "skill-roll" ? Math.max(1, Math.min(5, Number.parseInt(raw.rank, 10) || diceSource.length)) : diceSource.length,
      dice,
      dt: normalizeDt(raw.dt),
    });
  }
  return result;
}

function compactInlineDice(dice = []) {
  return dice.map((die) => Array.isArray(die?.rolls) ? die.rolls : [die]);
}

function compactInlineRolls(value) {
  return normalizeInlineRolls(value).map((roll) => roll.type === "skill-roll"
    ? ["s", roll.syntax, roll.skillName, roll.skillId, compactInlineDice(roll.dice), roll.dt]
    : ["d", roll.syntax, roll.label, compactInlineDice(roll.dice), roll.dt]);
}

function expandInlineRolls(value) {
  if (!Array.isArray(value)) return [];
  return value.map((roll) => {
    if (!Array.isArray(roll)) return roll;
    if (roll[0] === "s") return { type: "skill-roll", syntax: roll[1], skillName: roll[2], skillId: roll[3], dice: roll[4], dt: roll[5] ?? null };
    if (roll[0] === "d") return { type: "dice-roll", syntax: roll[1], label: roll[2], dice: roll[3], dt: roll[4] ?? null };
    return null;
  }).filter(Boolean);
}

function entryFromCompact(value) {
  if (!Array.isArray(value)) return null;
  if (value[0] === "s") {
    return {
      id: value[1], type: "skill-roll", rolledAt: value[2], characterName: value[3],
      playerName: value[4], skillName: value[5], skillId: value[6], dice: value[7], reactions: value[8], dt: value[9] ?? null,
      tokenId: value[10] ?? "",
    };
  }
  if (value[0] === "a") {
    return {
      id: value[1], type: "ability-use", usedAt: value[2], characterName: value[3],
      playerName: value[4], abilityName: value[5], kind: value[6], reactions: value[7],
      traits: value[8] ?? "", description: value[9] ?? "", tokenId: value[10] ?? "",
      inlineRolls: expandInlineRolls(value[11]),
    };
  }
  if (value[0] === "m") {
    return {
      id: value[1], type: "manual-roll", rolledAt: value[2], characterName: value[3],
      playerName: value[4], dice: value[5], dt: value[6] ?? null, reactions: value[7], tokenId: value[8] ?? "",
    };
  }
  if (value[0] === "c") {
    return {
      id: value[1], type: "chat-message", rolledAt: value[2], characterName: value[3],
      playerName: value[4], message: value[5], tokenId: value[6] ?? "",
      inlineRolls: expandInlineRolls(value[7]), reactions: value[8],
    };
  }
  return null;
}

function normalizeEntry(rawValue) {
  const value = Array.isArray(rawValue) ? entryFromCompact(rawValue) : rawValue;
  if (!value || typeof value !== "object" || typeof value.id !== "string" || !value.id) return null;

  const timestampCandidate = value.type === "ability-use" ? (value.usedAt ?? value.rolledAt) : (value.rolledAt ?? value.usedAt);
  const timestamp = Number(timestampCandidate);
  const eventTime = Number.isFinite(timestamp) && Number.isFinite(new Date(timestamp).getTime()) ? timestamp : Date.now();
  const common = {
    id: value.id.slice(0, 100),
    characterName: String(value.characterName ?? (value.type === "chat-message" ? "" : "Personagem")).slice(0, 70),
    playerName: String(value.playerName ?? "Jogador").slice(0, 70),
    rolledAt: eventTime,
    reactions: normalizeReactions(value.reactions),
    tokenId: String(value.tokenId ?? "").slice(0, 100),
  };

  if (value.type === "skill-roll" || value.type === "manual-roll") {
    const dice = normalizeDice(value.dice);
    if (!dice) return null;
    if (value.type === "skill-roll") {
      if (typeof value.skillName !== "string") return null;
      return {
        ...common,
        type: "skill-roll",
        skillId: String(value.skillId ?? "").slice(0, 60),
        skillName: value.skillName.slice(0, 100),
        dice,
        count: dice.length,
        dt: normalizeDt(value.dt),
        tokenId: common.tokenId,
      };
    }
    return {
      ...common,
      type: "manual-roll",
      rollName: String(value.rollName ?? "Rolagem de dados").slice(0, 100),
      dice,
      count: dice.length,
      dt: normalizeDt(value.dt),
      tokenId: common.tokenId,
    };
  }

  if (
    value.type === "ability-use" &&
    (value.kind === "power" || value.kind === "ritual") &&
    typeof value.abilityName === "string" && value.abilityName.trim()
  ) {
    return {
      ...common,
      type: "ability-use",
      kind: value.kind,
      abilityName: value.abilityName.trim().slice(0, 140),
      traits: (Array.isArray(value.traits) ? value.traits : String(value.traits ?? "").split(/[;,]/))
        .map((trait) => String(trait ?? "").trim().slice(0, 80))
        .filter(Boolean)
        .slice(0, 20),
      description: String(value.description ?? "").slice(0, 6000),
      tokenId: common.tokenId,
      inlineRolls: normalizeInlineRolls(value.inlineRolls),
    };
  }

  if (value.type === "chat-message" && typeof value.message === "string") {
    return {
      ...common,
      type: "chat-message",
      message: value.message.slice(0, 2000),
      tokenId: common.tokenId,
      inlineRolls: normalizeInlineRolls(value.inlineRolls),
    };
  }
  return null;
}

export function normalizeRollHistory(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map(normalizeEntry)
    .filter((entry) => {
      if (!entry || seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    })
    .sort((a, b) => a.rolledAt - b.rolledAt)
    .slice(-MAX_ROLL_HISTORY);
}

function compactReactions(reactions = []) {
  return normalizeReactions(reactions).map(({ emoji, users }) => [emoji, users]);
}

function compactDice(dice = []) {
  return dice.map((die) => die.rolls);
}

function compactLog(history) {
  const compact = normalizeRollHistory(history).map((entry) => {
    const reactions = compactReactions(entry.reactions);
    if (entry.type === "skill-roll") {
      return ["s", entry.id, entry.rolledAt, entry.characterName, entry.playerName, entry.skillName, entry.skillId, compactDice(entry.dice), reactions, entry.dt, entry.tokenId];
    }
    if (entry.type === "manual-roll") {
      return ["m", entry.id, entry.rolledAt, entry.characterName, entry.playerName, compactDice(entry.dice), entry.dt, reactions, entry.tokenId];
    }
    if (entry.type === "chat-message") {
      return ["c", entry.id, entry.rolledAt, entry.characterName, entry.playerName, entry.message, entry.tokenId, compactInlineRolls(entry.inlineRolls), reactions];
    }
    return ["a", entry.id, entry.rolledAt, entry.characterName, entry.playerName, entry.abilityName, entry.kind, reactions, entry.traits.join(", "), entry.description, entry.tokenId, compactInlineRolls(entry.inlineRolls)];
  });

  // Room metadata is limited to 16 kB. Keep a safety margin by shortening
  // older ability text first, preserving complete details for recent events.
  const maxBytes = 14500;
  const serializedSize = () => new TextEncoder().encode(JSON.stringify(compact)).length;
  let size = serializedSize();
  if (size > maxBytes) {
    for (const entry of compact) {
      if (entry[0] !== "a" && entry[0] !== "c") continue;
      const fieldIndexes = entry[0] === "a" ? [9, 8] : [5];
      for (const fieldIndex of fieldIndexes) {
        const value = entry[fieldIndex];
        if (typeof value !== "string" || !value.length || size <= maxBytes) continue;
        const excess = size - maxBytes + 32;
        const keep = Math.max(0, value.length - excess - 1);
        entry[fieldIndex] = keep ? `${value.slice(0, keep)}…` : "";
        size = serializedSize();
      }
      if (size <= maxBytes) break;
    }
  }
  while (size > maxBytes && compact.length > 1) {
    compact.shift();
    size = serializedSize();
  }
  return compact;
}

async function getStoredHistory() {
  const metadata = await OBR.room.getMetadata();
  return normalizeRollHistory(metadata?.[ROLL_HISTORY_KEY]);
}

async function saveHistory(history) {
  const updated = normalizeRollHistory(history);
  await OBR.room.setMetadata({ [ROLL_HISTORY_KEY]: compactLog(updated) });
  return updated;
}

export async function readRollHistory() {
  return getStoredHistory();
}

export function appendRollHistory(value) {
  const operation = async () => {
    const entry = normalizeEntry(value);
    if (!entry) return getStoredHistory();

    const existing = await getStoredHistory();
    if (existing.some((item) => item.id === entry.id)) return existing;
    return saveHistory([...existing, entry]);
  };

  historyWriteQueue = historyWriteQueue.then(operation, operation);
  return historyWriteQueue;
}

export function updateRollHistoryEntry(entryId, patch) {
  const operation = async () => {
    const history = await getStoredHistory();
    const entry = history.find((item) => item.id === entryId);
    if (!entry) return { ok: false, reason: "missing", history };

    if (Object.hasOwn(patch ?? {}, "dt") && (entry.type === "skill-roll" || entry.type === "manual-roll")) {
      const rawDt = patch.dt;
      if (rawDt === null || rawDt === "") entry.dt = null;
      else {
        const parsedDt = Number(rawDt);
        if (!Number.isInteger(parsedDt) || parsedDt < 0 || parsedDt > 9999) {
          return { ok: false, reason: "invalid-dt", history };
        }
        entry.dt = parsedDt;
      }
    }
    if (Object.hasOwn(patch ?? {}, "dice") && (entry.type === "skill-roll" || entry.type === "manual-roll")) {
      const normalizedDice = normalizeDice(patch.dice, false);
      if (!normalizedDice) return { ok: false, reason: "invalid-dice", history };
      entry.dice = normalizedDice;
    }
    if (Object.hasOwn(patch ?? {}, "inlineDt")) {
      const inlineIndex = Number(patch.inlineRollIndex);
      const inlineRoll = ["ability-use", "chat-message"].includes(entry.type) ? entry.inlineRolls?.[inlineIndex] : null;
      if (!inlineRoll) return { ok: false, reason: "missing-inline-roll", history };
      const rawDt = patch.inlineDt;
      if (rawDt === null || rawDt === "") inlineRoll.dt = null;
      else {
        const parsedDt = Number(rawDt);
        if (!Number.isInteger(parsedDt) || parsedDt < 0 || parsedDt > 9999) {
          return { ok: false, reason: "invalid-dt", history };
        }
        inlineRoll.dt = parsedDt;
      }
    }

    return { ok: true, history: await saveHistory(history) };
  };

  historyWriteQueue = historyWriteQueue.then(operation, operation);
  return historyWriteQueue;
}

export function rerollLogDie(entryId, dieIndex, newValue, inlineRollIndex = null) {
  const operation = async () => {
    const history = await getStoredHistory();
    const entry = history.find((item) => item.id === entryId);
    const inlineRoll = inlineRollIndex === null
      ? null
      : (["ability-use", "chat-message"].includes(entry?.type) ? entry.inlineRolls?.[inlineRollIndex] : null);
    const dice = inlineRoll
      ? inlineRoll.dice
      : (entry && ["skill-roll", "manual-roll"].includes(entry.type) ? entry.dice : null);
    if (!entry || !dice) return { ok: false, reason: "missing", history };
    if (!Number.isInteger(dieIndex) || dieIndex < 0 || dieIndex >= dice.length) return { ok: false, reason: "invalid-die", history };
    if (!Number.isInteger(newValue) || newValue < 1 || newValue > 10) return { ok: false, reason: "invalid-value", history };

    const die = dice[dieIndex];
    if (die.rolls.length >= MAX_DIE_RESULTS) return { ok: false, reason: "reroll-limit", history };
    die.rolls.push(newValue);
    return { ok: true, history: await saveHistory(history) };
  };

  historyWriteQueue = historyWriteQueue.then(operation, operation);
  return historyWriteQueue;
}

export function toggleLogReaction(entryId, emoji, playerKey) {
  const operation = async () => {
    if (!REACTION_EMOJIS.has(emoji) || typeof playerKey !== "string" || !playerKey) {
      return { ok: false, reason: "invalid", history: await getStoredHistory() };
    }

    const history = await getStoredHistory();
    const entry = history.find((item) => item.id === entryId);
    if (!entry) return { ok: false, reason: "missing", history };

    const reactions = normalizeReactions(entry.reactions).map((reaction) => ({
      emoji: reaction.emoji,
      users: [...reaction.users],
    }));
    let reaction = reactions.find((item) => item.emoji === emoji);

    if (reaction?.users.includes(playerKey)) {
      reaction.users = reaction.users.filter((user) => user !== playerKey);
      if (!reaction.users.length) reactions.splice(reactions.indexOf(reaction), 1);
    } else if (reaction) {
      if (reaction.users.length >= MAX_REACTORS_PER_EMOJI) {
        return { ok: false, reason: "user-limit", history };
      }
      reaction.users.push(playerKey);
    } else {
      if (reactions.length >= MAX_REACTION_TYPES_PER_ENTRY) {
        return { ok: false, reason: "emoji-limit", history };
      }
      reaction = { emoji, users: [playerKey] };
      reactions.push(reaction);
    }

    entry.reactions = reactions;
    return { ok: true, history: await saveHistory(history) };
  };

  historyWriteQueue = historyWriteQueue.then(operation, operation);
  return historyWriteQueue;
}

export function clearRollHistory() {
  const operation = async () => {
    await OBR.room.setMetadata({ [ROLL_HISTORY_KEY]: [] });
    return [];
  };
  historyWriteQueue = historyWriteQueue.then(operation, operation);
  return historyWriteQueue;
}
