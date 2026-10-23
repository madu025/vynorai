/**
 * Share card styles (pure, no canvas): the same ShareCard (shareCard.ts) can be drawn three ways,
 * like the demo's picker. A style is offered only when the card holds what it shows, so no style
 * ever draws an empty picture:
 *   summary  the original card: KPI tiles, one sentence, bars (always available)
 *   chart    a big bar chart with smaller tiles (needs at least two bars)
 *   insight  a dark card led by the one sentence that matters (needs a headline)
 * The canvas drawing is in shareCardStyles.ts; the sizes are decided here so they can be tested.
 */
import type { ShareCard } from "./shareCard.js";

export const SHARE_STYLES = ["summary", "chart", "insight"] as const;
export type ShareStyle = (typeof SHARE_STYLES)[number];

export const SHARE_STYLE_KEY = "vynorai.m365.shareStyle";

export function parseShareStyle(value: unknown): ShareStyle | undefined {
  return SHARE_STYLES.find((style) => style === value);
}

type CardParts = Pick<ShareCard, "bars" | "headline">;

export function availableShareStyles(card: CardParts): ShareStyle[] {
  const styles: ShareStyle[] = ["summary"];
  if (card.bars.length >= 2) styles.push("chart");
  if (card.headline.trim()) styles.push("insight");
  return styles;
}

/** The wanted style when this card can show it, else the original summary. */
export function pickShareStyle(
  card: CardParts,
  wanted: ShareStyle | undefined,
): ShareStyle {
  return wanted && availableShareStyles(card).includes(wanted)
    ? wanted
    : "summary";
}

export const CARD_WIDTH = 1080;

export interface ChartStyleLayout {
  height: number;
  tiles: number;
  tilesY: number;
  tileHeight: number;
  panelY: number;
  panelHeight: number;
  bars: number;
  rowHeight: number;
}

/** The chart style: smaller tiles on top, the bars get the room. */
export function chartStyleLayout(tileCount: number, barCount: number): ChartStyleLayout {
  const bars = Math.min(5, Math.max(0, barCount));
  const tiles = Math.min(3, Math.max(0, tileCount));
  const tileHeight = 130;
  const tilesY = 170 + 36;
  const panelY = tilesY + (tiles ? tileHeight + 36 : 0);
  const rowHeight = 86;
  const panelHeight = 96 + bars * rowHeight + 24;
  return {
    height: panelY + panelHeight + 110,
    tiles,
    tilesY,
    tileHeight,
    panelY,
    panelHeight,
    bars,
    rowHeight,
  };
}

export interface InsightStyleLayout {
  height: number;
  headlineLines: number;
  headlineY: number;
  panelY: number | undefined;
  panelHeight: number;
  tiles: number;
  tilesY: number | undefined;
  footerY: number;
}

/** The insight style: the headline leads, then a small chart (if any bars), tiles and the footer. */
export function insightStyleLayout(
  headlineLines: number,
  barCount: number,
  tileCount: number,
): InsightStyleLayout {
  const lines = Math.min(4, Math.max(1, headlineLines));
  const headlineY = 262;
  let y = headlineY + (lines - 1) * 88 + 70;
  const panelHeight = 360;
  const panelY = barCount >= 2 ? y : undefined;
  if (panelY !== undefined) y += panelHeight + 40;
  const tiles = Math.min(3, Math.max(0, tileCount));
  const tilesY = tiles ? y : undefined;
  if (tiles) y += 150 + 40;
  return {
    height: y + 90,
    headlineLines: lines,
    headlineY,
    panelY,
    panelHeight,
    tiles,
    tilesY,
    footerY: y + 44,
  };
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** The style the person chose last time on this device; a blocked store gives undefined. */
export function readShareStyle(
  storage: StorageLike | undefined,
): ShareStyle | undefined {
  try {
    return parseShareStyle(storage?.getItem(SHARE_STYLE_KEY));
  } catch {
    return undefined;
  }
}

export function storeShareStyle(
  storage: StorageLike | undefined,
  style: ShareStyle,
): void {
  try {
    storage?.setItem(SHARE_STYLE_KEY, style);
  } catch {
    // The choice then lasts only until the pane closes.
  }
}
