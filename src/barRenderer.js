import OBR, { buildCurve, buildImage, buildText, isImage, Math2 } from "@owlbear-rodeo/sdk";
import { getTokenAppearanceLayout } from "./tokenAppearanceLayout.js";
import { normalizeAppearanceSettings } from "./appearanceSettings.js";

// A&A token data. The sheet itself remains in the token's persistent metadata.
const EXTENSION_ID = "com.agentesaparicoes.character-sheet";
const SHEET_KEY = `${EXTENSION_ID}/sheet`;
const DISPLAY_SETTINGS_KEY = `${EXTENSION_ID}/display-settings`;
const LEGACY_BAR_KEY = `${EXTENSION_ID}/bar`;

// Adapted from the open-source Bubbles for Owlbear Rodeo health-bar approach.
// The track and the filled portion are native Curve items, not remote images.
const BAR_PADDING = 2;
const BAR_GAP = 3;
const BACKGROUND_OPACITY = 0.24;
const FILL_OPACITY = 0.9;
const LINE_HEIGHT = 1;
const DISABLE_ATTACHMENT_BEHAVIORS = ["ROTATION", "VISIBLE", "COPY", "SCALE"];

let sceneActive = false;
let unsubscribeItems = null;
let unsubscribeGrid = null;
let unsubscribeRoomMetadata = null;
let unsubscribeReady = null;
let lastSignatures = new Map();
let reconciliationQueue = Promise.resolve();
let scheduleTimer = null;
let forceNextReconcile = false;

function finiteInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : fallback;
}

const normalizeDisplaySettings = normalizeAppearanceSettings;

function normalizeResourceSheet(token, settings) {
  const saved = token?.metadata?.[SHEET_KEY];
  if (!saved || typeof saved !== "object") return null;

  // Keep compatibility with data created by v0.10/v0.11. Legacy Current is
  // migrated to Normal; Chronic starts at zero; legacy Max becomes Unconscious.
  const woundsNormal = Math.max(0, finiteInteger(saved.resourceOneNormal ?? saved.resourceOneCurrent, 0));
  const woundsChronic = Math.max(0, finiteInteger(saved.resourceOneChronic, 0));
  const woundsHurtAt = Math.max(1, finiteInteger(saved.resourceOneHurtAt, 5));
  const woundsUnconscious = Math.max(1, finiteInteger(saved.resourceOneUnconscious ?? saved.resourceOneUnconsciousAt ?? saved.resourceOneMax, 10));
  const woundsDeadAt = Math.max(woundsUnconscious + 1, finiteInteger(saved.resourceOneDeadAt, 20));
  const stressNormal = Math.max(0, finiteInteger(saved.resourceTwoNormal ?? saved.resourceTwoCurrent, 0));
  const stressChronic = Math.max(0, finiteInteger(saved.resourceTwoChronic, 0));
  const stressStressedAt = Math.max(1, finiteInteger(saved.resourceTwoStressedAt, 5));
  const stressUnconscious = Math.max(1, finiteInteger(saved.resourceTwoUnconscious ?? saved.resourceTwoLosingMindAt ?? saved.resourceTwoUnconsciousAt ?? saved.resourceTwoMax, 10));
  const stressInsaneAt = Math.max(stressUnconscious + 1, finiteInteger(saved.resourceTwoInsaneAt, 20));
  const woundsCurrent = woundsNormal + woundsChronic;
  const stressCurrent = stressNormal + stressChronic;

  return {
    wounds: { current: woundsCurrent, max: woundsUnconscious, hardLimit: woundsDeadAt, hurtAt: woundsHurtAt, color: settings.woundsColor, backgroundColor: settings.woundsBackgroundColor, key: "wounds" },
    stress: { current: stressCurrent, max: stressUnconscious, hardLimit: stressInsaneAt, hurtAt: stressStressedAt, color: settings.stressColor, backgroundColor: settings.stressBackgroundColor, key: "stress" },
    evasion: saved.evasion === "" || saved.evasion === null || saved.evasion === undefined ? null : finiteInteger(saved.evasion, null),
    protection: saved.protection === "" || saved.protection === null || saved.protection === undefined ? null : finiteInteger(saved.protection, null),
    conviction: saved.conviction === "" || saved.conviction === null || saved.conviction === undefined ? null : finiteInteger(saved.conviction, null),
    hideFromPlayers: Boolean(saved.hideFromPlayers),
    showTokenName: saved.showTokenName !== false,
    nameAppearance: saved.nameAppearance && typeof saved.nameAppearance === "object" ? saved.nameAppearance : null,
  };
}

