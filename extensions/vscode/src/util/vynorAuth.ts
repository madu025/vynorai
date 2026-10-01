import * as vscode from "vscode";
import * as fs from "node:fs";
import { getConfigJsonPath, getConfigYamlPath } from "core/util/paths";

export const VYNORAI_PROD_URL = "https://vynor.lk/v1";
export const VYNORAI_WEB_URL = "https://vynor.lk";

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
 * Updates the user's config.yaml and config.json to point to VynorAI Production Cloud
 * with their authenticated API key.
 */
export async function applyVynorConfig(apiKey: string, email: string): Promise<boolean> {
  let success = false;

  // 1. Update config.yaml if present
  try {
    const yamlPath = getConfigYamlPath();
    if (fs.existsSync(yamlPath)) {
      let content = fs.readFileSync(yamlPath, "utf-8");
      content = content.replace(/http:\/\/172\.255\.209\.243:3333\/v1\/?/g, `${VYNORAI_PROD_URL}/`);
      if (/apiKey:\s*.*/.test(content)) {
        content = content.replace(/apiKey:\s*["']?.*["']?/g, `apiKey: "${apiKey}"`);
      } else {
        content = content.replace(/provider:\s*vynorai/g, `provider: vynorai\n    apiKey: "${apiKey}"`);
      }
      fs.writeFileSync(yamlPath, content, "utf-8");
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
      provider: "openai",
      model: "deepseek-coder",
      apiBase: VYNORAI_PROD_URL,
      apiKey: apiKey,
    };

    if (vynorModelIndex >= 0) {
      config.models[vynorModelIndex] = vynorModelConfig;
    } else {
      config.models.unshift(vynorModelConfig);
    }

    // Configure tab autocomplete
    config.tabAutocompleteModel = {
      title: "VynorAI Autocomplete",
      provider: "openai",
      model: "deepseek-coder",
      apiBase: VYNORAI_PROD_URL,
      apiKey: apiKey,
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
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

import * as http from "node:http";

let loopbackServer: http.Server | null = null;
const LOOPBACK_PORT = 41403;

function startLoopbackServer(
  context: vscode.ExtensionContext,
  onAuthSuccess: (apiKey: string, email: string, token?: string) => Promise<void>
) {
  if (loopbackServer) return;

  try {
    loopbackServer = http.createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      try {
        const reqUrl = new URL(req.url || "/", `http://127.0.0.1:${LOOPBACK_PORT}`);
        if (reqUrl.pathname === "/auth") {
          const apiKey = reqUrl.searchParams.get("apiKey");
          const email = reqUrl.searchParams.get("email") || "Developer";
          const token = reqUrl.searchParams.get("token") || undefined;

          if (apiKey) {
            await onAuthSuccess(apiKey, email, token);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, message: "Connected to IDE successfully!" }));
            return;
          }
        }
      } catch (e) {}

      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing or invalid apiKey parameter" }));
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
  await context.globalState.update("vynorai_api_key", apiKey);
  if (token) await context.globalState.update("vynorai_jwt_token", token);
  if (email) await context.globalState.update("vynorai_user_email", email);

  await applyVynorConfig(apiKey, email);

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
    const savedKey = (context.globalState.get("vynorai_api_key") as string) || "";
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

  refreshQuotaStatus();
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
        if (uri.path === "/auth" || uri.path.includes("auth")) {
          const params = new URLSearchParams(uri.query);
          const apiKey = params.get("apiKey");
          const email = params.get("email") || "Developer";
          const token = params.get("token") || undefined;

          if (!apiKey) {
            void vscode.window.showErrorMessage(
              "VynorAI Authentication failed: No API Key received from browser."
            );
            return;
          }

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
      const loginUrl = vscode.Uri.parse(
        `${VYNORAI_WEB_URL}/login?source=vscode&ide=${encodeURIComponent(appName)}&scheme=${scheme}&callback=${scheme}://vynorai.vynorai/auth`
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
      if (key?.trim()) {
        await handleSuccessfulAuthentication(context, key.trim(), "Developer", undefined, refreshQuotaStatus);
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
