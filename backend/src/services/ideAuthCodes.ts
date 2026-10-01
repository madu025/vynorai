import crypto from "crypto";

export const IDE_AUTH_TTL_SECONDS = 120;

interface RedisIdeAuthClient {
  set(
    key: string,
    value: string,
    options: { EX: number; NX: true },
  ): Promise<string | null>;
  getDel(key: string): Promise<string | null>;
}

interface IdeAuthorization {
  userId: string;
  stateHash: string;
}

interface LocalIdeAuthorization extends IdeAuthorization {
  expiresAt: number;
}

export class IdeAuthStoreUnavailableError extends Error {
  constructor() {
    super("Distributed IDE authentication store is unavailable");
    this.name = "IdeAuthStoreUnavailableError";
  }
}

export class IdeAuthorizationCodeStore {
  private readonly localCodes = new Map<string, LocalIdeAuthorization>();

  constructor(
    private readonly getRedisClient: () => Promise<RedisIdeAuthClient | null>,
    private readonly options: {
      requireDistributed?: boolean;
      maxLocalEntries?: number;
      now?: () => number;
      randomBytes?: (size: number) => Buffer;
    } = {},
  ) {}

  private get now(): () => number {
    return this.options.now ?? Date.now;
  }

  private hash(value: string): string {
    return crypto.createHash("sha256").update(value).digest("hex");
  }

  private pruneLocal(): void {
    const now = this.now();
    for (const [key, entry] of this.localCodes) {
      if (entry.expiresAt <= now) this.localCodes.delete(key);
    }

    const maxEntries = this.options.maxLocalEntries ?? 10_000;
    while (this.localCodes.size > maxEntries) {
      const oldestKey = this.localCodes.keys().next().value as
        | string
        | undefined;
      if (!oldestKey) break;
      this.localCodes.delete(oldestKey);
    }
  }

  async issue(userId: string, state: string): Promise<string> {
    const redis = await this.getRedisClient();
    if (!redis && this.options.requireDistributed) {
      throw new IdeAuthStoreUnavailableError();
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const randomBytes = this.options.randomBytes ?? crypto.randomBytes;
      const code = randomBytes(32).toString("hex");
      const codeHash = this.hash(code);
      const authorization: IdeAuthorization = {
        userId,
        stateHash: this.hash(state),
      };

      if (redis) {
        const stored = await redis.set(
          `vynor:ide-auth:${codeHash}`,
          JSON.stringify(authorization),
          { EX: IDE_AUTH_TTL_SECONDS, NX: true },
        );
        if (stored === "OK") return code;
        continue;
      }

      this.pruneLocal();
      if (this.localCodes.has(codeHash)) continue;
      const maxEntries = this.options.maxLocalEntries ?? 10_000;
      if (this.localCodes.size >= maxEntries) {
        const oldestKey = this.localCodes.keys().next().value as
          | string
          | undefined;
        if (oldestKey) this.localCodes.delete(oldestKey);
      }
      this.localCodes.set(codeHash, {
        ...authorization,
        expiresAt: this.now() + IDE_AUTH_TTL_SECONDS * 1_000,
      });
      return code;
    }

    throw new Error("Unable to allocate a unique IDE authorization code");
  }

  async consume(
    code: string,
    state: string,
  ): Promise<{ userId: string } | undefined> {
    const redis = await this.getRedisClient();
    if (!redis && this.options.requireDistributed) {
      throw new IdeAuthStoreUnavailableError();
    }

    const codeHash = this.hash(code);
    let authorization: IdeAuthorization | undefined;

    if (redis) {
      const raw = await redis.getDel(`vynor:ide-auth:${codeHash}`);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Partial<IdeAuthorization>;
          if (
            typeof parsed.userId === "string" &&
            typeof parsed.stateHash === "string" &&
            /^[a-f0-9]{64}$/i.test(parsed.stateHash)
          ) {
            authorization = {
              userId: parsed.userId,
              stateHash: parsed.stateHash,
            };
          }
        } catch {
          return undefined;
        }
      }
    } else {
      const local = this.localCodes.get(codeHash);
      this.localCodes.delete(codeHash);
      if (local && local.expiresAt > this.now()) authorization = local;
    }

    if (!authorization) return undefined;
    const expectedState = Buffer.from(authorization.stateHash, "hex");
    const providedState = Buffer.from(this.hash(state), "hex");
    if (
      expectedState.length !== providedState.length ||
      !crypto.timingSafeEqual(expectedState, providedState)
    ) {
      return undefined;
    }
    return { userId: authorization.userId };
  }

  localEntryCount(): number {
    this.pruneLocal();
    return this.localCodes.size;
  }
}