function isCharacterImage(item) {
  return Boolean(item && item.layer === "CHARACTER" && isImage(item));
}

function barItemIds(tokenId, resourceKey) {
  return {
    background: `${tokenId}-aa-${resourceKey}-background`,
    fill: `${tokenId}-aa-${resourceKey}-fill`,
    text: `${tokenId}-aa-${resourceKey}-text`,
    hurtMarker: `${tokenId}-aa-${resourceKey}-hurt-marker`,
    maxMarker: `${tokenId}-aa-${resourceKey}-max-marker`,
  };
}

function defenseStatsId(tokenId) {
  return `${tokenId}-aa-defense-stats`;
}

function defenseBoxIds(tokenId, defenseKey) {
  return {
    background: `${tokenId}-aa-defense-${defenseKey}-background`,
    text: `${tokenId}-aa-defense-${defenseKey}-text`,
  };
}

function tokenNameId(tokenId) {
  return `${tokenId}-aa-token-name`;
}

function unconsciousTintId(tokenId) {
  return `${tokenId}-aa-unconscious-tint`;
}

function allBarIds(tokenId) {
  return [
    ...Object.values(barItemIds(tokenId, "wounds")),
    ...Object.values(barItemIds(tokenId, "stress")),
    defenseStatsId(tokenId),
    ...["evasion", "protection", "conviction"].flatMap((key) => Object.values(defenseBoxIds(tokenId, key))),
    tokenNameId(tokenId),
    unconsciousTintId(tokenId),
  ];
}

async function deleteBarOverlays(tokenId) {
  await OBR.scene.local.deleteItems(allBarIds(tokenId));
}

function getImageDimensions(token, sceneDpi) {
  const sourceDpi = Number(token.grid?.dpi) || sceneDpi || 1;
  const dpiScale = sceneDpi / sourceDpi;
  return {
    width: Math.abs(token.image.width * dpiScale * token.scale.x),
    height: Math.abs(token.image.height * dpiScale * token.scale.y),
  };
}

// Matches the reference extension's center calculation, including grid offset,
// scene DPI and token rotation. This keeps bar width tied to the actual token.
function getImageCenter(token, sceneDpi) {
  let center = { x: token.image.width / 2, y: token.image.height / 2 };
  center = Math2.subtract(center, token.grid.offset);
  center = Math2.multiply(center, sceneDpi / (Number(token.grid?.dpi) || sceneDpi || 1));
  center = Math2.multiply(center, token.scale);
  center = Math2.rotate(center, { x: 0, y: 0 }, token.rotation);
  center = Math2.add(center, token.position);
  return center;
}

function drawArc(center, radius, startAngle, arcAngle, arcPoints) {
  arcPoints--;
  const points = [];
  const angleBetweenPoints = arcAngle / arcPoints;
  let angle = startAngle;
  for (let i = 0; i <= arcPoints; i++) {
    points.push({
      x: center.x + radius * Math.cos(angle),
      y: center.y - radius * Math.sin(angle),
    });
    angle += angleBetweenPoints;
  }
  return points;
}

/**
 * Creates the polygon points for a rounded bar, including a correctly rounded
 * right end for partial fills. Adapted from Bubbles for Owlbear Rodeo's
 * createRoundedRectangle helper (GPL-3.0; see THIRD_PARTY_NOTICES.md).
 */
