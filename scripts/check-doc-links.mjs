#!/usr/bin/env node
// Checks that every repository path linked or named in the index documents exists.
// Run from the repository root: node scripts/check-doc-links.mjs
// Exit code 1 lists the paths that no longer exist, so the index cannot drift from the code unnoticed.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const DOCS = ["README.md", "AGENTS.md", "CODEMAP.md", "CLAUDE.md"];
const ROOTS = [
  "backend/",
  "core/",
  "gui/",
  "extensions/",
  "packages/",
  "deploy/",
  "docs/",
  "scripts/",
  ".claude/",
];

let checked = 0;
const missing = [];

for (const doc of DOCS) {
  if (!existsSync(doc)) {
    missing.push(`${doc}: file is missing`);
    continue;
  }
  const text = readFileSync(doc, "utf8");
  const targets = new Set();
  // Markdown links to files in the repository.
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    targets.add(normalize(join(dirname(doc), decodeURIComponent(target))));
  }
  // Paths written as code, when they start at a known top-level folder.
  for (const match of text.matchAll(/`([^`\s]+)`/g)) {
    const target = match[1];
    if (/[*<>{}$]/.test(target)) continue;
    if (!ROOTS.some((root) => target.startsWith(root))) continue;
    targets.add(normalize(target.split(":")[0]));
  }
  for (const target of targets) {
    checked++;
    if (!existsSync(target)) missing.push(`${doc}: ${target}`);
  }
}

if (missing.length > 0) {
  console.error(`${missing.length} of ${checked} paths do not exist:`);
  for (const line of missing) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`${checked} paths checked, all exist.`);
