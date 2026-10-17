import type { ChatTool } from '@client-agent/ai';
import { defaultToolDefinitions } from './definitions';
import type { AgentToolContext, AgentToolDefinition, ToolExecutionResult } from './types';

export class ToolRegistry {
  private tools = new Map<string, AgentToolDefinition>();
  private context: AgentToolContext;

  constructor(context: AgentToolContext) {
    this.context = context;
  }

  register(tool: AgentToolDefinition): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  getTool(name: string): AgentToolDefinition | undefined {
    return this.tools.get(name);
  }

  listTools(): AgentToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getToolSpecs(): ChatTool[] {
    return Array.from(this.tools.values()).map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  async execute(name: string, rawInput: unknown): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const tool = this.tools.get(name);

    if (!tool) {
      return {
        toolName: name,
        success: false,
        error: `Tool ${name} not found in registry`,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      const parsed = tool.schema.safeParse(rawInput);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
        return {
          toolName: name,
          success: false,
          error: `Validation error: ${issues}`,
          durationMs: Date.now() - startTime,
        };
      }

      const data = await tool.execute(parsed.data, this.context);
      return {
        toolName: name,
        success: true,
        data,
        durationMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        toolName: name,
        success: false,
        error: err.message || 'Unknown tool execution error',
        durationMs: Date.now() - startTime,
      };
    }
  }
}

export function createDefaultToolRegistry(context: AgentToolContext): ToolRegistry {
  const registry = new ToolRegistry(context);
  for (const tool of defaultToolDefinitions) {
    registry.register(tool);
  }
  return registry;
}
