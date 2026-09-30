import { GoldenTemplate, Dependency, EnvVariable, TemplateFile } from "./types.js";

export interface ComposedPackage {
  rootTemplateId: string;
  chain: string[]; // Order of installation
  dependencies: Dependency[];
  envVariables: EnvVariable[];
  files: TemplateFile[];
  securityChecklist: string[];
}

/**
 * Template Composition Engine
 * Recursively resolves a template's dependency graph (DAG) into an ordered installation pipeline.
 * E.g. "PayHere Subscription" -> Auth + DB User Model + Rate Limiter + PayHere Gateway
 */
export function composeTemplatePipeline(
  rootTemplateId: string,
  vaultTemplates: GoldenTemplate[]
): ComposedPackage {
  const visited = new Set<string>();
  const resolutionOrder: string[] = [];

  function resolveDependencies(templateId: string) {
    if (visited.has(templateId)) return;
    visited.add(templateId);

    const t = vaultTemplates.find((item) => item.id === templateId);
    if (!t) return;

    // Resolve prerequisites first
    if (t.requires && Array.isArray(t.requires)) {
      for (const reqId of t.requires) {
        resolveDependencies(reqId);
      }
    }

    resolutionOrder.push(templateId);
  }

  resolveDependencies(rootTemplateId);

  // Aggregate dependencies, envs, files, and security rules
  const allDeps: Record<string, Dependency> = {};
  const allEnvs: Record<string, EnvVariable> = {};
  const allFiles: TemplateFile[] = [];
  const securityChecklist: string[] = [];

  for (const tid of resolutionOrder) {
    const t = vaultTemplates.find((item) => item.id === tid);
    if (!t) continue;

    // Collect dependencies
    for (const d of t.dependencies || []) {
      const depObj: Dependency = typeof d === "string" ? { name: d, version: "^1.0.0" } : d;
      allDeps[depObj.name] = depObj;
    }

    // Collect environment variables
    for (const e of t.envVariables || []) {
      allEnvs[e.name] = e;
    }

    // Collect files
    if (t.files && t.files.length > 0) {
      allFiles.push(...t.files);
    } else {
      allFiles.push({
        path: `src/services/${t.id.replace(/-/g, "_")}.ts`,
        description: t.title,
        content: t.code,
        operation: "CREATE",
      });
    }

    // Collect security rules
    if (t.security) {
      for (const s of t.security) {
        securityChecklist.push(`[${t.id}] ${s.description}`);
      }
    }
  }

  return {
    rootTemplateId,
    chain: resolutionOrder,
    dependencies: Object.values(allDeps),
    envVariables: Object.values(allEnvs),
    files: allFiles,
    securityChecklist,
  };
}
