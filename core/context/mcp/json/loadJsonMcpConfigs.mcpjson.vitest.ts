import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { loadJsonMcpConfigs } from "./loadJsonMcpConfigs";

// A real folder with a real .mcp.json: no mocks.
const project = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-mcpjson-"));
fs.writeFileSync(
  path.join(project, ".mcp.json"),
  JSON.stringify({
    mcpServers: {
      "project-files": {
        command: "node",
        args: ["server.js"],
      },
    },
  }),
);
afterAll(() => fs.rmSync(project, { recursive: true, force: true }));

const ide = (trusted: boolean | undefined) =>
  ({
    getWorkspaceDirs: async () => [pathToFileURL(project).href],
    fileExists: async (uri: string) => {
      try {
        return fs.existsSync(new URL(uri));
      } catch {
        return false;
      }
    },
    readFile: async (uri: string) => fs.readFileSync(new URL(uri), "utf8"),
    ...(trusted === undefined
      ? {}
      : { isWorkspaceTrusted: async () => trusted }),
  }) as any;

describe(".mcp.json at the project root", () => {
  it("loads the servers of a trusted workspace", async () => {
    const { mcpServers, errors } = await loadJsonMcpConfigs(ide(true), false);
    expect(errors).toEqual([]);
    expect(mcpServers.map((server) => server.name)).toEqual(["project-files"]);
    expect(mcpServers[0].sourceFile).toContain(".mcp.json");
  });

  it("does not start anything from an untrusted workspace, and says why", async () => {
    const { mcpServers, errors } = await loadJsonMcpConfigs(ide(false), false);
    expect(mcpServers).toHaveLength(0);
    expect(errors[0]?.message).toContain("not trusted");
  });

  it("loads it when the editor has no trust concept", async () => {
    const { mcpServers } = await loadJsonMcpConfigs(ide(undefined), false);
    expect(mcpServers).toHaveLength(1);
  });

  it("reports a malformed file instead of failing the whole config", async () => {
    const broken = path.join(project, ".mcp.json");
    const good = fs.readFileSync(broken, "utf8");
    fs.writeFileSync(broken, "{ not json");
    const { mcpServers, errors } = await loadJsonMcpConfigs(ide(true), false);
    fs.writeFileSync(broken, good);
    expect(mcpServers).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
  });
});
