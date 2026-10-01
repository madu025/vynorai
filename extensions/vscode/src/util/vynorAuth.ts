import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";

import { getConfigJsonPath, getConfigYamlPath } from "core/util/paths";
import * as vscode from "vscode";
import { isSeq, parseDocument } from "yaml";

import { SecretStorage } from "../stubs/SecretStorage";

export const VYNORAI_PROD_URL = "https://vynor.lk/v1";
export const VYNORAI_WEB_URL = "https://vynor.lk";
const VYNORAI_SECRET_NAME = "VYNORAI_API_KEY";
const VYNORAI_SECRET_REF = `\${{ secrets.${VYNORAI_SECRET_NAME} }}`;

function writeFileAtomically(filePath: string, content: string): void {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, content, { encoding: "utf-8", mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath);
    }
  }
}

export interface VynorQuotaInfo {
  planId: string;
  planName: string;
  monthlyTokens: number;
  usedTokens: number;
  remainingTokens: number;
  percentageUsed: number;
  periodEnd: string;
  email: string;
  tokensSaved?: number;
  savingPercentage?: number;
  estimatedLkrSaved?: number;
}

/**
 * Updates local config to reference the encrypted IDE secret. The credential
 * itself never gets persisted in config.yaml/config.json.
 */
export async function applyVynorConfig(): Promise<boolean> {
  let success = false;

  // 1. Update config.yaml if present
  try {
    const yamlPath = getConfigYamlPath();
    if (fs.existsSync(yamlPath)) {
      const document = parseDocument(fs.readFileSync(yamlPath, "utf-8"));
      if (document.errors.length > 0) {
        throw new Error(document.errors.map((error) => error.message).join("; "));
      }

      if (!isSeq(document.get("models", true))) {
        document.set("models", []);
      }
      const models = document.get("models", true);
      if (!isSeq(models)) {
        throw new Error("VynorAI config models must be a YAML sequence");
      }

      let foundVynorModel = false;
      models.items.forEach((item, index) => {
        const model = (item as { toJSON?: () => unknown } | null)?.toJSON?.() as
          | Record<string, unknown>
          | undefined;
        if (
          model?.provider === "vynorai" ||
          (typeof model?.apiBase === "string" && model.apiBase.includes("vynor.lk"))
        ) {
          foundVynorModel = true;
          document.setIn(["models", index, "provider"], "vynorai");
          document.setIn(["models", index, "apiBase"], `${VYNORAI_PROD_URL}/`);
          document.setIn(["models", index, "apiKey"], VYNORAI_SECRET_REF);
          const roles = Array.isArray(model.roles) ? model.roles : ["chat", "edit", "apply"];
          document.setIn(
            ["models", index, "roles"],
            [...new Set([...roles, "subagent"])],
          );
        }
      });

      if (!foundVynorModel) {
        models.add({
          name: "VynorAI Coder",
          provider: "vynorai",
          model: "deepseek/deepseek-chat-v3-0324",
          apiBase: `${VYNORAI_PROD_URL}/`,
          apiKey: VYNORAI_SECRET_REF,
          roles: ["chat", "edit", "apply", "subagent"],
        });
      }

      writeFileAtomically(yamlPath, document.toString());
      success = true;
    }
  } catch (err) {
    console.error("[VynorAuth] Failed updating config.yaml:", err);
  }

  // 2. Update config.json
  try {
    const configPath = getConfigJsonPath();
    let config: any = {};

    if (fs.existsSync(configPath)) {
      try {
        const raw = fs.readFileSync(configPath, "utf-8");
        config = JSON.parse(raw);
      } catch (e) {
        config = {};
      }
    }

    config.models = config.models || [];
    
    // Check if VynorAI primary model already configured
    const vynorModelIndex = config.models.findIndex(
      (m: any) => m.title === "VynorAI Coder" || m.apiBase?.includes("vynor.lk")
    );

    const vynorModelConfig = {
      title: "VynorAI Coder",
      provider: "vynorai",
      model: "deepseek/deepseek-chat-v3-0324",
      apiBase: VYNORAI_PROD_URL,
      apiKey: VYNORAI_SECRET_REF,
    };

    if (vynorModelIndex >= 0) {
      config.models[vynorModelIndex] = vynorModelConfig;
    } else {
      config.models.unshift(vynorModelConfig);
    }

    // Configure tab autocomplete
    config.tabAutocompleteModel = {
      title: "VynorAI Autocomplete",
      provider: "vynorai",
      model: "deepseek/deepseek-coder-v2",
      apiBase: VYNORAI_PROD_URL,
      apiKey: VYNORAI_SECRET_REF,
    };

    writeFileAtomically(configPath, JSON.stringify(config, null, 2));
    success = true;
  } catch (err) {
    console.error("[VynorAuth] Failed updating config.json:", err);
  }

  return success;
}

