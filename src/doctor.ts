import { config } from "./config.js";
import { providerInfo,getClient } from "./providers.js";
import { fusion } from "./fusion.js";
import { getSchemaVersion } from "./db.js";
import { toOpenAITools } from "./capabilities.js";
async function main(){
 console.log("AI Factory doctor");console.log("-----------------");console.log("Provider:",providerInfo());console.log("Database schema version:",getSchemaVersion());
 try{const client=getClient();const models=await client.models.list();console.log("Model endpoint: OK");console.log("Available models:",models.data.map(m=>m.id).slice(0,20));const response=await client.chat.completions.create({model:providerInfo().model,temperature:0,messages:[{role:"user",content:"Reply with exactly OK."}]});console.log("Chat completion: OK",response.choices[0]?.message?.content??"<empty>");if(config.AI_PROVIDER==="local"){const toolProbe=await client.chat.completions.create({model:providerInfo().model,temperature:0,messages:[{role:"user",content:"Do not execute anything. If you can use a function tool, call ai_factory_plan_parametric_box with name Test and dimensions 10, 10, 10."}],tools:toOpenAITools({fusionAvailable:false}),tool_choice:"auto"});console.log("Tool-call interface: OK",Boolean(toolProbe.choices[0]?.message?.tool_calls));}}catch(error){console.error("Model endpoint/chat: FAILED");console.error(String(error));}
 if(!config.FUSION_MCP_ENABLED){console.log("Fusion MCP: disabled");return;}
 try{await fusion.connect();console.log("Fusion MCP: OK");console.log("Tools:",fusion.getTools().map(t=>t.name));}catch(error){console.error("Fusion MCP: FAILED");console.error(String(error));console.log(`Expected endpoint: ${config.FUSION_MCP_URL}`);}
}
main().catch(error=>{console.error(error);process.exit(1);});
