import fs from "node:fs";

import { IDE, ILLM } from "..";
import { CodeSnippetsCodebaseIndex } from "../indexing/CodeSnippetsIndex";
import { walkDirs } from "../indexing/walkDir";
import { pruneLinesFromTop } from "../llm/countTokens";

import { getRepoMapFilePath } from "./paths";
import { rankRepoFiles, summarizeTree } from "./repoMapRanking";
import { findUriInDirs } from "./uri";

// Same workspace, same map: repeated view_repo_map calls are instant and
// byte-identical (so they stay in the provider prefix cache).
const REPO_MAP_TTL_MS = 2 * 60_000;
const repoMapCache = new Map<string, { map: string; at: number }>();
// Bounds memory and time on very large repositories.
const MAX_MAPPED_FILES = 4000;
// Imports sit at the top of a file; this is plenty for the import graph.
const IMPORT_SCAN_CHARS = 20_000;

export interface RepoMapOptions {
  includeSignatures?: boolean;
  dirUris?: string[];
  outputRelativeUriPaths: boolean;
}

class RepoMapGenerator {
  private maxRepoMapTokens: number;

  private repoMapPath: string = getRepoMapFilePath();
  private writeStream: fs.WriteStream = fs.createWriteStream(this.repoMapPath);
  private contentTokens: number = 0;
  private dirs: string[] = [];
  private allUris: string[] = [];
  private pathsInDirsWithSnippets: Set<string> = new Set();

  private SNIPPETS_BATCH_SIZE = 100;
  private URI_BATCH_SIZE = 100;
  private REPO_MAX_CONTEXT_LENGTH_RATIO = 0.5;
  private REPO_MAX_TOKENS = 8_000;
  private PREAMBLE =
    "Below is a repository map. \n" +
    "Files are ordered by importance (how many other files import them), " +
    "each with the signatures of its classes, methods and functions. " +
    "Files that did not fit are summarized by folder at the end.\n\n";

  constructor(
    private llm: ILLM,
    private ide: IDE,
    private options: RepoMapOptions,
  ) {
    // A signature map past ~8k tokens costs more than the reads it saves.
    this.maxRepoMapTokens = Math.min(
      llm.contextLength * this.REPO_MAX_CONTEXT_LENGTH_RATIO,
      this.REPO_MAX_TOKENS,
    );
  }

  private getUriForWrite(uri: string) {
    if (this.options.outputRelativeUriPaths) {
      return findUriInDirs(uri, this.dirs).relativePathOrBasename;
    }
    return uri;
  }

  private relativePath(uri: string): string {
    return findUriInDirs(uri, this.dirs)
      .relativePathOrBasename.split("\\")
      .join("/");
  }

