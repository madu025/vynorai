import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

/**
 * Downloads a large file over a slow or unreliable link.
 *
 * The old updater fetched the whole 87 MB VSIX into memory with one 5 minute
 * limit, so on a connection that delivers 80 KB/s it always timed out and
 * started over. This one:
 *  - streams to disk, so nothing is held in memory;
 *  - gives up only when no bytes arrive for `idleTimeoutMs`, not after a fixed
 *    total time, so a slow but steady download finishes;
 *  - resumes from the bytes already on disk (HTTP Range) after a stall or a
 *    dropped connection, and across editor restarts;
 *  - verifies the SHA-256 before the file gets its final name.
 */
export interface ResumableDownloadOptions {
  url: string;
  /** Final path of the verified file. */
  destFile: string;
  sha256: string;
  idleTimeoutMs?: number;
  maxAttempts?: number;
  /** Called as bytes arrive. `total` is 0 when the server did not say. */
  onProgress?: (received: number, total: number) => void;
  fetchImpl?: typeof fetch;
}

export class IntegrityError extends Error {
  constructor() {
    super("Downloaded file failed the integrity check; not installed.");
    this.name = "IntegrityError";
  }
}

function sha256Of(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

function sizeOf(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/** One pass: appends what the server sends until the stream ends or stalls. */
async function transfer(
  options: ResumableDownloadOptions,
  partFile: string,
): Promise<"complete" | "interrupted"> {
  const doFetch = options.fetchImpl ?? fetch;
  const idleMs = options.idleTimeoutMs ?? 60_000;
  const have = sizeOf(partFile);

  const controller = new AbortController();
  let idle: ReturnType<typeof setTimeout> | undefined;
  const armIdle = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => controller.abort(), idleMs);
  };

  armIdle();
  try {
    const response = await doFetch(options.url, {
      signal: controller.signal,
      headers: have > 0 ? { Range: `bytes=${have}-` } : {},
    });

    if (response.status === 416) {
      // Nothing left to send: the part file already holds the whole file (or
      // is longer than it). Let verification decide.
      return "complete";
    }
    if (!response.ok || !response.body) {
      throw new Error(`Download failed (HTTP ${response.status})`);
    }

    // 206: the server continues where we stopped. 200: it ignored Range and
    // sends everything, so start the file again.
    const resuming = response.status === 206 && have > 0;
    if (!resuming && have > 0) fs.rmSync(partFile, { force: true });
    const start = resuming ? have : 0;
    const length = Number(response.headers.get("content-length") ?? 0);
    const total = length > 0 ? start + length : 0;

    const out = fs.createWriteStream(partFile, { flags: resuming ? "a" : "w" });
    let received = start;
    try {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        armIdle();
        if (!out.write(value)) {
          await new Promise<void>((resolve) => out.once("drain", resolve));
        }
        received += value.byteLength;
        options.onProgress?.(received, total);
      }
    } finally {
      await new Promise<void>((resolve) => out.end(resolve));
    }
    return total > 0 && received < total ? "interrupted" : "complete";
  } catch (error) {
    // Aborted by the idle timer, or the connection dropped: keep the part
    // file and let the caller resume. HTTP errors are not retried here.
    if (error instanceof Error && /^Download failed/.test(error.message)) {
      throw error;
    }
    return "interrupted";
  } finally {
    if (idle) clearTimeout(idle);
  }
}

export async function downloadResumable(
  options: ResumableDownloadOptions,
): Promise<string> {
  const partFile = `${options.destFile}.part`;
  fs.mkdirSync(path.dirname(options.destFile), { recursive: true });
  const attempts = options.maxAttempts ?? 12;
  let restarted = false;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const state = await transfer(options, partFile);
    if (state === "interrupted") {
      if (attempt === attempts) break;
      // Brief pause before resuming; never a busy loop on a dead network.
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    const digest = await sha256Of(partFile);
    if (digest === options.sha256) {
      // Write then rename: another editor may be reading the same file.
      fs.renameSync(partFile, options.destFile);
      return options.destFile;
    }
    // Wrong content: a corrupted resume or a changed file. Start once from zero.
    fs.rmSync(partFile, { force: true });
    if (restarted) throw new IntegrityError();
    restarted = true;
  }
  throw new Error(
    "The download kept stalling. Check your connection and try again; it will resume from where it stopped.",
  );
}
