import { localizeMessage, type Language } from "./i18n.js";
import { samplePreviewNote, willBeCreatedOn } from "./paneText.js";
import { buildOutcomes, type OutcomeChart } from "./outcome.js";
import { buildPreviewKpis } from "./previewKpis.js";

export interface PreviewRangeFacts {
  headers: string[];
  rows: unknown[][];
}

export interface PreviewSampleFacts {
  totalRows: number;
  sampledRows: number;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const PALETTE = ["#123a6b", "#d9822b", "#2e8b57", "#8e44ad"];

export function drawOutcomeChart(
  document: Document,
  chart: OutcomeChart,
): SVGElement {
  const width = 300;
  const height = 150;
  const pad = 18;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const all = chart.series.flatMap((entry) => entry.values);
  const min = Math.min(0, ...all);
  const max = Math.max(1, ...all);
  const range = Math.max(1, max - min);
  const count = Math.max(1, chart.categories.length);
  const step = (width - pad * 2) / count;
  const add = (name: string, attrs: Record<string, string>) => {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs))
      node.setAttribute(key, value);
    svg.appendChild(node);
    return node;
  };
  const y = (value: number) =>
    height - pad - ((value - min) / range) * (height - pad * 2);
  add("line", {
    x1: String(pad),
    y1: String(y(0)),
    x2: String(width - pad),
    y2: String(y(0)),
    stroke: "#9aa5b5",
  });

  const type = String(chart.type || "column").toLowerCase();
  const drawLineSeries = (
    entry: OutcomeChart["series"][number],
    index: number,
  ) => {
    const points = entry.values
      .map((value, at) => `${pad + step * (at + 0.5)},${y(value)}`)
      .join(" ");
    add("polyline", {
      points,
      fill: "none",
      stroke: PALETTE[index % PALETTE.length],
      "stroke-width": "2",
    });
  };
  const drawColumns = (stacked: boolean, firstOnly = false) => {
    chart.categories.forEach((_, at) => {
      let stack = 0;
      chart.series.forEach((entry, index) => {
        if (firstOnly && index > 0) return;
        const value = Number(entry.values[at] ?? 0);
        const start = stacked ? stack : 0;
        const end = start + value;
        stack = stacked ? end : stack;
        add("rect", {
          x: String(
            stacked
              ? pad + step * at + step * 0.1
              : pad +
                  step * at +
                  step * 0.1 +
                  ((step * 0.8) / chart.series.length) * index,
          ),
          y: String(y(Math.max(start, end))),
          width: String(
            stacked ? step * 0.8 : (step * 0.8) / chart.series.length,
          ),
          height: String(Math.max(1, Math.abs(y(end) - y(start)))),
          fill: PALETTE[index % PALETTE.length],
        });
      });
    });
  };
  const drawHorizontalBars = () => {
    const series = chart.series[0];
    if (!series) return;
    const rowHeight = (height - pad * 2) / Math.max(1, series.values.length);
    const horizontalMax = Math.max(
      1,
      ...series.values.map((value) => Math.abs(value)),
    );
    series.values.forEach((value, at) => {
      const bar = (Math.abs(value) / horizontalMax) * (width - pad * 2);
      add("rect", {
        x: String(value < 0 ? pad + (width - pad * 2) - bar : pad),
        y: String(pad + rowHeight * at + rowHeight * 0.12),
        width: String(Math.max(1, bar)),
        height: String(Math.max(1, rowHeight * 0.76)),
        fill: PALETTE[0],
      });
    });
  };
  const drawStackedHorizontalBars = () => {
    const rowHeight = (height - pad * 2) / Math.max(1, chart.categories.length);
    chart.categories.forEach((_, at) => {
      const total = Math.max(
        1,
        chart.series.reduce(
          (sum, entry) => sum + Math.max(0, Number(entry.values[at] ?? 0)),
          0,
        ),
      );
      let offset = 0;
      chart.series.forEach((entry, index) => {
        const value = Math.max(0, Number(entry.values[at] ?? 0));
        const segmentWidth = (value / total) * (width - pad * 2);
        add("rect", {
          x: String(pad + offset),
          y: String(pad + rowHeight * at + rowHeight * 0.12),
          width: String(Math.max(1, segmentWidth)),
          height: String(Math.max(1, rowHeight * 0.76)),
          fill: PALETTE[index % PALETTE.length],
        });
        offset += segmentWidth;
      });
    });
  };
  const drawHistogram = () => {
    const values = chart.series[0]?.values ?? [];
    if (!values.length) return;
    const lower = Math.min(...values);
    const upper = Math.max(...values);
    const binCount = Math.max(
      3,
      Math.min(8, Math.ceil(Math.sqrt(values.length))),
    );
    const span = Math.max(1, upper - lower);
    const counts = Array.from({ length: binCount }, () => 0);
    values.forEach((value) => {
      const bin = Math.min(
        binCount - 1,
        Math.floor(((value - lower) / span) * binCount),
      );
      counts[bin] += 1;
    });
    const peak = Math.max(1, ...counts);
    counts.forEach((count, at) => {
      const barWidth = ((width - pad * 2) / binCount) * 0.82;
      const x = pad + ((width - pad * 2) / binCount) * at + barWidth * 0.1;
      const top = height - pad - (count / peak) * (height - pad * 2);
      add("rect", {
        x: String(x),
        y: String(top),
        width: String(barWidth),
        height: String(Math.max(1, height - pad - top)),
        fill: PALETTE[0],
      });
    });
  };
  if (type === "line") chart.series.forEach(drawLineSeries);
  else if (type === "area") {
    chart.series.forEach((entry, index) => {
      const points = entry.values
        .map((value, at) => `${pad + step * (at + 0.5)},${y(value)}`)
        .join(" ");
      const first = `${pad + step * 0.5},${y(0)}`;
      const last = `${pad + step * (entry.values.length - 0.5)},${y(0)}`;
      add("polygon", {
        points: `${first} ${points} ${last}`,
        fill: PALETTE[index % PALETTE.length],
        opacity: "0.2",
      });
      drawLineSeries(entry, index);
    });
  } else if (type === "bar") drawHorizontalBars();
  else if (type === "combo") {
    drawColumns(false, true);
    chart.series.slice(1).forEach(drawLineSeries);
  } else if (type === "stacked-column") drawColumns(true);
  else if (type === "stacked-bar") drawStackedHorizontalBars();
  else if (type === "histogram") drawHistogram();
  else if (type === "waterfall") {
    const series = chart.series[0];
    let running = 0;
    series?.values.forEach((value, at) => {
      const next = running + Number(value || 0);
      add("rect", {
        x: String(pad + step * at + step * 0.1),
        y: String(y(Math.max(running, next))),
        width: String(step * 0.8),
        height: String(Math.max(1, Math.abs(y(next) - y(running)))),
        fill: next >= running ? "#2e8b57" : "#c94c4c",
      });
      running = next;
    });
  } else if (type === "pie") {
    const series = chart.series[0];
    const values = series?.values.map((value) => Math.max(0, value)) ?? [];
    const total = values.reduce((sum, value) => sum + value, 0) || 1;
    const cx = width / 2;
    const cy = (height - 6) / 2;
    const radius = Math.min(cx - pad, cy - pad / 2);
    let angle = -Math.PI / 2;
    values.forEach((value, index) => {
      const nextAngle = angle + (value / total) * Math.PI * 2;
      const largeArc = nextAngle - angle > Math.PI ? 1 : 0;
      const startX = cx + radius * Math.cos(angle);
      const startY = cy + radius * Math.sin(angle);
      const endX = cx + radius * Math.cos(nextAngle);
      const endY = cy + radius * Math.sin(nextAngle);
      add("path", {
        d: `M ${cx} ${cy} L ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY} Z`,
        fill: PALETTE[index % PALETTE.length],
      });
      angle = nextAngle;
    });
  } else drawColumns(false);
  if (chart.showDataLabels && type !== "pie" && type !== "histogram") {
    chart.series.forEach((entry) =>
      entry.values.forEach((value, at) => {
        const text = add("text", {
          x: String(
            type === "bar" || type === "stacked-bar"
              ? pad +
                  Math.max(
                    2,
                    (Math.abs(value) / Math.max(1, max)) * (width - pad * 2),
                  )
              : pad + step * (at + 0.5),
          ),
          y: String(
            type === "bar" || type === "stacked-bar"
              ? pad +
                  ((height - pad * 2) / Math.max(1, chart.categories.length)) *
                    at +
                  10
              : Math.max(10, y(value) - 4),
          ),
          "text-anchor":
            type === "bar" || type === "stacked-bar" ? "start" : "middle",
          "font-size": "7",
          fill: "#374151",
        });
        text.textContent = Number(value).toLocaleString("en-US");
      }),
    );
  }
  chart.categories.forEach((name, at) => {
    const label = add("text", {
      x: String(pad + step * (at + 0.5)),
      y: String(height - 4),
      "text-anchor": "middle",
      "font-size": "8",
      fill: "#4b5563",
    });
    label.textContent = name.slice(0, 6);
  });
  return svg;
}

