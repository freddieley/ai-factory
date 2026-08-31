import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { config } from "./config.js";

export type FusionTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export class FusionMcp {
  private client?: Client;
  private connected = false;
  private tools: FusionTool[] = [];

  async connect() {
    if (!config.FUSION_MCP_ENABLED) return false;
    if (this.connected) return true;

    this.client = new Client(
      { name: "ai-factory", version: "1.0.0" },
      { capabilities: {} }
    );

    const transport = new StreamableHTTPClientTransport(new URL(config.FUSION_MCP_URL));
    await this.client.connect(transport);
    const result = await this.client.listTools();
    this.tools = (result.tools ?? []) as FusionTool[];
    this.connected = true;
    return true;
  }

  async refresh() {
    if (!this.client) return this.connect();
    const result = await this.client.listTools();
    this.tools = (result.tools ?? []) as FusionTool[];
    return true;
  }

  getTools() {
    return this.tools;
  }

  isConnected() {
    return this.connected;
  }

  async callTool(name: string, args: Record<string, unknown>) {
    if (!this.client) await this.connect();
    if (!this.client) throw new Error("Fusion MCP client unavailable.");
    return this.client.callTool({ name, arguments: args });
  }
}

export const fusion = new FusionMcp();