function createRoundedRectangle(maxLength, height, radius, fill = 1, pointsInCorner = 10) {
  fill = Math.max(0, Math.min(1, fill));
  if (radius * 2 > height) radius = height * 0.5;

  if (fill >= 1) {
    return [
      { x: radius, y: 0 },
      { x: maxLength - radius, y: 0 },
      ...drawArc({ x: maxLength - radius, y: radius }, radius, Math.PI * 0.5, -Math.PI * 0.5, pointsInCorner),
      ...drawArc({ x: maxLength - radius, y: height - radius }, radius, 0, -Math.PI * 0.5, pointsInCorner),
      { x: maxLength - radius, y: height },
      { x: radius, y: height },
      ...drawArc({ x: radius, y: height - radius }, radius, -Math.PI * 0.5, -Math.PI * 0.5, pointsInCorner),
      ...drawArc({ x: radius, y: radius }, radius, -Math.PI, -Math.PI * 0.5, pointsInCorner),
    ];
  }

  const filledLength = fill * maxLength;
  if (filledLength <= 0) return [];

  if (filledLength < radius) {
    const referenceAngle = Math.acos(Math.max(-1, Math.min(1, (radius - filledLength) / radius)));
    return [
      ...drawArc({ x: radius, y: height - radius }, radius, Math.PI + referenceAngle, -referenceAngle, pointsInCorner),
      ...drawArc({ x: radius, y: radius }, radius, Math.PI, -referenceAngle, pointsInCorner),
    ];
  }

  const remainingLength = maxLength - filledLength;
  if (remainingLength < radius) {
    const referenceAngle = Math.acos(Math.max(-1, Math.min(1, (radius - remainingLength) / radius)));
    return [
      { x: radius, y: 0 },
      { x: maxLength - radius, y: 0 },
      ...drawArc({ x: maxLength - radius, y: radius }, radius, Math.PI * 0.5, -Math.PI * 0.5 + referenceAngle, pointsInCorner),
      ...drawArc({ x: maxLength - radius, y: height - radius }, radius, -referenceAngle, -Math.PI * 0.5 + referenceAngle, pointsInCorner),
      { x: maxLength - radius, y: height },
      { x: radius, y: height },
      ...drawArc({ x: radius, y: height - radius }, radius, -Math.PI * 0.5, -Math.PI * 0.5, pointsInCorner),
      ...drawArc({ x: radius, y: radius }, radius, -Math.PI, -Math.PI * 0.5, pointsInCorner),
    ];
  }

  return [
    { x: radius, y: 0 },
    { x: filledLength, y: 0 },
    { x: filledLength, y: height },
    { x: radius, y: height },
    ...drawArc({ x: radius, y: height - radius }, radius, -Math.PI * 0.5, -Math.PI * 0.5, pointsInCorner),
    ...drawArc({ x: radius, y: radius }, radius, -Math.PI, -Math.PI * 0.5, pointsInCorner),
  ];
}

function curveBase(token, id, position, zIndex) {
  return buildCurve()
    .position(position)
    .zIndex(zIndex)
    .attachedTo(token.id)
    .layer("ATTACHMENT")
    .locked(true)
    .id(id)
    .visible(token.visible ?? true)
    .disableAttachmentBehavior(DISABLE_ATTACHMENT_BEHAVIORS)
    .disableHit(true)
    .tension(0)
    .closed(true)
    .strokeWidth(0);
}

