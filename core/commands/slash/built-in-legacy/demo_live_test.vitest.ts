import { describe, it } from "vitest";
import { SwarmCommand } from "./swarm";
import os from "os";
import fs from "fs";
import path from "path";

describe("Live Demonstration of Swarm Safeguards", () => {
  it("Scenario 1: Customer runs /swarm on a Non-Git project", async () => {
    const tempNoGit = fs.mkdtempSync(
      path.join(os.tmpdir(), "vynor-no-git-demo-"),
    );

    const mockIde = {
      getWorkspaceDirs: async () => [tempNoGit],
      readFile: async () => {
        throw new Error("File not found");
      },
      showToast: (type: string, msg: string) =>
        console.log(`[IDE Toast: ${type}] ${msg}`),
    };

    const chunks: string[] = [];
    for await (const chunk of SwarmCommand.run({
      ide: mockIde as any,
      llm: { apiKey: "" } as any,
      input: "/swarm",
      history: [],
      contextItems: [],
      params: { bypassAuthForTesting: true, skipGitCheckForTesting: false },
      addContextItem: () => {},
      selectedCode: [],
      abortController: new AbortController(),
    } as any)) {
      if (chunk) chunks.push(chunk);
    }

    console.log("\n=======================================================");
    console.log("SCENARIO 1: LIVE OUTPUT WHEN RUNNING ON A NON-GIT PROJECT");
    console.log("=======================================================");
    console.log(chunks.join(""));
    console.log("=======================================================\n");

    fs.rmSync(tempNoGit, { recursive: true, force: true });
  });

  it("Scenario 2: Free user / unauthenticated user runs /swarm", async () => {
    const mockIde = {
      getWorkspaceDirs: async () => ["file:///workspace/my-app"],
      readFile: async () => {
        throw new Error("File not found");
      },
    };

    const chunks: string[] = [];
    for await (const chunk of SwarmCommand.run({
      ide: mockIde as any,
      llm: { apiKey: "" } as any,
      input: "/swarm",
      history: [],
      contextItems: [],
      params: { testAuthGate: true },
      addContextItem: () => {},
      selectedCode: [],
      abortController: new AbortController(),
    } as any)) {
      if (chunk) chunks.push(chunk);
    }

    console.log("\n=======================================================");
    console.log("SCENARIO 2: LIVE OUTPUT WHEN A FREE USER RUNS /SWARM");
    console.log("=======================================================");
    console.log(chunks.join(""));
    console.log("=======================================================\n");
  });

  it("Scenario 3: Pro subscriber runs /swarm on a valid project", async () => {
    const mockIde = {
      getWorkspaceDirs: async () => ["file:///workspace/saas-repo"],
      readFile: async (uri: string) => {
        if (uri.endsWith("package.json")) {
          return JSON.stringify({
            name: "saas-app",
            dependencies: { express: "^4.18.2" },
          });
        }
        throw new Error("File not found");
      },
      showToast: (type: string, msg: string) =>
        console.log(`[IDE Toast: ${type}] ${msg}`),
    };

    const chunks: string[] = [];
    for await (const chunk of SwarmCommand.run({
      ide: mockIde as any,
      llm: { apiKey: "vynor_live_test_pro_mock_key_001" } as any,
      input: "/swarm run",
      history: [],
      contextItems: [],
      params: { bypassAuthForTesting: true, skipGitCheckForTesting: true },
      addContextItem: () => {},
      selectedCode: [],
      abortController: new AbortController(),
    } as any)) {
      if (chunk) chunks.push(chunk);
    }

    console.log("\n=======================================================");
    console.log("SCENARIO 3: LIVE OUTPUT FOR AN AUTHORIZED PRO SUBSCRIBER");
    console.log("=======================================================");
    console.log(chunks.join(""));
    console.log("=======================================================\n");
  });
});
