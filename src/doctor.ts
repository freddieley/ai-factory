import { config } from "./config.js";
import { providerInfo, getClient } from "./providers.js";
import { fusion } from "./fusion.js";
import { getSchemaVersion } from "./db.js";

async function main() {
  console.log("AI Factory doctor");
  console.log("-----------------");
  console.log("Provider:", providerInfo());
  console.log("Database schema version:", getSchemaVersion());

  if (config.AI_PROVIDER === "local") {
    try {
      const client = getClient();
      const models = await client.models.list();
      console.log("Local model endpoint: OK");
      console.log("Available models:", models.data.map(m => m.id).slice(0, 20));
    } catch (e) {
      console.error("Local model endpoint: FAILED");
      console.error(String(e));
    }
  } else {
    console.log("Fireworks configured:", Boolean(config.FIREWORKS_API_KEY));
  }

  if (!config.FUSION_MCP_ENABLED) {
    console.log("Fusion MCP: disabled");
    return;
  }

  try {
    await fusion.connect();
    console.log("Fusion MCP: OK");
    console.log("Tools:", fusion.getTools().map(t => t.name));
  } catch (e) {
    console.error("Fusion MCP: FAILED");
    console.error(String(e));
    console.log(`Expected endpoint: ${config.FUSION_MCP_URL}`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
