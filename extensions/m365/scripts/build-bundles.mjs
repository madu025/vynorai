// Builds the pane bundles. The task pane is an ES module with split chunks (Sinhala and Tamil text
// load only when chosen); text.html keeps a single classic script.
import { build } from "esbuild";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

// Chunk names carry a content hash, so they are safe to cache for a year; stale ones are removed.
rmSync(path.join(dist, "chunks"), { recursive: true, force: true });

await build({
  entryPoints: { "taskpane.bundle": path.join(root, "src/taskpane.ts") },
  outdir: dist,
  bundle: true,
  splitting: true,
  format: "esm",
  target: "es2020",
  minify: true,
  chunkNames: "chunks/[name]-[hash]",
});

await build({
  entryPoints: [path.join(root, "src/text.ts")],
  outfile: path.join(dist, "text.bundle.js"),
  bundle: true,
  format: "iife",
  target: "es2020",
});
