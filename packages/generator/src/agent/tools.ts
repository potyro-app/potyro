// What the agent can DO, as opposed to what it can say.
//
// The fixing agent's core problem is that it cannot see the app it is editing: it gets a source
// file and a sentence, guesses, and reports success. Tools are the fix — it can replay what the
// user did, look at the resolved app, and check the shape of the data before proposing anything.
//
// Every failure here comes back as a RESULT, never as a thrown error. A hallucinated tool name or
// a tool that throws is information the model can act on; an exception ends the loop and puts us
// back to guessing.

/** The JSON-Schema-shaped description a model needs to call a tool. */
export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ToolCall {
  /** Correlates a result back to the call the model made. */
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  ok: boolean;
  /** What happened, in words the model (and a person reading the transcript) can use. */
  detail: string;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<{ ok: boolean; detail: string }>;
}

export function toolSpecs(tools: AgentTool[]): ToolSpec[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export async function runTool(tools: AgentTool[], call: ToolCall): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) {
    const known = tools.map((t) => t.name).join(", ");
    return { id: call.id, name: call.name, ok: false, detail: `unknown tool "${call.name}" — you can call: ${known}` };
  }
  try {
    const { ok, detail } = await tool.run(call.args);
    return { id: call.id, name: call.name, ok, detail };
  } catch (e) {
    return { id: call.id, name: call.name, ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
