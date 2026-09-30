import * as vscode from "vscode";
import * as fs from "node:fs";
import { getConfigJsonPath } from "core/util/paths";

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
}

/**
 * Updates the user's ~/.continue/config.json to point to VynorAI Production Cloud
 * with their authenticated API key.
 */
export async function applyVynorConfig(apiKey: string, email: string): Promise<boolean> {
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
    return true;
  } catch (err) {
    console.error("[VynorAuth] Failed updating config.json:", err);
    return false;
  }
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
    };
  } catch (err) {
    return null;
  }
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
      statusBar.text = `$(sparkle) VynorAI: ${remainingK}k tokens left`;
      statusBar.tooltip = `Plan: ${quota.planName} | Used: ${quota.usedTokens.toLocaleString()} / ${quota.monthlyTokens.toLocaleString()} tokens (${100 - quota.percentageUsed}% remaining)`;
      statusBar.command = "vynorai.openChat";
    }
  };

  refreshQuotaStatus();
  // Poll every 5 minutes
  const timer = setInterval(refreshQuotaStatus, 300_000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  // 2. Register Custom URI Handler: vscode://vynorai.vynorai/auth
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      async handleUri(uri: vscode.Uri) {
        if (uri.path === "/auth" || uri.path.includes("auth")) {
          const params = new URLSearchParams(uri.query);
          const apiKey = params.get("apiKey");
          const email = params.get("email") || "Developer";
          const token = params.get("token");

          if (!apiKey) {
            void vscode.window.showErrorMessage(
              "VynorAI Authentication failed: No API Key received from browser."
            );
            return;
          }

          // Save to globalState
          await context.globalState.update("vynorai_api_key", apiKey);
          if (token) await context.globalState.update("vynorai_jwt_token", token);
          if (email) await context.globalState.update("vynorai_user_email", email);

          // Update Continue config.json automatically
          await applyVynorConfig(apiKey, email);

          // Trigger config reload
          try {
            await vscode.commands.executeCommand("continue.reloadConfig");
          } catch (e) {}

          // Refresh status bar
          refreshQuotaStatus();

          void vscode.window.showInformationMessage(
            `🎉 Welcome to VynorAI! Successfully authenticated as ${email}. Cloud AI Coding Assistant and Antigravity Tools are now active.`
          );
        }
      },
    })
  );

  // 3. Register Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("vynorai.login", () => {
      const loginUrl = vscode.Uri.parse(
        `${VYNORAI_WEB_URL}/login?source=vscode&callback=vscode://vynorai.vynorai/auth`
      );
      void vscode.env.openExternal(loginUrl);
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
