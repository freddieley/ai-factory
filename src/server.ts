import { app } from "./api.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "./config.js";

export { app } from "./api.js";

const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));

async function readPublicFile(filename: string) {
  return readFile(`${publicRoot}${filename}`);
}

// Keep the browser application on explicit Fastify routes rather than a global
// request hook. This makes the static asset contract unambiguous and prevents
// an HTML fallback from ever being returned for /app.js.
app.get("/", async (_request, reply) => {
  try {
    const content = await readPublicFile("index.html");
    return reply.type("text/html; charset=utf-8").header("cache-control", "no-store").send(content);
  } catch {
    return reply.code(404).send({ error: "asset not found" });
  }
});

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