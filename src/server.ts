import { app } from "./api.js";
import { registerDesignSpaceRoutes } from "./design-space-routes.js";
import { registerElectronicsRoutes } from "./electronics-routes.js";
import { registerElectronicsSelectionRoutes } from "./electronics-selection-routes.js";
import { registerElectronicsAnalysisRoutes } from "./electronics-analysis-routes.js";
import { registerKiCadRoutes } from "./kicad-routes.js";
import { registerFirmwareRoutes } from "./firmware-routes.js";
import { registerRobotDesignRoutes } from "./robot-design-routes.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "./config.js";
export { app } from "./api.js";
registerDesignSpaceRoutes(app);
registerElectronicsRoutes(app);
registerElectronicsSelectionRoutes(app);
registerElectronicsAnalysisRoutes(app);
registerKiCadRoutes(app);
registerFirmwareRoutes(app);
registerRobotDesignRoutes(app);
const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));
async function readPublicFile(filename: string) { return readFile(`${publicRoot}${filename}`); }
app.get("/", async (_request, reply) => { try { const content = await readPublicFile("index.html"); return reply.type("text/html; charset=utf-8").header("cache-control", "no-store").send(content); } catch { return reply.code(404).send({ error: "operator console not found" }); } });
app.get("/app.js", async (_request, reply) => { try { const content = await readPublicFile("app.js"); return reply.type("application/javascript; charset=utf-8").header("cache-control", "no-store").send(content); } catch { return reply.code(404).send({ error: "asset not found" }); } });
app.get("/styles.css", async (_request, reply) => { try { const content = await readPublicFile("styles.css"); return reply.type("text/css; charset=utf-8").header("cache-control", "no-store").send(content); } catch { return reply.code(404).send({ error: "asset not found" }); } });
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { app.listen({ port: config.PORT, host: config.HOST }).then(() => console.log(`AI Factory running at http://${config.HOST}:${config.PORT}`)).catch(error => { app.log.error(error); process.exit(1); }); }
