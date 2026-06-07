import { ESRGraph } from "../../core/graph";
import { ESRRuntimeStateStore } from "../state";
import type { ExecutionResult } from "../runtime-types";

export interface ToolExecutionContext {
  graph: ESRGraph;
  store: ESRRuntimeStateStore;
}

export type ToolExecutionHandler = (
  params: Record<string, unknown>,
  context: ToolExecutionContext,
) => ExecutionResult | Promise<ExecutionResult>;

/**
 * Registry of runtime tool execution handlers.
 *
 * Each handler receives the tool's params and a context
 * containing the ESRGraph and ESRRuntimeStateStore for direct mutation.
 */
export class ToolDriverRegistry {
  private handlers = new Map<string, ToolExecutionHandler>();

  /** Register a handler for a tool name. */
  register(toolName: string, handler: ToolExecutionHandler): void {
    this.handlers.set(toolName, handler);
  }

  /** Execute a registered tool handler. Returns failed if not registered. */
  async run(toolName: string, params: Record<string, unknown>, context: ToolExecutionContext): Promise<ExecutionResult> {
    const handler = this.handlers.get(toolName);
    if (!handler) {
      return { status: "failed", error: `No runtime handler registered for tool: ${toolName}` };
    }
    return handler(params, context);
  }
}
