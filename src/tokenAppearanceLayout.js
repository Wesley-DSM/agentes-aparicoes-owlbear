/**
 * Layout for the token overlays. The selected combination decides which
 * elements sit above and below the token's width reference.
 * `barPlacement` keeps its historical name for data compatibility, but it
 * represents the placement choice for the status group (bars + defenses).
 */
export function getTokenAppearanceLayout(barPlacement = "bottom", namePlacement = "bottom") {
  const status = barPlacement === "top" ? "top" : "bottom";
  const name = namePlacement === "top" ? "top" : "bottom";

  if (status === "top" && name === "top") {
    return { above: ["name", "bars", "defenses"], below: [] };
  }
  if (status === "top" && name === "bottom") {
    return { above: ["bars", "defenses"], below: ["name"] };
  }
  if (status === "bottom" && name === "top") {
    return { above: ["name"], below: ["defenses", "bars"] };
  }
  return { above: [], below: ["defenses", "bars", "name"] };
}
