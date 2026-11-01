#!/usr/bin/env node
// Fails when a change touches what deploy/publish-m365.sh ships (the pane bundle, its chunks,
// pane.css, the production runtime config) but keeps the pane build id in taskpane.html.
// The bundle is cached for a year under ?v=<build id>, and publish-m365.sh refuses to publish a
// known id with different files, so a missed bump blocks the release after merge.
//
//   node scripts/check-m365-build-id.mjs [base-ref]    (default origin/main)
import { execFileSync } from "node:child_process";

const base = process.argv[2] || "origin/main";
const PANE = "extensions/m365/taskpane.html";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

// Files that end up in the published pane. Tests, docs and dev-only files do not.
export function shipsInPane(file) {
  if (!file.startsWith("extensions/m365/")) return false;
  const rel = file.slice("extensions/m365/".length);
  if (rel === "pane.css" || rel === "runtime-config.production.js") return true;
  if (rel === "package.json" || rel === "package-lock.json") return true;
  if (rel === "scripts/build-bundles.mjs") return true;
  if (!rel.startsWith("src/")) return false;
  return !/\.(test|spec)\.m?ts$/.test(rel) && !rel.includes("/__tests__/");
}

export function buildIdOf(html) {
  const match = /var BUILD = "([^"]*)"/.exec(html ?? "");
  return match ? match[1] : undefined;
}

function main() {
  let mergeBase;
  try {
    mergeBase = git(["merge-base", base, "HEAD"]).trim();
  } catch {
    console.error(`check-m365-build-id: cannot find merge base with ${base}`);
    process.exit(2);
  }
  const changed = git(["diff", "--name-only", `${mergeBase}`, "HEAD"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(shipsInPane);
  if (changed.length === 0) {
    console.log("check-m365-build-id: no shipped pane files changed");
    return;
  }
  let before;
  try {
    before = buildIdOf(git(["show", `${mergeBase}:${PANE}`]));
  } catch {
    before = undefined;
  }
  const after = buildIdOf(git(["show", `HEAD:${PANE}`]));
  if (before && after === before) {
    console.error(
      `check-m365-build-id: these shipped pane files changed but the build id in ${PANE} is still ${after}:`,
    );
    for (const file of changed) console.error(`  ${file}`);
    console.error(
      "Bump the id in every place in taskpane.html (loader, head links, menu line).",
    );
    process.exit(1);
  }
  console.log(`check-m365-build-id: build id ${before ?? "(new)"} -> ${after}`);
}

if (process.argv[1]?.endsWith("check-m365-build-id.mjs")) main();
