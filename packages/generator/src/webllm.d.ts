// Minimal ambient declaration for the browser-only WebLLM runtime, so the edge backend's lazy
// `import("@mlc-ai/web-llm")` type-checks without pulling the (large, WebGPU-only) package into the
// Node test/build graph. The real module is provided by the shell bundle at runtime.
declare module "@mlc-ai/web-llm" {
  export interface MLCEngine {
    chat: {
      completions: {
        create(req: {
          messages: Array<{ role: string; content: string }>;
          temperature?: number;
          max_tokens?: number;
        }): Promise<{ choices: Array<{ message: { content: string } }> }>;
      };
    };
  }
  export function CreateMLCEngine(model: string, opts?: unknown): Promise<MLCEngine>;
}
