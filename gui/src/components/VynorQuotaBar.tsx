import React, { useEffect, useState, useCallback, useContext } from "react";
import styled from "styled-components";
import { ArrowTopRightOnSquareIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import { IdeMessengerContext } from "../context/IdeMessenger";
import { useAppSelector } from "../redux/hooks";

const VYNOR_API_URL = "https://vynor.lk";

interface QuotaState {
  planName: string;
  maxTokens: number;
  usedTokens: number;
  remainingTokens: number;
  percentageUsed: number;
  periodEnd: string;
  isLoggedIn: boolean;
  email: string;
}

const BarContainer = styled.div`
  margin: 6px 10px 8px 10px;
  padding: 8px 12px;
  background: rgba(14, 17, 28, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  backdrop-filter: blur(12px);
  font-family: inherit;
  font-size: 11px;
  transition: all 0.2s ease;

  &:hover {
    border-color: rgba(0, 229, 255, 0.25);
    background: rgba(14, 17, 28, 0.9);
  }
`;

const HeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
`;

const BrandBadge = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: #eef2f8;
`;

const SparkleIcon = styled.span`
  background: linear-gradient(135deg, #00e5ff 0%, #b026ff 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  font-weight: 800;
`;

const PlanPill = styled.span<{ $plan: string }>`
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 1px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  background: ${(props) =>
    props.$plan === "PRO" || props.$plan === "ENTERPRISE"
      ? "rgba(176, 38, 255, 0.2)"
      : "rgba(0, 229, 255, 0.15)"};
  color: ${(props) =>
    props.$plan === "PRO" || props.$plan === "ENTERPRISE" ? "#d070ff" : "#00e5ff"};
  border: 1px solid
    ${(props) =>
      props.$plan === "PRO" || props.$plan === "ENTERPRISE"
        ? "rgba(176, 38, 255, 0.3)"
        : "rgba(0, 229, 255, 0.25)"};
`;

const TokenCount = styled.div`
  font-family: monospace;
  font-size: 11px;
  color: #a0aec0;

  span {
    color: #eef2f8;
    font-weight: 600;
  }
`;

const ProgressTrack = styled.div`
  width: 100%;
  height: 5px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 999px;
  overflow: hidden;
  position: relative;
`;

const ProgressFill = styled.div<{ $percent: number; $isWarning: boolean }>`
  height: 100%;
  width: ${(props) => Math.min(100, Math.max(0, props.$percent))}%;
  background: ${(props) =>
    props.$isWarning
      ? "linear-gradient(90deg, #ff9100 0%, #ff5252 100%)"
      : "linear-gradient(90deg, #00e5ff 0%, #b026ff 100%)"};
  border-radius: 999px;
  transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 0 8px
    ${(props) =>
      props.$isWarning ? "rgba(255, 82, 82, 0.5)" : "rgba(0, 229, 255, 0.4)"};
`;

const FooterRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 10px;
  color: #718096;
`;

const ActionLink = styled.a`
  color: #00e5ff;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-weight: 500;
  transition: opacity 0.2s;

  &:hover {
    opacity: 0.85;
    text-decoration: underline;
  }
`;

const LoginPrompt = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
`;

const LoginButton = styled.button`
  background: linear-gradient(135deg, #00e5ff 0%, #b026ff 100%);
  color: #000;
  font-weight: 700;
  font-size: 11px;
  border: none;
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: transform 0.15s, opacity 0.15s;

  &:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }
`;

export function VynorQuotaBar() {
  const ideMessenger = useContext(IdeMessengerContext);
  const config = useAppSelector((store) => store.config.config);

  const resolveToken = useCallback(() => {
    const local =
      localStorage.getItem("vynorai_token") ||
      localStorage.getItem("vynor_jwt") ||
      localStorage.getItem("vynorai_api_key");
    if (local) return local;

    const chatModel = config?.selectedModelByRole?.chat;
    if (
      chatModel?.apiKey &&
      (chatModel.apiBase?.includes("vynor") ||
        chatModel.title?.includes("Vynor") ||
        (chatModel as any).provider === "vynorai")
    ) {
      return chatModel.apiKey;
    }

    const allChatModels = config?.modelsByRole?.chat || [];
    for (const m of allChatModels) {
      if (
        m.apiKey &&
        (m.apiBase?.includes("vynor") ||
          m.title?.includes("Vynor") ||
          (m as any).provider === "vynorai")
      ) {
        return m.apiKey;
      }
    }
    return "";
  }, [config]);

  const [quota, setQuota] = useState<QuotaState>(() => {
    try {
      const cached = localStorage.getItem("vynorai_cached_quota");
      if (cached) return JSON.parse(cached);
    } catch (e) {}
    return {
      planName: "FREE",
      maxTokens: 100_000,
      usedTokens: 0,
      remainingTokens: 100_000,
      percentageUsed: 0,
      periodEnd: "",
      isLoggedIn: !!(
        localStorage.getItem("vynorai_token") ||
        localStorage.getItem("vynor_jwt") ||
        localStorage.getItem("vynorai_api_key")
      ),
      email: "",
    };
  });
  const [loading, setLoading] = useState(false);

  const fetchQuota = useCallback(async () => {
    setLoading(true);
    try {
      const token = resolveToken();
      if (!token) {
        setQuota((prev) => ({ ...prev, isLoggedIn: false }));
        setLoading(false);
        return;
      }

      const res = await fetch(`${VYNOR_API_URL}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        if (res.status === 401) {
          localStorage.removeItem("vynorai_token");
          localStorage.removeItem("vynor_jwt");
          localStorage.removeItem("vynorai_api_key");
          localStorage.removeItem("vynorai_cached_quota");
        }
        setQuota((prev) => ({ ...prev, isLoggedIn: false }));
        return;
      }

      const data = await res.json();
      const monthly = data.monthlyUsage || {};
      const max = monthly.max_tokens || 100_000;
      const used = monthly.used_tokens || 0;
      const remaining = Math.max(0, max - used);
      const percent = Math.min(100, Math.round((used / max) * 100));

      const newQuota: QuotaState = {
        planName: (monthly.plan_name || "FREE").toUpperCase(),
        maxTokens: max,
        usedTokens: used,
        remainingTokens: remaining,
        percentageUsed: percent,
        periodEnd: monthly.period_end || "",
        isLoggedIn: true,
        email: data.user?.email || "",
      };

      setQuota(newQuota);
      try {
        localStorage.setItem("vynorai_cached_quota", JSON.stringify(newQuota));
      } catch (e) {}
    } catch (e) {
      // Silent catch on network blip
    } finally {
      setLoading(false);
    }
  }, [resolveToken]);

  useEffect(() => {
    fetchQuota();
    // Auto-refresh quota every 3 minutes
    const interval = setInterval(fetchQuota, 180_000);
    const handleStorage = () => fetchQuota();
    const handleMsg = (e: MessageEvent) => {
      if (
        e.data?.type === "vynorAuthSuccess" ||
        e.data?.messageType === "vynorAuthSuccess" ||
        e.data?.type === "configUpdate"
      ) {
        fetchQuota();
      }
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener("message", handleMsg);
    return () => {
      clearInterval(interval);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("message", handleMsg);
    };
  }, [fetchQuota]);

  const handleBrowserLogin = async () => {
    let ideName = "VS Code";
    let scheme = "vscode";
    try {
      if (ideMessenger?.ide?.getIdeInfo) {
        const info = await ideMessenger.ide.getIdeInfo();
        if (info?.name) ideName = info.name;
        const lower = (info?.name || "").toLowerCase();
        if (lower.includes("antigravity")) {
          scheme = "antigravity";
        } else if (lower.includes("cursor")) {
          scheme = "cursor";
        } else if (lower.includes("windsurf")) {
          scheme = "windsurf";
        }
      }
    } catch (_) {}

    const loginUrl = `${VYNOR_API_URL}/login?source=vscode&ide=${encodeURIComponent(ideName)}&scheme=${scheme}&callback=${scheme}://vynorai.vynorai/auth`;
    if (ideMessenger?.post) {
      ideMessenger.post("openUrl", loginUrl);
    } else {
      window.open(loginUrl, "_blank");
    }
  };

  const handleUpgrade = (e: React.MouseEvent) => {
    e.preventDefault();
    const upgradeUrl = `${VYNOR_API_URL}/#pricing`;
    if (ideMessenger?.post) {
      ideMessenger.post("openUrl", upgradeUrl);
    } else {
      window.open(upgradeUrl, "_blank");
    }
  };

  const isWarning = quota.percentageUsed >= 80;

  if (!quota.isLoggedIn) {
    return (
      <BarContainer>
        <LoginPrompt>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <SparkleIcon>⚡</SparkleIcon>
            <span style={{ color: "#a0aec0" }}>Sign in to activate VynorAI Cloud</span>
          </div>
          <LoginButton onClick={handleBrowserLogin}>
            Sign In with Browser
          </LoginButton>
        </LoginPrompt>
      </BarContainer>
    );
  }

  return (
    <BarContainer>
      <HeaderRow>
        <BrandBadge>
          <SparkleIcon>💎</SparkleIcon>
          <span>VynorAI Quota</span>
          <PlanPill $plan={quota.planName}>{quota.planName}</PlanPill>
        </BrandBadge>
        <TokenCount>
          <span>{quota.remainingTokens.toLocaleString()}</span> / {quota.maxTokens.toLocaleString()} left
        </TokenCount>
      </HeaderRow>

      <ProgressTrack>
        <ProgressFill $percent={quota.percentageUsed} $isWarning={isWarning} />
      </ProgressTrack>

      <FooterRow>
        <span>
          {100 - quota.percentageUsed}% remaining
          {quota.periodEnd ? ` • resets ${quota.periodEnd}` : ""}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={fetchQuota}
            style={{
              background: "none",
              border: "none",
              color: "#718096",
              cursor: "pointer",
              padding: 0,
              display: "flex",
              alignItems: "center",
            }}
            title="Refresh Token Balance"
          >
            <ArrowPathIcon
              style={{
                width: 11,
                height: 11,
                animation: loading ? "spin 1s linear infinite" : "none",
              }}
            />
          </button>
          <ActionLink href="#" onClick={handleUpgrade}>
            Upgrade Plan <ArrowTopRightOnSquareIcon style={{ width: 10, height: 10 }} />
          </ActionLink>
        </div>
      </FooterRow>
    </BarContainer>
  );
}
export default VynorQuotaBar;