function makeResourceBar(token, resource, geometry, settings, showNumbers) {
  if (!resource || Number(resource.max) <= 0) return [];
  const { x, y, width, height } = geometry;
  const radius = height / 2;
  const ratio = Math.max(0, Math.min(1, resource.current / Math.max(1, resource.max)));
  const label = `${resource.current}`;
  const ids = barItemIds(token.id, resource.key);
  const items = [];

  const background = curveBase(token, ids.background, { x, y }, 10000)
    .fillColor(resource.backgroundColor)
    .fillOpacity(BACKGROUND_OPACITY)
    .points(createRoundedRectangle(width, height, radius))
    .build();
  items.push(background);

  if (ratio > 0) {
    const fill = curveBase(token, ids.fill, { x, y }, 20000)
      .fillColor(resource.color)
      .fillOpacity(FILL_OPACITY)
      .strokeOpacity(0)
      .points(createRoundedRectangle(width, height, radius, ratio))
      .build();
    items.push(fill);
  }

  const markerWidth = Math.max(0.35, Math.min(1.2, height * 0.08));
  const markerInset = Math.max(0.8, height * 0.18);
  const markerPositions = [
    { id: ids.hurtMarker, value: resource.hurtAt },
    { id: ids.maxMarker, value: resource.max },
  ];
  for (const marker of markerPositions) {
    if (!Number.isFinite(Number(marker.value)) || Number(marker.value) <= 0) continue;
    const left = Math.min(width - markerWidth / 2, Math.max(markerWidth / 2, (Number(marker.value) / Math.max(1, resource.max)) * width));
    const shape = curveBase(token, marker.id, { x: x + left - markerWidth / 2, y: y + markerInset }, 25000)
      .fillColor("#454545")
      .fillOpacity(0.66)
      .points(createRoundedRectangle(markerWidth, Math.max(1, height - markerInset * 2), markerWidth / 2))
      .build();
    items.push(shape);
  }

  if (showNumbers) {
    const fontFactor = 0.68;
    const fontSize = Math.max(2.4, Math.min(height * 0.78, width / Math.max(4, label.length * fontFactor)));
    const horizontalInset = settings.barAlignment === "center" ? 0 : Math.max(1, height * 0.4);
    const textX = settings.barAlignment === "left" ? x + horizontalInset : x;
    const textWidth = Math.max(1, width - horizontalInset);
    const text = buildText()
      .position({ x: textX, y })
      .plainText(label)
      .textAlign(canvasAlignment(settings.barAlignment))
      .textAlignVertical("MIDDLE")
      .fontSize(fontSize)
      .fontFamily(settings.barFont)
      .textType("PLAIN")
      .padding(1)
      .height(height)
      .width(textWidth)
      .fontWeight(600)
      .attachedTo(token.id)
      .fillColor(settings.barTextColor)
      .fillOpacity(1)
      .layer("TEXT")
      .lineHeight(LINE_HEIGHT)
      .locked(true)
      .id(ids.text)
      .visible(token.visible ?? true)
      .disableAttachmentBehavior(DISABLE_ATTACHMENT_BEHAVIORS)
      .disableHit(true)
      .build();
    items.push(text);
  }

  return items;
}

function canvasAlignment(value) {
  if (value === "left") return "LEFT";
  if (value === "right") return "RIGHT";
  return "CENTER";
}

function makeDefenseStats(token, sheet, geometry, settings) {
  const { x, y, width, height } = geometry;
  const defs = [
    { key: "evasion", label: "EVA", value: sheet.evasion, color: settings.evasionBackgroundColor },
    { key: "protection", label: "PRO", value: sheet.protection, color: settings.protectionBackgroundColor },
    { key: "conviction", label: "CON", value: sheet.conviction, color: settings.convictionBackgroundColor },
  ];
  if (!defs.some((item) => item.value !== null)) return [];

  const boxGap = Math.max(1, Math.min(2.5, height * 0.08));
  const boxWidth = (width - boxGap * 2) / 3;
  const fontHeightFactor = settings.defenseSize === "large" ? 0.70 : 0.69;
  const items = [];
  defs.forEach((definition, index) => {
    const boxX = x + index * (boxWidth + boxGap);
    const ids = defenseBoxIds(token.id, definition.key);
    const radius = height / 2;
    const background = curveBase(token, ids.background, { x: boxX, y }, 11000 + index)
      .fillColor(definition.color)
      .fillOpacity(BACKGROUND_OPACITY)
      .points(createRoundedRectangle(boxWidth, height, radius))
      .build();
    items.push(background);

    const valueText = `${definition.label} ${definition.value === null ? "–" : definition.value}`;
    const fontSize = Math.max(1.3, Math.min(height * fontHeightFactor, boxWidth / Math.max(4, valueText.length * 0.60)));
    const text = buildText()
      .position({ x: boxX, y })
      .plainText(valueText)
      .textAlign("CENTER")
      .textAlignVertical("MIDDLE")
      .fontSize(fontSize)
      .fontFamily(settings.defenseFont)
      .textType("PLAIN")
      .padding(0)
      .height(height)
      .width(boxWidth)
      .fontWeight(700)
      .attachedTo(token.id)
      .fillColor(settings.defenseColor)
      .fillOpacity(1)
      .layer("TEXT")
      .lineHeight(1)
      .locked(true)
      .id(ids.text)
      .visible(token.visible ?? true)
      .disableAttachmentBehavior(DISABLE_ATTACHMENT_BEHAVIORS)
      .disableHit(true)
      .build();
    items.push(text);
  });
  return items;
}

