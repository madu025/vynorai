/**
 * Draws a ShareCard (shareCard.ts) as a PNG picture. The layout follows the content: one to four
 * tiles, a headline when the data has one, bars only when there is a breakdown. Needs a browser
 * canvas, so it is checked by looking at it (see the vynor-live-verify skill), not in unit tests.
 */
import type { ShareCard } from "./shareCard.js";

const WIDTH = 1080;
const SANS =
  "'Segoe UI','Noto Sans','Noto Sans Sinhala','Iskoola Pota','Nirmala UI','Noto Sans Tamil',system-ui,sans-serif";

export function drawShareCard(card: ShareCard): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const tiles = card.tiles.slice(0, 4);
  const bars = card.bars.slice(0, 5);
  const headlineHeight = card.headline ? 150 : 0;
  const barsHeight = bars.length ? 120 + bars.length * 78 : 0;
  const tilesHeight = tiles.length ? 190 : 0;
  const height = 170 + 36 + tilesHeight + headlineHeight + barsHeight + 110;
  canvas.width = WIDTH;
  canvas.height = Math.max(420, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const fill = (
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    color: string,
  ) => {
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
  const font = (weight: number, size: number) => {
    ctx.font = `${weight} ${size}px ${SANS}`;
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

  ctx.fillStyle = "#f1f3f9";
  ctx.fillRect(0, 0, WIDTH, canvas.height);
  const band = ctx.createLinearGradient(0, 0, WIDTH, 0);
  band.addColorStop(0, "#2f5bff");
  band.addColorStop(1, "#0e9f8e");
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, WIDTH, 170);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(fit(card.title, WIDTH - 112 - 90, 52, 700), 56, 88);
  font(400, 28);
  ctx.globalAlpha = 0.92;
  ctx.fillText(fit(card.subtitle, WIDTH - 112 - 90, 28, 400), 56, 134);
  ctx.globalAlpha = 1;
  fill(WIDTH - 120, 52, 64, 64, 18, "rgba(255,255,255,0.22)");
  ctx.fillStyle = "#ffffff";
  font(700, 40);
  ctx.textAlign = "center";
  ctx.fillText("V", WIDTH - 88, 98);
  ctx.textAlign = "left";

  let y = 170 + 36;
  if (tiles.length) {
    const gap = 20;
    const width = (WIDTH - 112 - gap * (tiles.length - 1)) / tiles.length;
    tiles.forEach((tile, index) => {
      const x = 56 + index * (width + gap);
      fill(x, y, width, 154, 24, "#ffffff");
      ctx.fillStyle = "#5d6579";
      ctx.fillText(fit(tile.label, width - 44, 24, 400), x + 22, y + 44);
      ctx.fillStyle = "#14182b";
      ctx.fillText(
        fit(tile.value, width - 44, tiles.length > 3 ? 36 : 44, 600),
        x + 22,
        y + 116,
      );
    });
    y += tilesHeight;
  }
  if (card.headline) {
    ctx.fillStyle = "#14182b";
    font(600, 38);
    wrap(card.headline, WIDTH - 112)
      .slice(0, 2)
      .forEach((line, index) => ctx.fillText(line, 56, y + 40 + index * 52));
    y += headlineHeight;
  }
  if (bars.length) {
    fill(56, y, WIDTH - 112, barsHeight - 20, 24, "#ffffff");
    const largest = Math.max(...bars.map((bar) => Math.abs(bar.value))) || 1;
    const room = WIDTH - 112 - 56 - 250 - 190;
    bars.forEach((bar, index) => {
      const top = y + 50 + index * 78;
      ctx.fillStyle = "#5d6579";
      ctx.fillText(fit(bar.name, 220, 26, 400), 84, top + 40);
      const length = Math.max(12, (Math.abs(bar.value) / largest) * room);
      fill(
        84 + 240,
        top + 10,
        length,
        40,
        10,
        index === 0 ? "#2f5bff" : "#8aa2ff",
      );
      ctx.fillStyle = "#14182b";
      font(500, 24);
      ctx.fillText(bar.text, 84 + 240 + length + 14, top + 40);
    });
    y += barsHeight;
  }
  ctx.fillStyle = "#5d6579";
  font(400, 24);
  ctx.fillText(card.footer, 56, canvas.height - 44);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob), "image/png"),
  );
}
