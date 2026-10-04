/**
 * Extension distribution without a marketplace.
 *
 * Releases live in RELEASES_DIR (mounted read-only from /opt/vynor/releases):
 *   vynorai-1.2.15.vsix ...
 *   latest.json  { version, file, sha256, size, notes, publishedAt }
 * deploy/release-extension.sh uploads a build and rewrites latest.json.
 */
import { Request, Response, Router } from "express";
import fs from "fs";
import path from "path";

export const releasesRouter = Router();

const RELEASES_DIR = process.env.RELEASES_DIR || "/app/releases";
const FILE_RE = /^vynorai-\d+\.\d+\.\d+\.vsix$/;

interface Latest {
  version: string;
  file: string;
  sha256: string;
  size: number;
  notes?: string;
  publishedAt?: string;
}

let cached: { at: number; value: Latest | null } | null = null;

function readLatest(): Latest | null {
  if (cached && Date.now() - cached.at < 60_000) return cached.value;
  let value: Latest | null = null;
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(RELEASES_DIR, "latest.json"), "utf8"),
    );
    if (
      typeof raw.version === "string" &&
      FILE_RE.test(raw.file) &&
      /^[a-f0-9]{64}$/.test(raw.sha256)
    )
      value = raw;
  } catch {
    value = null;
  }
  cached = { at: Date.now(), value };
  return value;
}

/** GET /api/extension/latest: what the in-extension updater checks. */
releasesRouter.get("/api/extension/latest", (_req: Request, res: Response) => {
  const latest = readLatest();
  if (!latest) return res.status(404).json({ error: "No release published" });
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({
    version: latest.version,
    url: `https://vynor.lk/download/${latest.file}`,
    sha256: latest.sha256,
    size: latest.size,
    notes: latest.notes ?? "",
    publishedAt: latest.publishedAt ?? null,
  });
});

/** GET /download/latest: always the newest build. */
releasesRouter.get("/download/latest", (_req: Request, res: Response) => {
  const latest = readLatest();
  if (!latest) return res.status(404).send("No release published yet.");
  res.redirect(302, `/download/${latest.file}`);
});

/** GET /download/vynorai-x.y.z.vsix */
releasesRouter.get("/download/:file", (req: Request, res: Response) => {
  const file = String(req.params.file);
  if (!FILE_RE.test(file)) return res.status(404).send("Not found");
  const full = path.join(RELEASES_DIR, file);
  if (!fs.existsSync(full)) return res.status(404).send("Not found");
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Cache-Control", "public, max-age=86400, immutable");
  res.download(full, file);
});
