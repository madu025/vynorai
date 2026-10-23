/**
 * Draws a ShareCard in one of the picker's styles (shareStyle.ts). "summary" is the original card
 * (shareCardCanvas.ts, unchanged); "chart" and "insight" are drawn here from the same card, with
 * sizes from the pure layout functions. Needs a browser canvas, so it is checked by looking at it
 * (see the vynor-live-verify skill), not in unit tests.
 */
import type { ShareCard } from "./shareCard.js";
import { drawShareCard } from "./shareCardCanvas.js";
import {
  CARD_WIDTH,
  chartStyleLayout,
  insightStyleLayout,
  type ShareStyle,
} from "./shareStyle.js";

const SANS =
  "'Segoe UI','Noto Sans','Noto Sans Sinhala','Iskoola Pota','Nirmala UI','Noto Sans Tamil',system-ui,sans-serif";

function toolbox(ctx: CanvasRenderingContext2D) {
  const font = (weight: number, size: number) => {
    ctx.font = `${weight} ${size}px ${SANS}`;
  };
  const box = (x: number, y: number, w: number, h: number, r: number, color: string) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };
  const fit = (text: string, width: number, size: number, weight: number) => {
    let px = size;
    do {
      font(weight, px);
      px -= 2;
    } while (ctx.measureText(text).width > width && px > 16);
    return text;
  };
  const wrap = (text: string, width: number) => {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };
  return { font, box, fit, wrap };
}

function newCanvas(height: number): [HTMLCanvasElement, CanvasRenderingContext2D | null] {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = height;
  return [canvas, canvas.getContext("2d")];
}

function drawChartCard(card: ShareCard): HTMLCanvasElement {
  const layout = chartStyleLayout(card.tiles.length, card.bars.length);
  const [canvas, ctx] = newCanvas(Math.max(420, layout.height));
  if (!ctx) return canvas;
  const { font, box, fit } = toolbox(ctx);
  ctx.fillStyle = "#f1f3f9";
  ctx.fillRect(0, 0, CARD_WIDTH, canvas.height);
  const band = ctx.createLinearGradient(0, 0, CARD_WIDTH, 0);
  band.addColorStop(0, "#2f5bff");
  band.addColorStop(1, "#0e9f8e");
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, CARD_WIDTH, 170);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(fit(card.title, CARD_WIDTH - 202, 52, 700), 56, 88);
  font(400, 28);
  ctx.globalAlpha = 0.92;
  ctx.fillText(fit(card.subtitle, CARD_WIDTH - 202, 28, 400), 56, 134);
  ctx.globalAlpha = 1;
  box(CARD_WIDTH - 120, 52, 64, 64, 18, "rgba(255,255,255,0.22)");
  ctx.fillStyle = "#ffffff";
  font(700, 40);
  ctx.textAlign = "center";
  ctx.fillText("V", CARD_WIDTH - 88, 98);
  ctx.textAlign = "left";

  const tiles = card.tiles.slice(0, layout.tiles);
  if (tiles.length) {
    const gap = 24;
    const width = (CARD_WIDTH - 112 - gap * (tiles.length - 1)) / tiles.length;
    tiles.forEach((tile, index) => {
      const x = 56 + index * (width + gap);
      box(x, layout.tilesY, width, layout.tileHeight, 24, "#ffffff");
      ctx.fillStyle = "#5d6579";
      ctx.fillText(fit(tile.label, width - 48, 24, 400), x + 24, layout.tilesY + 44);
      ctx.fillStyle = "#14182b";
      ctx.fillText(
        fit(tile.value, width - 48, 36, 600),
        x + 24,
        layout.tilesY + layout.tileHeight - 34,
      );
    });
  }
  const bars = card.bars.slice(0, layout.bars);
  box(56, layout.panelY, CARD_WIDTH - 112, layout.panelHeight, 24, "#ffffff");
  ctx.fillStyle = "#14182b";
  ctx.fillText(fit(card.subtitle, CARD_WIDTH - 168, 28, 600), 84, layout.panelY + 54);
  const largest = Math.max(...bars.map((bar) => Math.abs(bar.value)), 1);
  const room = CARD_WIDTH - 112 - 56 - 260 - 190;
  bars.forEach((bar, index) => {
    const top = layout.panelY + 86 + index * layout.rowHeight;
    ctx.fillStyle = "#5d6579";
    ctx.fillText(fit(bar.name, 220, 26, 400), 84, top + layout.rowHeight * 0.5 + 8);
    const length = Math.max(12, (Math.abs(bar.value) / largest) * room);
    box(
      84 + 250,
      top + layout.rowHeight * 0.18,
      length,
      layout.rowHeight * 0.5,
      10,
      index === 0 ? "#2f5bff" : "#8aa2ff",
    );
    ctx.fillStyle = "#14182b";
    font(500, 24);
    ctx.fillText(bar.text, 84 + 250 + length + 14, top + layout.rowHeight * 0.5 + 8);
  });
  ctx.fillStyle = "#5d6579";
  font(400, 24);
  ctx.fillText(card.footer, 56, canvas.height - 44);
  return canvas;
}

