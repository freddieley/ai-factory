import { app } from "./api.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "./config.js";

const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));

async function sendPublicFile(reply: any, filename: string, contentType: string) {
  try {
    const content = await readFile(`${publicRoot}${filename}`);
    return reply.type(contentType).send(content);
  } catch {
    return reply.code(404).send({ error: "asset not found" });
  }
}

app.addHook("onRequest", async (request, reply) => {
  if (request.url === "/") return sendPublicFile(reply, "index.html", "text/html; charset=utf-8");
  if (request.url === "/app.js") return sendPublicFile(reply, "app.js", "application/javascript; charset=utf-8");
  if (request.url === "/styles.css") return sendPublicFile(reply, "styles.css", "text/css; charset=utf-8");
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen({ port: config.PORT, host: config.HOST })
    .then(() => console.log(`AI Factory running at http://${config.HOST}:${config.PORT}`))
    .catch(error => {
      app.log.error(error);
      process.exit(1);
    });
}
