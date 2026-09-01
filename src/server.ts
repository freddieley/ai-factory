import { app } from "./api.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "./config.js";

export { app } from "./api.js";

const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));

async function readPublicFile(filename: string) {
  return readFile(`${publicRoot}${filename}`);
}

// Keep browser assets on explicit Fastify routes. The API module owns GET /.
// This avoids duplicate route registration while keeping /app.js and
// /styles.css isolated from API routing and HTML fallbacks.
app.get("/app.js", async (_request, reply) => {
  try {
    const content = await readPublicFile("app.js");
    return reply.type("application/javascript; charset=utf-8").header("cache-control", "no-store").send(content);
  } catch {
    return reply.code(404).send({ error: "asset not found" });
  }
});

app.get("/styles.css", async (_request, reply) => {
  try {
    const content = await readPublicFile("styles.css");
    return reply.type("text/css; charset=utf-8").header("cache-control", "no-store").send(content);
  } catch {
    return reply.code(404).send({ error: "asset not found" });
  }
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen({ port: config.PORT, host: config.HOST })
    .then(() => console.log(`AI Factory running at http://${config.HOST}:${config.PORT}`))
    .catch(error => {
      app.log.error(error);
      process.exit(1);
    });
}