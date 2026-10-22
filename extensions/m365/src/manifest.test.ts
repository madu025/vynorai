import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const FILES = [
  "manifest.xml",
  "manifest-word.xml",
  "manifest-powerpoint.xml",
  "manifest-outlook.xml",
];
const read = (name: string) => fs.readFileSync(new URL(name, root), "utf8");

test("every manifest has a unique GUID, a version of 1.0 or more and only vynor.lk addresses", () => {
  const ids = new Set<string>();
  for (const file of FILES) {
    const xml = read(file);
    const id = /<Id>([0-9a-f-]{36})<\/Id>/.exec(xml)?.[1];
    assert.ok(id, `${file} has no GUID`);
    assert.ok(!ids.has(id), `${file} repeats an Id`);
    ids.add(id);
    const major = Number(/<Version>(\d+)\./.exec(xml)?.[1]);
    assert.ok(major >= 1, `${file} version must be 1.0.0.0 or more`);
    for (const url of xml.match(/https?:\/\/[^"<\s]+/g) ?? []) {
      if (/schemas\.microsoft\.com|www\.w3\.org/.test(url)) continue;
      assert.match(url, /^https:\/\/vynor\.lk(\/|$)/, `${file}: ${url}`);
    }
    assert.ok(
      !/\?v=/.test(xml),
      `${file} must not cache-bust a SourceLocation`,
    );
  }
});

test("icons named in the manifests exist as 32 and 64 pixel files", () => {
  for (const file of FILES) {
    const xml = read(file);
    for (const [, size] of xml.matchAll(/assets\/icon-(\d+)\.png/g)) {
      const path = new URL(`assets/icon-${size}.png`, root);
      assert.ok(fs.existsSync(path), `${file}: icon-${size}.png is missing`);
      const bytes = fs.readFileSync(path);
      assert.equal(bytes.readUInt32BE(16), Number(size), `icon-${size} width`);
      assert.equal(bytes.readUInt32BE(20), Number(size), `icon-${size} height`);
    }
    assert.match(xml, /<IconUrl DefaultValue="[^"]*icon-32\.png"/);
    assert.match(
      xml,
      /<HighResolutionIconUrl DefaultValue="[^"]*icon-64\.png"/,
    );
  }
});

test("the Excel, Word and PowerPoint manifests declare an API level and a ribbon button that resolve", () => {
  const expected: Record<string, string> = {
    "manifest.xml": "ExcelApi",
    "manifest-word.xml": "WordApi",
    "manifest-powerpoint.xml": "PowerPointApi",
  };
  for (const [file, api] of Object.entries(expected)) {
    const xml = read(file);
    assert.match(
      xml,
      new RegExp(String.raw`<Set Name="${api}" MinVersion="1\.\d+"`),
      file,
    );
    assert.match(xml, /<Action xsi:type="ShowTaskpane">/, file);
    const defined = new Set(
      [...xml.matchAll(/<bt:\w+ id="([^"]+)"/g)].map((m) => m[1]),
    );
    for (const [, resid] of xml.matchAll(/resid="([^"]+)"/g))
      assert.ok(defined.has(resid), `${file}: resid ${resid} is not defined`);
  }
});

test("the Excel manifest keeps the one stable task pane address", () => {
  const xml = read("manifest.xml");
  const addresses = new Set(
    [...xml.matchAll(/https:\/\/vynor\.lk\/m365\/taskpane\.html/g)].map(
      (m) => m[0],
    ),
  );
  assert.equal(addresses.size, 1);
  assert.match(xml, /<Permissions>ReadWriteDocument<\/Permissions>/);
});
