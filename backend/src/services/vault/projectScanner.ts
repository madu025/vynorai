import { ProjectContext } from "./types.js";

/**
 * Project Context Scanner
 * Inspects package.json, tsconfig.json, prisma/schema.prisma, .env, and requirements.txt
 * to adapt templates deterministically to the user's codebase.
 */
export function scanProjectFiles(
  files: { path: string; content: string }[]
): ProjectContext {
  const context: ProjectContext = {
    framework: undefined,
    frameworkVersion: undefined,
    nodeVersion: undefined,
    language: "javascript",
    orm: "none",
    database: "sqlite",
    installedDependencies: {},
    existingEnvKeys: [],
    hasPrismaSchema: false,
  };

  for (const f of files) {
    const p = f.path.toLowerCase();

    // 1. package.json analysis
    if (p.endsWith("package.json")) {
      try {
        const pkg = JSON.parse(f.content);
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        context.installedDependencies = deps;

        if (deps["next"]) {
          context.framework = "nextjs";
          context.frameworkVersion = deps["next"].replace(/[\^~]/g, "");
        } else if (deps["express"]) {
          context.framework = "express";
          context.frameworkVersion = deps["express"].replace(/[\^~]/g, "");
        } else if (deps["fastify"]) {
          context.framework = "fastify";
          context.frameworkVersion = deps["fastify"].replace(/[\^~]/g, "");
        }

        if (deps["typescript"] || files.some((fl) => fl.path.endsWith("tsconfig.json"))) {
          context.language = "typescript";
        }

        if (deps["@prisma/client"] || deps["prisma"]) {
          context.orm = "prisma";
        } else if (deps["drizzle-orm"]) {
          context.orm = "drizzle";
        } else if (deps["typeorm"]) {
          context.orm = "typeorm";
        }

        if (deps["pg"] || deps["postgres"]) context.database = "postgresql";
        else if (deps["mysql2"]) context.database = "mysql";
        else if (deps["better-sqlite3"] || deps["sqlite3"]) context.database = "sqlite";
        else if (deps["mongoose"] || deps["mongodb"]) context.database = "mongodb";

        if (pkg.engines?.node) {
          context.nodeVersion = pkg.engines.node.replace(/[\^~>=]/g, "").trim();
        }
      } catch {
        // malformed package.json
      }
    }

    // 2. Python requirements.txt / pyproject.toml
    if (p.endsWith("requirements.txt") || p.endsWith("pyproject.toml")) {
      context.language = "python";
      if (f.content.includes("fastapi")) context.framework = "fastapi";
      else if (f.content.includes("django")) context.framework = "django";
      else if (f.content.includes("flask")) context.framework = "flask";
    }

    // 3. Prisma Schema analysis
    if (p.includes("schema.prisma")) {
      context.hasPrismaSchema = true;
      context.orm = "prisma";
      if (f.content.includes('provider = "postgresql"')) context.database = "postgresql";
      else if (f.content.includes('provider = "mysql"')) context.database = "mysql";
      else if (f.content.includes('provider = "sqlite"')) context.database = "sqlite";
    }

    // 4. .env or .env.example extraction
    if (p.endsWith(".env") || p.endsWith(".env.example")) {
      const lines = f.content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
          const key = trimmed.split("=")[0].trim();
          if (key && !context.existingEnvKeys?.includes(key)) {
            context.existingEnvKeys?.push(key);
          }
        }
      }
    }
  }

  return context;
}