function makeTokenName(token, geometry, settings) {
  const { x, y, width, height } = geometry;
  const name = String(token.name ?? "").trim();
  if (!name) return [];
  const fontFactor = 0.55;
  const widthFitFontSize = Math.max(2.5, width / Math.max(1, name.length * fontFactor));
  const fallbackMinimum = Math.max(2.5, Math.min(height * 0.18, widthFitFontSize * 0.48));
  const fontSize = Number.isFinite(Number(geometry.fontSize))
    ? Math.max(2.5, Number(geometry.fontSize))
    : fallbackMinimum + (widthFitFontSize - fallbackMinimum) * (Math.max(0, Math.min(100, Number(settings.nameSizePercent) || 0)) / 100);
  const text = buildText()
    .position({ x, y })
    .plainText(name)
    .textAlign(canvasAlignment(settings.nameAlignment))
    .textAlignVertical("MIDDLE")
    .fontSize(fontSize)
    .fontFamily(settings.nameFont)
    .textType("PLAIN")
    .padding(0)
    .height(height)
    .width(width)
    .fontWeight(700)
    .attachedTo(token.id)
    .fillColor(settings.nameColor)
    .fillOpacity(1)
    .layer("TEXT")
    .lineHeight(LINE_HEIGHT)
    .locked(true)
    .id(tokenNameId(token.id))
    .visible(token.visible ?? true)
    .disableAttachmentBehavior(DISABLE_ATTACHMENT_BEHAVIORS)
    .disableHit(true)
    .build();
  return [text];
}

