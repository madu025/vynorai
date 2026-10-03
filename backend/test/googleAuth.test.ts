import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "vynor-google-")));
process.env.GOOGLE_CLIENT_ID = "client-123.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "secret";
process.env.BASE_URL = "https://vynor.lk";

let g: typeof import("../src/routes/googleAuth.js");
let server: import("node:http").Server;
let baseUrl = "";

before(async () => {
  g = await import("../src/routes/googleAuth.js");
  const express = (await import("express")).default;
  const app = express();
  app.use("/api/auth/google", g.googleAuthRouter);
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server?.close());

const idToken = (claims: Record<string, unknown>) =>
  `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const good = {
  iss: "https://accounts.google.com",
  aud: "client-123.apps.googleusercontent.com",
  exp: Math.floor(Date.now() / 1000) + 600,
  sub: "1",
  email: "Kamal@Example.com",
  email_verified: true,
  nonce: "n1",
};
const expected = {
  clientId: "client-123.apps.googleusercontent.com",
  nonce: "n1",
};

test("a valid Google ID token yields the lower-cased verified email", () => {
  assert.equal(
    g.validateGoogleIdToken(idToken(good), expected).email,
    "kamal@example.com",
  );
});

test("tokens for another app, wrong nonce, expired or unverified are rejected", () => {
  assert.throws(
    () => g.validateGoogleIdToken(idToken({ ...good, aud: "other" }), expected),
    /different app/,
  );
  assert.throws(
    () => g.validateGoogleIdToken(idToken({ ...good, nonce: "x" }), expected),
    /could not be verified/,
  );
  assert.throws(
    () => g.validateGoogleIdToken(idToken({ ...good, exp: 1 }), expected),
    /expired/,
  );
  assert.throws(
    () =>
      g.validateGoogleIdToken(
        idToken({ ...good, email_verified: false }),
        expected,
      ),
    /not verified/,
  );
  assert.throws(
    () =>
      g.validateGoogleIdToken(
        idToken({ ...good, iss: "https://evil.example" }),
        expected,
      ),
    /not issued by Google/,
  );
});

test("only known login parameters survive the round trip (no open redirect)", () => {
  assert.equal(
    g.sanitizeReturnQuery(
      "source=vscode&state=abc&next=https://evil.example&callback=vscode://vynorai.vynorai/auth",
    ),
    "source=vscode&callback=vscode%3A%2F%2Fvynorai.vynorai%2Fauth&state=abc",
  );
});

test("start redirects to Google with PKCE and sets a signed, HttpOnly state cookie", async () => {
  const res = await fetch(`${baseUrl}/api/auth/google?return=source%3Dvscode`, {
    redirect: "manual",
  });
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get("location")!);
  assert.equal(location.host, "accounts.google.com");
  assert.equal(
    location.searchParams.get("redirect_uri"),
    "https://vynor.lk/api/auth/google/callback",
  );
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  const cookie = res.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
});

test("a callback without the matching state cookie is refused", async () => {
  const res = await fetch(
    `${baseUrl}/api/auth/google/callback?code=c&state=forged`,
    { redirect: "manual" },
  );
  assert.equal(res.status, 302);
  assert.match(res.headers.get("location")!, /^\/login\.html#gerror=/);
});

test("the login page can ask whether Google sign-in is configured", async () => {
  assert.deepEqual(
    await (await fetch(`${baseUrl}/api/auth/google/config`)).json(),
    { enabled: true },
  );
});
