import OBR from "@owlbear-rodeo/sdk";
import { startBarOverlayService } from "./barRenderer.js";
import { isSkillRoll, isAbilityUse, ROLL_CHANNEL, ABILITY_CHANNEL, EXTENSION_ID } from "./rollWindow.js";
import { appendRollHistory } from "./rollHistory.js";


function smallestViewportDimension(values, fallback) {
  const valid = values.map(Number).filter((value) => Number.isFinite(value) && value > 100);
  return valid.length ? Math.min(...valid) : fallback;
}

function getSheetEmbedHeight() {
  const height = smallestViewportDimension(
    [window.visualViewport?.height, window.innerHeight, window.screen?.availHeight],
    900,
  );
  const width = smallestViewportDimension(
    [window.visualViewport?.width, window.innerWidth, window.screen?.availWidth],
    1200,
  );
  // Keep the context-menu sheet inside small/landscape viewports. The iframe
  // remains scrollable, so fields further down the sheet are still reachable.
  if (width <= 600 || height <= 600) return Math.max(320, Math.min(680, Math.floor(height - 96)));
  return 760;
}

async function registerSheetContextMenu() {
  try {
    await OBR.contextMenu.remove(`${EXTENSION_ID}/open-sheet`);
  } catch {
    // No menu exists yet on first install.
  }

  await OBR.contextMenu.create({
    id: `${EXTENSION_ID}/open-sheet`,
    icons: [
      {
        icon: new URL("./icon.svg", window.location.href).href,
        label: "Ficha A&A",
        filter: { min: 1, max: 1 },
      },
    ],
    onClick() {},
    embed: {
      url: new URL("./sheet.html", window.location.href).href,
      height: getSheetEmbedHeight(),
    },
  });
}

OBR.onReady(async () => {
  try {
    await registerSheetContextMenu();

    let orientationTimer = null;
    window.addEventListener("orientationchange", () => {
      if (orientationTimer) window.clearTimeout(orientationTimer);
      orientationTimer = window.setTimeout(() => {
        void registerSheetContextMenu().catch((error) => console.debug("A&A: não foi possível ajustar a altura da ficha.", error));
      }, 220);
    });

    // The sender writes its own event; all other clients append remote events
    // to the room's shared CHAT instead of opening an extra result popover.
    OBR.broadcast.onMessage(ROLL_CHANNEL, (event) => {
      if (!isSkillRoll(event.data)) return;
      void appendRollHistory(event.data).catch((error) => {
        console.error("A&A: não foi possível registrar a rolagem recebida no CHAT.", error);
      });
    });

    OBR.broadcast.onMessage(ABILITY_CHANNEL, (event) => {
      if (!isAbilityUse(event.data)) return;
      void appendRollHistory(event.data).catch((error) => {
        console.error("A&A: não foi possível registrar a habilidade recebida no CHAT.", error);
      });
    });

    startBarOverlayService();
  } catch (error) {
    console.error("A&A: não foi possível iniciar a extensão.", error);
  }
});