/**
 * Fetch live quota and subscription status from VynorAI Cloud
 */
export async function fetchVynorQuota(apiKey: string): Promise<VynorQuotaInfo | null> {
  try {
    const res = await fetch(`${VYNORAI_WEB_URL}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const monthly = data.monthlyUsage || {};
    const slm = data.slmSavings || {};
    const maxTokens = monthly.max_tokens || 100_000;
    const usedTokens = monthly.used_tokens || 0;
    const remaining = Math.max(0, maxTokens - usedTokens);
    const percentage = Math.min(100, Math.round((usedTokens / maxTokens) * 100));

    return {
      planId: monthly.plan_name || "free",
      planName: (monthly.plan_name || "Free Tier").toUpperCase(),
      monthlyTokens: maxTokens,
      usedTokens,
      remainingTokens: remaining,
      percentageUsed: percentage,
      periodEnd: monthly.period_end || "",
      email: data.user?.email || "",
      tokensSaved: slm.tokensSaved || 0,
      savingPercentage: slm.savingPercentage || 0,
      estimatedLkrSaved: slm.estimatedLkrSaved || 0,
    };
  } catch (err) {
    return null;
  }
}

let loopbackServer: http.Server | null = null;
const LOOPBACK_PORT = 41403;
const AUTH_STATE_TTL_MS = 5 * 60_000;
const LEGACY_API_KEY_SECRET = "vynorai_api_key";
const JWT_SECRET = "vynorai_jwt_token";
let pendingAuthState: { value: string; expiresAt: number } | null = null;

function startLoopbackServer(
  context: vscode.ExtensionContext,
  onAuthSuccess: (apiKey: string, email: string, token?: string) => Promise<void>
) {
  if (loopbackServer) return;

  try {
    loopbackServer = http.createServer(async (req, res) => {
      const origin = req.headers.origin;
      if (origin === VYNORAI_WEB_URL) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
      }
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Cache-Control", "no-store");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      try {
        const reqUrl = new URL(req.url || "/", `http://127.0.0.1:${LOOPBACK_PORT}`);
        if (reqUrl.pathname === "/auth" && req.method === "POST") {
          const chunks: Buffer[] = [];
          let totalBytes = 0;
          for await (const chunk of req) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            totalBytes += buffer.length;
            if (totalBytes > 8_192) {
              throw new Error("Authentication payload is too large");
            }
            chunks.push(buffer);
          }
          const payload = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as {
            apiKey?: unknown;
            email?: unknown;
            state?: unknown;
          };
          const apiKey = typeof payload.apiKey === "string" ? payload.apiKey : null;
          const email = typeof payload.email === "string" ? payload.email : "Developer";
          const state = typeof payload.state === "string" ? payload.state : null;

          const stateIsValid = Boolean(
            state &&
            pendingAuthState &&
            Date.now() <= pendingAuthState.expiresAt &&
            state.length === pendingAuthState.value.length &&
            crypto.timingSafeEqual(Buffer.from(state), Buffer.from(pendingAuthState.value)),
          );
          const keyIsValid = Boolean(apiKey && /^vynor_live_[a-f0-9]{32}$/i.test(apiKey));

          if (origin === VYNORAI_WEB_URL && stateIsValid && keyIsValid && apiKey) {
            pendingAuthState = null; // one-time, replay-resistant handshake
            await onAuthSuccess(apiKey, email);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, message: "Connected to IDE successfully!" }));
            return;
          }
        }
      } catch (e) {}

      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid or expired authentication handshake" }));
    });

    loopbackServer.listen(LOOPBACK_PORT, "127.0.0.1", () => {
      console.log(`[VynorAuth] Ephemeral loopback handshake listening on 127.0.0.1:${LOOPBACK_PORT}`);
    });

    loopbackServer.on("error", (err: any) => {
      console.warn("[VynorAuth] Loopback server port busy or unavailable (non-fatal):", err.message);
    });

    context.subscriptions.push({
      dispose: () => {
        try {
          loopbackServer?.close();
        } catch (_) {}
      },
    });
  } catch (err) {
    console.warn("[VynorAuth] Loopback server initialization failed:", err);
  }
}

