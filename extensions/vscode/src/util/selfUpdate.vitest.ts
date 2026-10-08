import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({}));

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

import {
  findCachedVsix,
  isNewer,
  isValidRelease,
  sharedUpdatesDir,
} from "./selfUpdate";

describe("isNewer", () => {
  it("compares x.y.z numerically", () => {
    expect(isNewer("1.2.15", "1.2.14")).toBe(true);
    expect(isNewer("1.10.0", "1.9.9")).toBe(true);
    expect(isNewer("1.2.14", "1.2.14")).toBe(false);
    expect(isNewer("1.2.9", "1.2.14")).toBe(false);
    expect(isNewer("2.0.0", "1.99.99")).toBe(true);
  });
});

describe("isValidRelease", () => {
  const release = {
    version: "1.2.37",
    url: "https://vynor.lk/download/vynorai-1.2.37.vsix",
    sha256: "a".repeat(64),
    notes: "Workspace reliability fixes",
  };

  it("accepts a release whose URL, version, and checksum are bound together", () => {
    expect(isValidRelease(release)).toBe(true);
  });

  it("rejects malformed metadata and mismatched artifact versions", () => {
    expect(isValidRelease({ ...release, version: "latest" })).toBe(false);
    expect(
      isValidRelease({
        ...release,
        url: "https://vynor.lk/download/vynorai-1.2.36.vsix",
      }),
    ).toBe(false);
    expect(isValidRelease({ ...release, sha256: "not-a-sha" })).toBe(false);
  });
});

describe("shared update cache", () => {
  const bytes = Buffer.from("fake vsix contents");
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  const release = {
    version: "1.2.40",
    url: "https://vynor.lk/download/vynorai-1.2.40.vsix",
    sha256: sha,
  };

  function tmp() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "vynor-upd-"));
  }

  it("reuses a download another editor already verified", () => {
    const dir = tmp();
    const file = path.join(dir, "vynorai-1.2.40.vsix");
    fs.writeFileSync(file, bytes);
    expect(findCachedVsix(dir, release)).toBe(file);
  });

  it("ignores a tampered, partial or missing file", () => {
    const dir = tmp();
    expect(findCachedVsix(dir, release)).toBeNull();
    fs.writeFileSync(path.join(dir, "vynorai-1.2.40.vsix"), "tampered");
    expect(findCachedVsix(dir, release)).toBeNull();
  });

  it("uses one folder under the VynorAI global dir for every editor", () => {
    const prev = process.env.VYNORAI_GLOBAL_DIR;
    process.env.VYNORAI_GLOBAL_DIR = path.join(os.tmpdir(), "vg");
    try {
      expect(sharedUpdatesDir()).toBe(path.join(os.tmpdir(), "vg", "updates"));
    } finally {
      if (prev === undefined) delete process.env.VYNORAI_GLOBAL_DIR;
      else process.env.VYNORAI_GLOBAL_DIR = prev;
    }
  });
});