  async generate(): Promise<string> {
    this.dirs = this.options.dirUris ?? (await this.ide.getWorkspaceDirs());
    this.allUris = await walkDirs(
      this.ide,
      {
        source: "generate repo map",
      },
      this.dirs,
    );

    const cacheKey = JSON.stringify([
      this.dirs,
      this.options.includeSignatures ?? false,
      this.options.outputRelativeUriPaths,
      this.allUris.length,
      this.maxRepoMapTokens,
    ]);
    const cached = repoMapCache.get(cacheKey);
    if (cached && Date.now() - cached.at < REPO_MAP_TTL_MS) {
      this.writeStream.end(cached.map);
      return cached.map;
    }

    await this.writeToStream(this.PREAMBLE);

    if (this.options.includeSignatures) {
      // 1. Collect every file's signatures (and its imports, for ranking).
      const entries = new Map<
        string,
        { uri: string; signatures: string[]; content: string }
      >();
      const uris = this.allUris.slice(0, MAX_MAPPED_FILES);
      let snippetOffset = 0;
      let uriOffset = 0;
      while (true) {
        const { groupedByUri, hasMoreSnippets, hasMoreUris } =
          await CodeSnippetsCodebaseIndex.getPathsAndSignatures(
            uris,
            uriOffset,
            this.URI_BATCH_SIZE,
            snippetOffset,
            this.SNIPPETS_BATCH_SIZE,
          );
        for (const [uri, signatures] of Object.entries(groupedByUri)) {
          let fileContent: string;
          try {
            fileContent = await this.ide.readFile(uri);
          } catch (err) {
            console.error(
              "Failed to read file:\n" +
                `  Uri: ${uri}\n` +
                `  Error: ${err instanceof Error ? err.message : String(err)}`,
            );
            continue;
          }
          // A "signature" that is the whole file adds nothing over its name.
          const useful = signatures.filter(
            (signature) => signature.trim() !== fileContent.trim(),
          );
          if (useful.length === 0) continue;
          const path = this.relativePath(uri);
          const existing = entries.get(path);
          if (existing) existing.signatures.push(...useful);
          else
            entries.set(path, {
              uri,
              signatures: useful,
              content: fileContent.slice(0, IMPORT_SCAN_CHARS),
            });
        }
        if (hasMoreSnippets) {
          snippetOffset += this.SNIPPETS_BATCH_SIZE;
        } else if (hasMoreUris) {
          snippetOffset = 0;
          uriOffset += this.URI_BATCH_SIZE;
        } else {
          break;
        }
      }

      // 2. Most important files first, until 85% of the budget (the rest
      //    is kept for the folder outline).
      const ranked = rankRepoFiles(
        [...entries.entries()].map(([path, e]) => ({
          path,
          content: e.content,
          signatureCount: e.signatures.length,
        })),
      );
      const sectionBudget = this.maxRepoMapTokens * 0.85;
      const leftovers: string[] = [];
      for (const path of ranked) {
        const e = entries.get(path)!;
        let content = `${this.getUriForWrite(e.uri)}:\n`;
        for (const signature of e.signatures.slice(0, -1)) {
          content += `${this.indentMultilineString(signature)}\n\t...\n`;
        }
        content += `${this.indentMultilineString(e.signatures[e.signatures.length - 1])}\n\n`;
        if (
          leftovers.length > 0 ||
          this.contentTokens + this.llm.countTokens(content) > sectionBudget
        ) {
          leftovers.push(path);
          continue;
        }
        this.pathsInDirsWithSnippets.add(e.uri);
        await this.writeToStream(content);
      }

      // 3. Everything else as a folder outline, so the agent still sees the
      //    shape of the whole repository.
      const others = [
        ...leftovers,
        ...this.allUris
          .filter((uri) => !this.pathsInDirsWithSnippets.has(uri))
          .map((uri) => this.relativePath(uri))
          .filter((path) => !entries.has(path)),
      ];
      if (others.length > 0) {
        await this.writeToStream(
          `Other files, by folder (${others.length}):\n${summarizeTree(others)}\n`,
        );
      }
    } else {
      // Only process uris
      await this.writeToStream(
        this.allUris.map((uri) => this.getUriForWrite(uri)).join("\n"),
      );
    }

    this.writeStream.end();

    if (this.contentTokens >= this.maxRepoMapTokens) {
      console.debug(
        "Full repo map was unable to be generated due to context window limitations",
      );
    }

    const map = fs.readFileSync(this.repoMapPath, "utf8");
    repoMapCache.set(cacheKey, { map, at: Date.now() });
    return map;
  }

  private async writeToStream(content: string): Promise<void> {
    const tokens = this.llm.countTokens(content);

    if (this.contentTokens + tokens > this.maxRepoMapTokens) {
      content = pruneLinesFromTop(
        content,
        this.maxRepoMapTokens - this.contentTokens,
        this.llm.model,
      );
    }

    this.contentTokens += this.llm.countTokens(content);

    await new Promise((resolve) => this.writeStream.write(content, resolve));
  }

  private indentMultilineString(str: string) {
    return str
      .split("\n")
      .map((line: any) => "\t" + line)
      .join("\n");
  }
}

export default async function generateRepoMap(
  llm: ILLM,
  ide: IDE,
  options: RepoMapOptions,
): Promise<string> {
  const generator = new RepoMapGenerator(llm, ide, options);
  return generator.generate();
}