export async function handleSuccessfulAuthentication(
  context: vscode.ExtensionContext,
  apiKey: string,
  email: string,
  token?: string,
  refreshQuotaStatus?: () => void
) {
  const secretStorage = new SecretStorage(context);
  await secretStorage.store(VYNORAI_SECRET_NAME, apiKey);
  await context.secrets.delete(LEGACY_API_KEY_SECRET);
  await context.globalState.update("vynorai_api_key", undefined);
  if (token) {
    await context.secrets.store(JWT_SECRET, token);
    await context.globalState.update("vynorai_jwt_token", undefined);
  }
  if (email) await context.globalState.update("vynorai_user_email", email);

  await applyVynorConfig();

  try {
    await vscode.commands.executeCommand("continue.reloadConfig");
  } catch (e) {}

  if (refreshQuotaStatus) refreshQuotaStatus();

  try {
    await vscode.commands.executeCommand("continue.continueGUIView.focus");
  } catch (e) {}

  void vscode.window.showInformationMessage(
    `🎉 Welcome to VynorAI! Successfully authenticated as ${email}. Coding Assistant & Cloud Models are now active.`
  );
}

/**
 * Setup VynorAI Browser-based OAuth confirmation URI handler & status bar
 */
export function setupVynorAuth(context: vscode.ExtensionContext) {
  const secretStorage = new SecretStorage(context);
  // 1. Register Status Bar item for Token Remaining progress
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBar.command = "vynorai.openChat";
  statusBar.text = "$(sparkle) VynorAI: Ready";
  statusBar.tooltip = "Click to open VynorAI Coding Assistant";
  statusBar.show();
  context.subscriptions.push(statusBar);

  // Update status bar with live quota
  const refreshQuotaStatus = async () => {
    let savedKey = (await secretStorage.get(VYNORAI_SECRET_NAME)) || "";
    // One-time migration from older extension releases.
    if (!savedKey) {
      savedKey =
        (await context.secrets.get(LEGACY_API_KEY_SECRET)) ||
        (context.globalState.get("vynorai_api_key") as string) ||
        "";
      if (savedKey) {
        await secretStorage.store(VYNORAI_SECRET_NAME, savedKey);
        await context.secrets.delete(LEGACY_API_KEY_SECRET);
        await context.globalState.update("vynorai_api_key", undefined);
        await applyVynorConfig();
      }
    }
    // Auto-detect key from existing config.yaml or config.json
    if (!savedKey) {
      try {
        const yamlPath = getConfigYamlPath();
        if (fs.existsSync(yamlPath)) {
          const content = fs.readFileSync(yamlPath, "utf-8");
          const m = content.match(/vynor_live_[a-f0-9]{32}/i);
          if (m) savedKey = m[0];
        }
        if (!savedKey) {
          const jsonPath = getConfigJsonPath();
          if (fs.existsSync(jsonPath)) {
            const content = fs.readFileSync(jsonPath, "utf-8");
            const m = content.match(/vynor_live_[a-f0-9]{32}/i);
            if (m) savedKey = m[0];
          }
        }
        if (savedKey) {
          await secretStorage.store(VYNORAI_SECRET_NAME, savedKey);
        }
      } catch (_) {}
    }
    if (!savedKey) {
      statusBar.text = "$(key) VynorAI: Log in";
      statusBar.tooltip = "Click to sign in with Vynor AI in browser";
      statusBar.command = "vynorai.login";
      return;
    }

    const quota = await fetchVynorQuota(savedKey);
    if (quota) {
      const remainingK = Math.round(quota.remainingTokens / 1000);
      const savedK = quota.tokensSaved && quota.tokensSaved > 0 ? ` (+${Math.round(quota.tokensSaved / 1000)}k saved)` : "";
      statusBar.text = `$(sparkle) VynorAI: ${remainingK}k left${savedK}`;

      const savedStr = quota.tokensSaved && quota.tokensSaved > 0
        ? `\n✨ VynorAI Saved: +${quota.tokensSaved.toLocaleString()} tokens free (~රු. ${quota.estimatedLkrSaved || 0})`
        : `\n✨ 0-Token SLM Optimization: Active`;

      statusBar.tooltip = `VynorAI Coding Intelligence\nPlan: ${quota.planName}\nTokens Left: ${quota.remainingTokens.toLocaleString()} / ${quota.monthlyTokens.toLocaleString()} (${100 - quota.percentageUsed}% remaining)\nReal Consumed: ${quota.usedTokens.toLocaleString()} tokens${savedStr}\nClick to open VynorAI Chat`;
      statusBar.command = "vynorai.openChat";
    }
  };

  void refreshQuotaStatus();
  // Poll every 5 minutes
  const timer = setInterval(refreshQuotaStatus, 300_000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  // 2. Start ephemeral loopback server for zero-friction browser handshake
  startLoopbackServer(context, async (apiKey, email, token) => {
    await handleSuccessfulAuthentication(context, apiKey, email, token, refreshQuotaStatus);
  });

  // 3. Register Custom URI Handler: <scheme>://vynorai.vynorai/auth
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      async handleUri(uri: vscode.Uri) {
        if (uri.authority === "vynorai.vynorai" && uri.path === "/auth") {
          const params = new URLSearchParams(uri.query);
          const apiKey = params.get("apiKey");
          const email = params.get("email") || "Developer";
          const token = params.get("token") || undefined;
          const state = params.get("state");
          const stateIsValid = Boolean(
            state &&
            pendingAuthState &&
            Date.now() <= pendingAuthState.expiresAt &&
            state.length === pendingAuthState.value.length &&
            crypto.timingSafeEqual(Buffer.from(state), Buffer.from(pendingAuthState.value)),
          );

          if (!apiKey || !/^vynor_live_[a-f0-9]{32}$/i.test(apiKey) || !stateIsValid) {
            void vscode.window.showErrorMessage(
              "VynorAI Authentication failed: invalid or expired browser handshake."
            );
            return;
          }

          pendingAuthState = null;
          await handleSuccessfulAuthentication(context, apiKey, email, token, refreshQuotaStatus);
        }
      },
    })
  );

  // 4. Register Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("vynorai.login", () => {
      const scheme = vscode.env.uriScheme || "vscode";
      const appName = vscode.env.appName || "IDE";
      const state = crypto.randomBytes(32).toString("hex");
      pendingAuthState = { value: state, expiresAt: Date.now() + AUTH_STATE_TTL_MS };
      const loginUrl = vscode.Uri.parse(
        `${VYNORAI_WEB_URL}/login?source=vscode&ide=${encodeURIComponent(appName)}&scheme=${encodeURIComponent(scheme)}&state=${state}&callback=${encodeURIComponent(`${scheme}://vynorai.vynorai/auth`)}`
      );
      void vscode.env.openExternal(loginUrl);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vynorai.setApiKey", async (directKey?: string) => {
      const key = (typeof directKey === "string" && directKey) ? directKey : await vscode.window.showInputBox({
        title: "VynorAI API Key",
        prompt: "Paste your VynorAI API Key (starts with vynor_live_...)",
        placeHolder: "vynor_live_...",
        ignoreFocusOut: true,
      });
      const normalizedKey = key?.trim();
      if (normalizedKey && /^vynor_live_[a-f0-9]{32}$/i.test(normalizedKey)) {
        await handleSuccessfulAuthentication(context, normalizedKey, "Developer", undefined, refreshQuotaStatus);
      } else if (normalizedKey) {
        void vscode.window.showErrorMessage("Invalid VynorAI API key format.");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vynorai.openDashboard", () => {
      void vscode.env.openExternal(vscode.Uri.parse(VYNORAI_WEB_URL));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vynorai.upgradePlan", () => {
      void vscode.env.openExternal(vscode.Uri.parse(`${VYNORAI_WEB_URL}/#pricing`));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vynorai.openChat", () => {
      void vscode.commands.executeCommand("continue.continueGUIView.focus");
    })
  );
}

export function getActiveVynorKeySync(): string {
  try {
    const yamlPath = getConfigYamlPath();
    if (fs.existsSync(yamlPath)) {
      const content = fs.readFileSync(yamlPath, "utf-8");
      const m = content.match(/vynor_live_[a-f0-9]{32}/i);
      if (m) return m[0];
    }
    const jsonPath = getConfigJsonPath();
    if (fs.existsSync(jsonPath)) {
      const content = fs.readFileSync(jsonPath, "utf-8");
      const m = content.match(/vynor_live_[a-f0-9]{32}/i);
      if (m) return m[0];
    }
  } catch (_) {}
  return "";
}