export function renderPreviewKpis(
  document: Document,
  actions: any[],
  parsed: any,
  range: PreviewRangeFacts | undefined,
  sample: PreviewSampleFacts | undefined,
  language: Language,
): void {
  const container = document.querySelector<HTMLElement>("#preview-kpis");
  if (!container) return;
  container.textContent = "";
  const tiles = range
    ? buildPreviewKpis({
        actions,
        headers: range.headers,
        rows: range.rows,
        sample: parsed?.profile?.sample ?? sample,
        normalized: Boolean(parsed?.normalization),
        tr: (text) => localizeMessage(language, text),
      })
    : [];
  for (const tile of tiles) {
    const box = document.createElement("div");
    box.className = tile.warn ? "kpi warn" : "kpi";
    if (tile.title) box.title = tile.title;
    const label = document.createElement("small");
    label.textContent = tile.label;
    const value = document.createElement("strong");
    value.textContent = tile.value;
    box.append(label, value);
    if (tile.sub) {
      const sub = document.createElement("span");
      sub.textContent = tile.sub;
      box.append(sub);
    }
    container.append(box);
  }
  container.hidden = tiles.length === 0;
}

export function renderOutcomes(
  document: Document,
  actions: any[],
  range: PreviewRangeFacts | undefined,
  sample: PreviewSampleFacts | undefined,
  language: Language,
  refreshSheetNames: (container: HTMLElement, actions: any[]) => void,
): void {
  const container = document.querySelector<HTMLElement>("#outcomes");
  if (!container) return;
  container.textContent = "";
  if (!range) return;
  for (const outcome of buildOutcomes(
    actions,
    range.headers,
    range.rows,
    language,
  )) {
    const box = document.createElement("div");
    box.className = "outcome";
    const title = document.createElement("strong");
    title.textContent = outcome.title;
    const where = document.createElement("div");
    where.className = "where";
    where.textContent = willBeCreatedOn(outcome.where, language);
    box.append(title, where);
    if (outcome.chart) {
      box.appendChild(drawOutcomeChart(document, outcome.chart));
      const legend = document.createElement("div");
      legend.className = "legend";
      legend.textContent = outcome.chart.series
        .map(
          (entry, index) => `${["■", "▲", "●", "◆"][index % 4]} ${entry.name}`,
        )
        .join("   ");
      box.appendChild(legend);
    } else if (outcome.table) {
      const table = document.createElement("table");
      const head = table.insertRow();
      outcome.table.headers.forEach((name, index) => {
        const th = document.createElement("th");
        th.textContent = outcome.table!.dropdownColumns.includes(index)
          ? `${name} ▾`
          : name;
        head.appendChild(th);
      });
      const shownRows = sample
        ? outcome.table.rows.filter(
            (row) => row[0] !== "Grand total" && row[0] !== "මුළු එකතුව",
          )
        : outcome.table.rows;
      for (const row of shownRows) {
        const tr = table.insertRow();
        row.forEach((value, index) => {
          const td = tr.insertCell();
          td.textContent = value;
          const bar = outcome.table!.barColumns.find(
            (entry) => entry.index === index,
          );
          if (bar) {
            const share = Math.min(1, Math.max(0, Number(value) / bar.max));
            td.style.background = `linear-gradient(to right, #9ec5f0 ${Math.round(share * 100)}%, transparent ${Math.round(share * 100)}%)`;
          }
        });
      }
      box.appendChild(table);
      if (sample) {
        const note = document.createElement("div");
        note.className = "legend";
        note.textContent = samplePreviewNote(
          sample.sampledRows,
          sample.totalRows,
          language,
        );
        box.appendChild(note);
      }
    }
    if (outcome.details.length) {
      const list = document.createElement("ul");
      list.className = "details";
      for (const line of outcome.details) {
        const li = document.createElement("li");
        li.textContent = line;
        list.appendChild(li);
      }
      box.appendChild(list);
    }
    container.appendChild(box);
  }
  refreshSheetNames(container, actions);
}