async function renderTokenBars(token, sheet, sceneDpi, role, settings) {
  await deleteBarOverlays(token.id);
  const bounds = getImageDimensions(token, sceneDpi);
  if (!bounds.width || !bounds.height) return;
  const center = getImageCenter(token, sceneDpi);
  const showDetails = role === "GM" || !sheet.hideFromPlayers;
  const hasDefenseValues = [sheet.evasion, sheet.protection, sheet.conviction].some((value) => value !== null);
  const showDefenseStats = showDetails && hasDefenseValues;
  const tokenNameSettings = normalizeDisplaySettings({ ...settings, ...(sheet.nameAppearance && typeof sheet.nameAppearance === "object" ? sheet.nameAppearance : {}) });
  const showName = sheet.showTokenName && String(token.name ?? "").trim().length > 0;
  const resources = [sheet.wounds, sheet.stress].filter((resource) => Number(resource?.max) > 0);

  const width = Math.max(1, bounds.width - BAR_PADDING * 2);
  const x = center.x - bounds.width / 2 + BAR_PADDING;
  const isLargeBar = settings.barSize === "large";
  const isLargeDefense = settings.defenseSize === "large";
  const height = isLargeBar
    ? Math.max(8, Math.min(15, bounds.height * 0.14))
    : Math.max(5, Math.min(10, bounds.height * 0.1));
  const gap = Math.max(isLargeBar ? 4 : BAR_GAP, Math.min(isLargeBar ? 6 : 4, bounds.height * (isLargeBar ? 0.03 : 0.025)));
  const statsHeight = showDefenseStats
    ? (isLargeDefense
      ? Math.max(9, Math.min(16, bounds.height * 0.12))
      : Math.max(5, Math.min(9, bounds.height * 0.085)))
    : 0;
  const nameWidthForSizing = Math.max(1, bounds.width);
  const nameLengthForSizing = Math.max(1, String(token.name ?? "").trim().length);
  const nameFitFontSize = Math.max(2.5, nameWidthForSizing / (nameLengthForSizing * 0.55));
  // 0% keeps a readable default close to the prior large-name size. At 100%,
  // average glyph width fills the token's width; both length and token size matter.
  const nameMinimumFontSize = Math.max(2.5, Math.min(bounds.height * 0.18, nameFitFontSize * 0.48));
  const effectiveNameFontSize = nameMinimumFontSize + (nameFitFontSize - nameMinimumFontSize) * (Math.max(0, Math.min(100, Number(tokenNameSettings.nameSizePercent) || 0)) / 100);
  const nameHeight = showName ? Math.max(8, effectiveNameFontSize * 1.4) : 0;
  const tokenTop = center.y - bounds.height / 2;
  const tokenBottom = center.y + bounds.height / 2;
  const resourceStackHeight = resources.length ? height * resources.length + gap * (resources.length - 1) : 0;
  const hasShownDefenseValues = statsHeight > 0;
  const groupHeights = {
    name: showName ? nameHeight : 0,
    bars: resourceStackHeight,
    defenses: hasShownDefenseValues ? statsHeight : 0,
  };
  const layout = getTokenAppearanceLayout(settings.barPlacement, settings.namePlacement);
  const groupsAbove = layout.above.filter((group) => groupHeights[group] > 0);
  const groupsBelow = layout.below.filter((group) => groupHeights[group] > 0);
  const aboveHeight = groupsAbove.reduce((total, group) => total + groupHeights[group], 0) + Math.max(0, groupsAbove.length - 1) * gap;
  const groupY = {};
  let upperCursor = tokenTop - gap - aboveHeight;
  for (const group of groupsAbove) {
    groupY[group] = upperCursor;
    upperCursor += groupHeights[group] + gap;
  }
  let lowerCursor = tokenBottom + gap;
  for (const group of groupsBelow) {
    groupY[group] = lowerCursor;
    lowerCursor += groupHeights[group] + gap;
  }
  const nameY = groupY.name ?? tokenTop - gap - nameHeight;
  const statsY = groupY.defenses ?? tokenBottom + gap;
  const firstY = groupY.bars ?? tokenBottom + gap;

  const items = [];

  if (showName) {
    const nameWidth = width;
    const nameX = x;
    items.push(...makeTokenName(token, { x: nameX, y: nameY, width: nameWidth, height: nameHeight, fontSize: effectiveNameFontSize }, tokenNameSettings));
  }
  if (showDefenseStats) {
    const statsWidth = isLargeDefense ? width : width * 0.76;
    const statsX = settings.defenseAlignment === "right" ? x + width - statsWidth : settings.defenseAlignment === "center" ? x + (width - statsWidth) / 2 : x;
    items.push(...makeDefenseStats(token, sheet, { x: statsX, y: statsY, width: statsWidth, height: statsHeight }, settings));
  }
  let resourceY = firstY;
  for (const resource of resources) {
    items.push(...makeResourceBar(token, resource, { x, y: resourceY, width, height }, settings, showDetails));
    resourceY += height + gap;
  }
  if (items.length) await OBR.scene.local.addItems(items);
}

function tokenSignature(token, sceneDpi, sheet, role, settings) {
  const showDetails = role === "GM" || !sheet.hideFromPlayers;
  return JSON.stringify({
    sceneDpi,
    role,
    showDetails,
    settings,
    image: { width: token.image.width, height: token.image.height, url: token.image.url },
    scale: token.scale,
    grid: { dpi: token.grid?.dpi, offset: token.grid?.offset },
    visible: token.visible,
    name: token.name,
    rotation: token.rotation,
    wounds: sheet.wounds,
    stress: sheet.stress,
    evasion: sheet.evasion,
    protection: sheet.protection,
    conviction: sheet.conviction,
    hideFromPlayers: sheet.hideFromPlayers,
    showTokenName: sheet.showTokenName,
    nameAppearance: sheet.nameAppearance,
    resourceOneDeadAt: sheet.wounds?.max,
    resourceTwoInsaneAt: sheet.stress?.max,
  });
}

async function removeLegacyPersistentBars() {
  const sceneItems = await OBR.scene.items.getItems(() => true);
  const legacyIds = sceneItems
    .filter((item) => typeof item.metadata?.[LEGACY_BAR_KEY]?.owner === "string")
    .map((item) => item.id);
  if (legacyIds.length) await OBR.scene.items.deleteItems(legacyIds);
}


