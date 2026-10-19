import assert from "node:assert/strict";
import { test } from "node:test";
import {
  beginM365OAuth,
  completeM365OAuth,
  createOfficeAuthDialogUrl,
} from "./oauth.js";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) || null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

test("M365 OAuth uses PKCE and rejects callback state replay", async () => {
  const storage = new MemoryStorage();
  const config = {
    tenantId: "tenant",
    clientId: "client",
    redirectUri: "https://addin.example/callback",
    scopes: ["api://client/m365.excel.read"],
  };
  const authorizeUrl = await beginM365OAuth(config, storage);
  const authorize = new URL(authorizeUrl);
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorize.searchParams.get("code_challenge"));
  await assert.rejects(
    () =>
      completeM365OAuth(
        "https://addin.example/callback?code=x&state=wrong",
        config,
        storage,
      ),
    /state validation/,
  );
});

test("M365 OAuth uses the organizations authority for multitenant sign-in", async () => {
  const storage = new MemoryStorage();
  const config = {
    tenantId: "home-tenant",
    authority: "organizations",
    clientId: "client",
    redirectUri: "https://addin.example/callback",
    scopes: ["api://client/m365.excel.read"],
  };
  const authorize = new URL(await beginM365OAuth(config, storage));
  assert.equal(authorize.pathname, "/organizations/oauth2/v2.0/authorize");
});

test("Graph email consent is requested as a separate scope set", async () => {
  const storage = new MemoryStorage();
  const authorize = new URL(
    await beginM365OAuth(
      {
        tenantId: "tenant",
        clientId: "client",
        redirectUri: "https://addin.example/callback",
        scopes: ["https://graph.microsoft.com/Mail.Send"],
        graphScopes: ["https://graph.microsoft.com/Mail.Send"],
      },
      storage,
    ),
  );
  assert.equal(
    authorize.searchParams.get("scope"),
    "https://graph.microsoft.com/Mail.Send",
  );
});

test("M365 OAuth opens only Microsoft sign-in URLs in an Office dialog", () => {
  const dialog = new URL(
    createOfficeAuthDialogUrl(
      "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize",
      "https://addin.example",
    ),
  );
  assert.equal(dialog.origin, "https://addin.example");
  assert.equal(dialog.pathname, "/m365/auth-dialog.html");
  assert.throws(
    () =>
      createOfficeAuthDialogUrl(
        "https://example.invalid/sign-in",
        "https://addin.example",
      ),
    /not allowed/,
  );
});

test("M365 OAuth exchanges a code and clears the one-time verifier", async () => {
  const storage = new MemoryStorage();
  const config = {
    tenantId: "tenant",
    clientId: "client",
    redirectUri: "https://addin.example/callback",
    scopes: ["api://client/m365.excel.read"],
  };
  const authorizeUrl = await beginM365OAuth(config, storage);
  const state = new URL(authorizeUrl).searchParams.get("state");
  const tokens = await completeM365OAuth(
    `https://addin.example/callback?code=one-time&state=${state}`,
    config,
    storage,
    async (_url, init) => {
      assert.equal(init?.method, "POST");
      return new Response(
        JSON.stringify({
          access_token: "token",
          expires_in: 3600,
          token_type: "Bearer",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  );
  assert.equal(tokens.accessToken, "token");
  await assert.rejects(
    () =>
      completeM365OAuth(
        `https://addin.example/callback?code=replay&state=${state}`,
        config,
        storage,
      ),
    /state validation/,
  );
});
