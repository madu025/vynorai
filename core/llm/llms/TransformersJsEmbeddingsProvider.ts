import path from "path";

import { LLMOptions } from "../../index.js";
import { BaseLLM } from "../../llm/index.js";
// @ts-ignore
// prettier-ignore
import { type PipelineType } from "../../vendor/modules/@xenova/transformers/src/transformers.js";

class EmbeddingsPipeline {
  static task: PipelineType = "feature-extraction";
  static model = "all-MiniLM-L6-v2";
  static instance: any | null = null;
  private static initialization: Promise<any> | null = null;

  static async getInstance() {
    if (EmbeddingsPipeline.instance !== null) {
      return EmbeddingsPipeline.instance;
    }

    // A missing native backend is permanent for the lifetime of an extension
    // host. Retrying initialization for every retrieval request blocks the
    // host repeatedly and can leave an agent turn stuck. Keep both successful
    // and failed initialization outcomes so callers fail fast until reload.
    EmbeddingsPipeline.initialization ??= (async () => {
      // @ts-ignore
      // prettier-ignore
      const { env, pipeline } = await import("../../vendor/modules/@xenova/transformers/src/transformers.js");

      // If the native ONNX backend cannot load, onnxruntime falls back to
      // WebAssembly. Its multi-threaded mode starts workers from a blob: URL,
      // which Node's worker_threads rejects ("worker script or module filename
      // must be an absolute path"), so the fallback must run single-threaded.
      const wasmEnv = (env as any)?.backends?.onnx?.wasm;
      if (wasmEnv) {
        wasmEnv.numThreads = 1;
        wasmEnv.proxy = false;
      }

      env.allowLocalModels = true;
      env.allowRemoteModels = false;
      env.localModelPath = path.join(
        typeof __dirname === "undefined"
          ? // @ts-ignore
            path.dirname(new URL(import.meta.url).pathname)
          : __dirname,
        "..",
        "models",
      );

      EmbeddingsPipeline.instance = await pipeline(
        EmbeddingsPipeline.task,
        EmbeddingsPipeline.model,
      );
      return EmbeddingsPipeline.instance;
    })();

    return EmbeddingsPipeline.initialization;
  }
}

export class TransformersJsEmbeddingsProvider extends BaseLLM {
  static providerName = "transformers.js";
  static maxGroupSize: number = 1;
  static model: string = "all-MiniLM-L6-v2";
  static mockVector: number[] = Array.from({ length: 384 }).fill(2) as number[];

  static defaultOptions: Partial<LLMOptions> | undefined = {
    model: TransformersJsEmbeddingsProvider.model,
  };

  constructor() {
    super({
      model: TransformersJsEmbeddingsProvider.model,
      title: "Transformers.js (Built-In)",
    });
  }

  async embed(chunks: string[]) {
    // Workaround to ignore testing issues in Jest
    if (process.env.NODE_ENV === "test") {
      return chunks.map(() => TransformersJsEmbeddingsProvider.mockVector);
    }

    const extractor = await EmbeddingsPipeline.getInstance();

    if (!extractor) {
      throw new Error("TransformerJS embeddings pipeline is not initialized");
    }

    if (chunks.length === 0) {
      return [];
    }

    const outputs = [];
    for (
      let i = 0;
      i < chunks.length;
      i += TransformersJsEmbeddingsProvider.maxGroupSize
    ) {
      const chunkGroup = chunks.slice(
        i,
        i + TransformersJsEmbeddingsProvider.maxGroupSize,
      );
      const output = await extractor(chunkGroup, {
        pooling: "mean",
        normalize: true,
      });
      // To avoid causing the extension host to go unresponsive
      await new Promise((resolve) => setTimeout(resolve, 10));
      outputs.push(...output.tolist());
    }
    return outputs;
  }
}

export default TransformersJsEmbeddingsProvider;