async function reconcileBars(sceneItems, force = false) {
  const [sceneDpi, role, roomMetadata] = await Promise.all([
    OBR.scene.grid.getDpi(),
    OBR.player.getRole(),
    OBR.room.getMetadata(),
  ]);
  const settings = normalizeDisplaySettings(roomMetadata?.[DISPLAY_SETTINGS_KEY]);
  const currentSignatures = new Map();
  const supportedTokens = sceneItems.filter(isCharacterImage);

  // On first load, also clear any local overlays left behind by a development
  // reload. Only A&A's deterministic IDs are touched.
  if (force) {
    for (const token of supportedTokens) await deleteBarOverlays(token.id);
  }

  for (const token of supportedTokens) {
    const sheet = normalizeResourceSheet(token, settings);
    if (!sheet) continue;
    const signature = tokenSignature(token, sceneDpi, sheet, role, settings);
    currentSignatures.set(token.id, signature);
    if (force || lastSignatures.get(token.id) !== signature) {
      const visibleSheet = {
        ...sheet,
        hideFromPlayers: sheet.hideFromPlayers,
      };
      await renderTokenBars(token, visibleSheet, sceneDpi, role, settings);
    }
  }

  // If a tracked token was deleted or no longer has an A&A sheet, remove its
  // overlays as well.
  for (const tokenId of lastSignatures.keys()) {
    if (!currentSignatures.has(tokenId)) await deleteBarOverlays(tokenId);
  }
  lastSignatures = currentSignatures;
}

function scheduleReconcile(force = false) {
  forceNextReconcile ||= force;
  if (scheduleTimer) clearTimeout(scheduleTimer);
  scheduleTimer = setTimeout(() => {
    scheduleTimer = null;
    const forceNow = forceNextReconcile;
    forceNextReconcile = false;
    reconciliationQueue = reconciliationQueue
      .then(async () => {
        if (!sceneActive) return;
        const sceneItems = await OBR.scene.items.getItems(() => true);
        await reconcileBars(sceneItems, forceNow);
      })
      .catch((error) => console.error("A&A: erro ao atualizar as barras dos tokens.", error));
  }, 80);
}

async function startForCurrentScene() {
  if (sceneActive) return;
  sceneActive = true;
  lastSignatures = new Map();

  try {
    await removeLegacyPersistentBars();
    unsubscribeItems = OBR.scene.items.onChange(() => scheduleReconcile());
    const sceneItems = await OBR.scene.items.getItems(() => true);
    await reconcileBars(sceneItems, true);

    // If the grid DPI changes, recalculate fixed world-unit dimensions.
    if (OBR.scene.grid && typeof OBR.scene.grid.onChange === "function") {
      unsubscribeGrid = OBR.scene.grid.onChange(() => scheduleReconcile(true));
    }
    if (OBR.room && typeof OBR.room.onMetadataChange === "function") {
      unsubscribeRoomMetadata = OBR.room.onMetadataChange(() => scheduleReconcile());
    }
  } catch (error) {
    console.error("A&A: não foi possível inicializar as barras.", error);
  }
}

function stopForCurrentScene() {
  sceneActive = false;
  if (unsubscribeItems) unsubscribeItems();
  if (unsubscribeGrid) unsubscribeGrid();
  if (unsubscribeRoomMetadata) unsubscribeRoomMetadata();
  unsubscribeItems = null;
  unsubscribeGrid = null;
  unsubscribeRoomMetadata = null;
  lastSignatures = new Map();
  if (scheduleTimer) clearTimeout(scheduleTimer);
  scheduleTimer = null;
}

export function startBarOverlayService() {
  if (unsubscribeReady) return;
  unsubscribeReady = OBR.scene.onReadyChange((isReady) => {
    if (isReady) {
      void startForCurrentScene();
    } else {
      stopForCurrentScene();
    }
  });
  void OBR.scene.isReady().then((isReady) => {
    if (isReady) void startForCurrentScene();
  });
}
