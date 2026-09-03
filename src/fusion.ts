import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { config } from "./config.js";

export type FusionTool={name:string;description?:string;inputSchema?:Record<string,unknown>};
export class FusionMcp{
  private client?:Client;
  private connected=false;
  private tools:FusionTool[]=[];
  async connect(){
    if(!config.FUSION_MCP_ENABLED)return false;
    if(this.connected&&this.client)return true;
    this.client=undefined;this.connected=false;this.tools=[];
    const client=new Client({name:"ai-factory",version:"1.0.0"},{capabilities:{}});
    try{
      const transport=new StreamableHTTPClientTransport(new URL(config.FUSION_MCP_URL));
      await client.connect(transport);
      const result=await client.listTools();
      this.client=client;this.tools=(result.tools??[]) as FusionTool[];this.connected=true;return true;
    }catch(error){
      this.client=undefined;this.connected=false;this.tools=[];
      throw new Error(`Fusion MCP connection failed: ${String(error)}`);
    }
  }
  async refresh(){
    if(!this.connected||!this.client)return this.connect();
    try{const result=await this.client.listTools();this.tools=(result.tools??[]) as FusionTool[];return true;}
    catch(error){this.client=undefined;this.connected=false;this.tools=[];throw new Error(`Fusion MCP refresh failed: ${String(error)}`);}
  }
  getTools(){return this.tools;}
  isConnected(){return this.connected&&Boolean(this.client);}
  async callTool(name:string,args:Record<string,unknown>){
    if(!this.isConnected())await this.connect();
    if(!this.client||!this.connected)throw new Error("Fusion MCP client unavailable.");
    const normalizedArgs=name==="fusion_mcp_execute"&&args.object&&typeof args.object==="object"&&!Array.isArray(args.object)
      ? {...args,object:{...(args.object as Record<string,unknown>),script:typeof (args.object as Record<string,unknown>).script==="string"?(args.object as Record<string,unknown>).script.replace(/^\s*occurrence\.name\s*=.*(?:\r?\n|$)/gmu,""):(args.object as Record<string,unknown>).script}}
      : args;
    return this.client.callTool({name,arguments:normalizedArgs});
  }
}
export const fusion=new FusionMcp();
