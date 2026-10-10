import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import type { AddressInfo } from "net";
import * as os from "os";
import * as path from "path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { downloadResumable, IntegrityError } from "./resumableDownload";

// A real HTTP server on localhost and real files: no mocks.
const payload = crypto.randomBytes(600_000);
const sha = crypto.createHash("sha256").update(payload).digest("hex");

type Behaviour = {
  /** Cut the connection after this many bytes on the first request. */
  dropAfter?: number;
  /** Ignore the Range header and always send the whole file. */
  ignoreRange?: boolean;
  /** Stop sending (but keep the socket open) after this many bytes, once. */
  stallAfter?: number;
  /** Serve different bytes (corrupt content). */
  corrupt?: boolean;
};
let behaviour: Behaviour = {};
let requests: Array<string | undefined> = [];
let server: http.Server;
let url = "";
let dir = "";

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-dl-"));
  server = http.createServer((req, res) => {
    requests.push(req.headers.range);
    const body = behaviour.corrupt ? Buffer.alloc(payload.length, 7) : payload;
    const range = /bytes=(\d+)-/.exec(req.headers.range ?? "");
    const start = range && !behaviour.ignoreRange ? Number(range[1]) : 0;
    const slice = body.subarray(start);
    res.statusCode = start > 0 ? 206 : 200;
    res.setHeader("Content-Length", String(slice.length));
    if (start > 0) {
      res.setHeader(
        "Content-Range",
        `bytes ${start}-${body.length - 1}/${body.length}`,
      );
    }
    const first = requests.length === 1;
    if (first && behaviour.dropAfter !== undefined) {
      res.write(slice.subarray(0, behaviour.dropAfter));
      setTimeout(() => res.destroy(), 20);
      return;
    }
    if (first && behaviour.stallAfter !== undefined) {
      res.write(slice.subarray(0, behaviour.stallAfter));
      return; // never ends: the client must give up on its own
    }
    res.end(slice);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/f.vsix`;
});

afterAll(() => {
  (server as any).closeAllConnections?.();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  behaviour = {};
  requests = [];
  for (const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir, name));
});

const dest = () => path.join(dir, "f.vsix");

describe("downloadResumable", () => {
  it("downloads and verifies a file, reporting progress", async () => {
    const seen: number[] = [];
    const file = await downloadResumable({
      url,
      destFile: dest(),
      sha256: sha,
      onProgress: (received) => seen.push(received),
    });
    expect(fs.readFileSync(file).equals(payload)).toBe(true);
    expect(seen.at(-1)).toBe(payload.length);
    expect(fs.existsSync(`${dest()}.part`)).toBe(false);
  });

  it("resumes with a Range request after the connection drops mid-file", async () => {
    behaviour = { dropAfter: 250_000 };
    const file = await downloadResumable({
      url,
      destFile: dest(),
      sha256: sha,
    });
    expect(fs.readFileSync(file).equals(payload)).toBe(true);
    expect(requests.length).toBe(2);
    expect(requests[0]).toBeUndefined();
    expect(requests[1]).toMatch(/^bytes=\d+-$/);
    // it asked only for what was missing, not the file again
    expect(Number(/bytes=(\d+)-/.exec(requests[1]!)![1])).toBeGreaterThan(0);
  });

  it("survives a server that stops sending: gives up on that attempt, not on the file", async () => {
    behaviour = { stallAfter: 100_000 };
    const file = await downloadResumable({
      url,
      destFile: dest(),
      sha256: sha,
      idleTimeoutMs: 300,
    });
    expect(fs.readFileSync(file).equals(payload)).toBe(true);
    expect(requests.length).toBeGreaterThanOrEqual(2);
  });

  it("starts again cleanly when the server ignores Range", async () => {
    behaviour = { dropAfter: 150_000, ignoreRange: true };
    const file = await downloadResumable({
      url,
      destFile: dest(),
      sha256: sha,
    });
    expect(fs.readFileSync(file).equals(payload)).toBe(true);
  });

  it("never installs a file that fails the checksum, and leaves no part file", async () => {
    behaviour = { corrupt: true };
    await expect(
      downloadResumable({ url, destFile: dest(), sha256: sha }),
    ).rejects.toBeInstanceOf(IntegrityError);
    expect(fs.existsSync(dest())).toBe(false);
    expect(fs.existsSync(`${dest()}.part`)).toBe(false);
  });

  it("continues a download that an earlier run left behind", async () => {
    fs.writeFileSync(`${dest()}.part`, payload.subarray(0, 300_000));
    const file = await downloadResumable({
      url,
      destFile: dest(),
      sha256: sha,
    });
    expect(fs.readFileSync(file).equals(payload)).toBe(true);
    expect(requests).toEqual(["bytes=300000-"]);
  });

  it("reports an HTTP error instead of retrying it forever", async () => {
    const dead = http.createServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((resolve) => dead.listen(0, "127.0.0.1", resolve));
    const port = (dead.address() as AddressInfo).port;
    try {
      await expect(
        downloadResumable({
          url: `http://127.0.0.1:${port}/x`,
          destFile: dest(),
          sha256: sha,
        }),
      ).rejects.toThrow(/HTTP 404/);
    } finally {
      dead.close();
    }
  });
});