function drawInsightCard(card: ShareCard): HTMLCanvasElement {
  // The headline is wrapped before the canvas is sized, because its lines decide the height.
  const probeCtx = newCanvas(10)[1];
  const headlineWidth = CARD_WIDTH - 128;
  let headlineLines = [card.headline];
  if (probeCtx) {
    const tools = toolbox(probeCtx);
    tools.font(700, 70);
    headlineLines = tools.wrap(card.headline, headlineWidth).slice(0, 4);
  }
  const layout = insightStyleLayout(
    headlineLines.length,
    card.bars.length,
    card.tiles.length,
  );
  const [canvas, ctx] = newCanvas(layout.height);
  if (!ctx) return canvas;
  const { font, box, fit } = toolbox(ctx);
  ctx.fillStyle = "#0d1020";
  ctx.fillRect(0, 0, CARD_WIDTH, canvas.height);
  const glow = ctx.createRadialGradient(CARD_WIDTH * 0.85, 0, 40, CARD_WIDTH * 0.85, 0, 720);
  glow.addColorStop(0, "rgba(47,91,255,0.55)");
  glow.addColorStop(1, "rgba(47,91,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_WIDTH, canvas.height);
  box(64, 72, 64, 64, 18, "#2f5bff");
  ctx.fillStyle = "#ffffff";
  font(700, 40);
  ctx.textAlign = "center";
  ctx.fillText("V", 96, 118);
  ctx.textAlign = "left";
  ctx.fillStyle = "#98a0bb";
  ctx.fillText(fit(`VynorAI · ${card.title}`, CARD_WIDTH - 152 - 64, 28, 500), 152, 114);
  ctx.fillStyle = "#ffffff";
  font(700, 70);
  headlineLines.forEach((line, index) =>
    ctx.fillText(line, 64, layout.headlineY + index * 88),
  );

  const bars = card.bars.slice(0, 5);
  if (layout.panelY !== undefined && bars.length >= 2) {
    box(64, layout.panelY, CARD_WIDTH - 128, layout.panelHeight, 28, "#161a2e");
    ctx.fillStyle = "#98a0bb";
    ctx.fillText(fit(card.subtitle, CARD_WIDTH - 192, 26, 500), 96, layout.panelY + 58);
    const left = 96;
    const width = CARD_WIDTH - 192;
    // The tallest bar's value sits above it, so the bars start below the panel's title.
    const top = layout.panelY + 112;
    const height = 190;
    const largest = Math.max(...bars.map((bar) => Math.abs(bar.value)), 1);
    const barWidth = (width / bars.length) * 0.6;
    bars.forEach((bar, index) => {
      const centre = left + (width * (index + 0.5)) / bars.length;
      const tall = Math.max(20, (Math.abs(bar.value) / largest) * height);
      box(centre - barWidth / 2, top + height - tall, barWidth, tall, 10, index === 0 ? "#6b8bff" : "#3a4a9c");
      ctx.textAlign = "center";
      ctx.fillStyle = "#eef0fa";
      ctx.fillText(fit(bar.text, barWidth + 60, 22, 500), centre, top + height - tall - 14);
      ctx.fillStyle = "#98a0bb";
      ctx.fillText(fit(bar.name, barWidth + 60, 22, 400), centre, top + height + 40);
      ctx.textAlign = "left";
    });
  }
  const tiles = card.tiles.slice(0, layout.tiles);
  if (tiles.length && layout.tilesY !== undefined) {
    const gap = 24;
    const width = (CARD_WIDTH - 128 - gap * (tiles.length - 1)) / tiles.length;
    tiles.forEach((tile, index) => {
      const x = 64 + index * (width + gap);
      box(x, layout.tilesY!, width, 150, 24, "#161a2e");
      ctx.fillStyle = "#98a0bb";
      ctx.fillText(fit(tile.label, width - 40, 24, 400), x + 20, layout.tilesY! + 42);
      ctx.fillStyle = "#eef0fa";
      ctx.fillText(fit(tile.value, width - 40, 38, 600), x + 20, layout.tilesY! + 110);
    });
  }
  ctx.fillStyle = "#98a0bb";
  font(400, 22);
  ctx.fillText(card.footer, 64, layout.footerY);
  return canvas;
}

export function drawShareCardStyle(
  card: ShareCard,
  style: ShareStyle,
): HTMLCanvasElement {
  if (style === "chart") return drawChartCard(card);
  if (style === "insight") return drawInsightCard(card);
  return drawShareCard(card);
}

/** A small copy of a drawn card for the picker; the card itself is never changed. */
export function thumbnailDataUrl(canvas: HTMLCanvasElement, size = 160): string {
  const thumb = document.createElement("canvas");
  thumb.width = size;
  thumb.height = size;
  const ctx = thumb.getContext("2d");
  if (!ctx) return "";
  // "Cover", anchored at the top, like the demo's thumbnails (object-fit: cover; object-position: top).
  const scale = Math.max(size / canvas.width, size / canvas.height);
  const width = canvas.width * scale;
  ctx.drawImage(canvas, (size - width) / 2, 0, width, canvas.height * scale);
  return thumb.toDataURL("image/png");
}
