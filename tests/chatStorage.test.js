import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { filterChatEntriesByEpoch, nextChatEpoch, normalizeChatEpoch, stampChatEntry } from "../src/chatEpoch.js";

const historySource = await readFile(new URL("../src/rollHistory.js", import.meta.url), "utf8");
const initiativeSource = await readFile(new URL("../src/initiative.js", import.meta.url), "utf8");
const mainSource = await readFile(new URL("../src/main.js", import.meta.url), "utf8");

test("clearing CHAT advances its epoch so old in-flight writes become invisible", () => {
  assert.equal(nextChatEpoch(0), 1);
  assert.equal(nextChatEpoch("3"), 4);
  assert.equal(normalizeChatEpoch(-1), 0);
  const oldEntry = stampChatEntry({ id: "before-clear" }, 4);
  const newEntry = stampChatEntry({ id: "after-clear" }, 5);
  assert.deepEqual(filterChatEntriesByEpoch([oldEntry, newEntry], 5).map((entry) => entry.id), ["after-clear"]);
});

test("legacy CHAT records belong to the initial epoch and do not return after a reset", () => {
  const legacyEntry = { id: "legacy-message" };
  const currentEntry = { id: "new-message", chatEpoch: 1 };
  assert.deepEqual(filterChatEntriesByEpoch([legacyEntry, currentEntry], 0), [legacyEntry]);
  assert.deepEqual(filterChatEntriesByEpoch([legacyEntry, currentEntry], 1), [currentEntry]);

  // Simulate a late network write from before the reset replacing the array
  // after the marker has advanced. The old message remains invisible.
  const lateWriteAfterClear = [stampChatEntry(legacyEntry, 0)];
  assert.deepEqual(filterChatEntriesByEpoch(lateWriteAfterClear, 1), []);
});

test("CHAT writes and recovery are bound to the current epoch", () => {
  assert.match(historySource, /if \(currentEpoch !== normalizeChatEpoch\(expectedEpoch\)\) return current/);
  assert.match(historySource, /entry\.chatEpoch === epoch/);
  assert.match(historySource, /await OBR\.room\.setMetadata\(\{ \[ROLL_HISTORY_KEY\]: \[\], \[CHAT_EPOCH_KEY\]: nextEpoch \}\)/);
  assert.ok(historySource.indexOf('const { epoch, history: existing } = await getStoredChatState();') < historySource.indexOf('const officialTimestamp = await getBrasiliaTimestamp();'));
  assert.match(historySource, /const confirmedState = await getStoredChatState\(\)/);
});

test("initiative state is stored per scene and migrated from older room metadata once", () => {
  assert.match(initiativeSource, /OBR\.scene\.getMetadata\(\)/);
  assert.match(initiativeSource, /OBR\.scene\.setMetadata\(\{ \[INITIATIVE_KEY\]: normalized \}\)/);
  assert.match(initiativeSource, /INITIATIVE_MIGRATION_KEY/);
  assert.match(initiativeSource, /\[INITIATIVE_KEY\]: null/);
  assert.match(mainSource, /OBR\.scene\.onMetadataChange/);
});

test("room CHAT refreshes cannot prune initiative entries", () => {
  const roomListenerStart = mainSource.indexOf("roomMetadataUnsubscribe = OBR.room.onMetadataChange");
  const sceneListenerStart = mainSource.indexOf("sceneMetadataUnsubscribe = OBR.scene.onMetadataChange", roomListenerStart);
  const roomListener = mainSource.slice(roomListenerStart, sceneListenerStart);
  assert.ok(roomListenerStart >= 0 && sceneListenerStart > roomListenerStart);
  assert.doesNotMatch(roomListener, /refreshInitiativeView/);
  assert.match(mainSource, /sceneItemsUnsubscribe = OBR\.scene\.items\.onChange\(\(\) => void refreshInitiativeView\(\{ pruneMissingTokens: true \}\)\)/);
  assert.match(mainSource, /async function refreshInitiativeView\(\{ pruneMissingTokens = false \} = \{\}\)/);
});

test("the 1.0 custom appearance-style controls remain available", async () => {
  const htmlSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(mainSource, /SAVED_THEME_STYLES_KEY/);
  assert.match(mainSource, /save-custom-theme/);
  assert.match(htmlSource, /id="saved-theme-styles"/);
  assert.match(htmlSource, /id="save-custom-theme"/);
});
