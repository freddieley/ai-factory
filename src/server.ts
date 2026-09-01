import Fastify from "fastify";
import { config } from "./config.js";
import { createProject, getProject, getRun, listEvents, listProjects, listApprovals } from "./db.js";
import { providerInfo } from "./providers.js";
import { fusion } from "./fusion.js";
import { runAgent } from "./agent.js";
import { listCapabilities } from "./capabilities.js";

const app = Fastify({ logger: true });

app.get("/api/health", async () => ({
  ok: true,
  provider: providerInfo(),
  execution: {
    maxModelCalls: config.MAX_MODEL_CALLS,
    maxToolCalls: config.MAX_TOOL_CALLS,
    maxRunMs: config.MAX_RUN_MS,
    modelTimeoutMs: config.MODEL_TIMEOUT_MS,
    toolTimeoutMs: config.TOOL_TIMEOUT_MS
  },
  factory: {
    deterministicCapabilities: listCapabilities().map(({ name, domain, description }) => ({ name, domain, description })),
    domains: [...new Set(listCapabilities().map(capability => capability.domain))]
  },
  fusion: {
    enabled: config.FUSION_MCP_ENABLED,
    connected: fusion.isConnected(),
    tools: fusion.getTools().map(t => t.name)
  }
}));
app.get("/api/capabilities", async (request) => {
  const { domain } = request.query as { domain?: string };
  const capabilities = domain ? listCapabilities(domain as Parameters<typeof listCapabilities>[0]) : listCapabilities();
  return capabilities.map(({ name, domain: capabilityDomain, description, parameters }) => ({ name, domain: capabilityDomain, description, parameters }));
});
app.get("/api/projects", async () => listProjects());
app.post("/api/projects", async (request, reply) => {
  const body = request.body as { name?: string; description?: string };
  if (!body?.name) return reply.code(400).send({ error: "name is required" });
  return createProject(body.name, body.description ?? "");
});
app.get("/api/projects/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const project = getProject(id);
  if (!project) return reply.code(404).send({ error: "project not found" });
  return project;
});
app.get("/api/approvals", async (request) => {
  const { projectId } = request.query as { projectId?: string };
  return listApprovals(projectId);
});
app.post("/api/agent/run", async (request, reply) => {
  const body = request.body as { projectId?: string; prompt?: string };
  if (!body?.projectId || !body?.prompt) return reply.code(400).send({ error: "projectId and prompt are required" });
  return runAgent(body.projectId, body.prompt);
});
app.get("/api/runs/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const run = getRun(id);
  if (!run) return reply.code(404).send({ error: "run not found" });
  return run;
});
app.get("/api/runs/:id/events", async (request, reply) => {
  const { id } = request.params as { id: string };
  const run = getRun(id);
  if (!run) return reply.code(404).send({ error: "run not found" });
  return listEvents(id);
});

app.get("/", async (_request, reply) => reply.type("text/html").send(INDEX_HTML));
app.listen({ port: config.PORT, host: config.HOST }).then(() => console.log(`AI Factory running at http://${config.HOST}:${config.PORT}`)).catch((error) => { app.log.error(error); process.exit(1); });

const INDEX_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Factory</title><style>body{font-family:Inter,system-ui,sans-serif;background:#0b0d10;color:#e9edf2;margin:0}main{max-width:1000px;margin:0 auto;padding:32px}.card{background:#13171c;border:1px solid #28303a;border-radius:14px;padding:20px;margin:16px 0}input,textarea,button{font:inherit;border-radius:9px;border:1px solid #303943;padding:10px;background:#0e1115;color:#fff}input,textarea{width:100%;box-sizing:border-box;margin:7px 0 12px}button{cursor:pointer;background:#e9edf2;color:#111;border:0;font-weight:700}pre{white-space:pre-wrap;background:#090b0e;padding:14px;border-radius:9px;overflow:auto}.ok{font-weight:700}</style></head><body><main><h1>AI Factory <span class="ok">Fast Execution</span></h1><p>Local-first engineering control plane with bounded, observable agent runs.</p><div class="card"><h2>System</h2><pre id="health">Loading…</pre></div><div class="card"><h2>Project</h2><input id="name" value="Robotics Lab"><textarea id="description" rows="3">Civilian robotics engineering workspace.</textarea><button onclick="createProject()">Create project</button><pre id="project"></pre></div><div class="card"><h2>Engineering agent</h2><textarea id="prompt" rows="7">Create a 50 mm × 50 mm × 5 mm rectangular plate in a new Fusion design. Verify that one solid body exists and that its bounding dimensions are approximately 50 × 50 × 5 mm. Do not manufacture or export anything.</textarea><button onclick="runAgent()">Run agent</button><pre id="output"></pre></div></main><script>let projectId="";async function load(){const h=await fetch("/api/health").then(r=>r.json());document.querySelector("#health").textContent=JSON.stringify(h,null,2)}async function createProject(){const body={name:document.querySelector("#name").value,description:document.querySelector("#description").value};const p=await fetch("/api/projects",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}).then(r=>r.json());projectId=p.id;document.querySelector("#project").textContent=JSON.stringify(p,null,2)}async function runAgent(){if(!projectId)await createProject();document.querySelector("#output").textContent="Running…";const r=await fetch("/api/agent/run",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({projectId,prompt:document.querySelector("#prompt").value})}).then(r=>r.json());document.querySelector("#output").textContent=JSON.stringify(r,null,2);if(r.runId){const events=await fetch("/api/runs/"+r.runId+"/events").then(x=>x.json());document.querySelector("#output").textContent+="\\n\\nEVENTS\\n"+JSON.stringify(events,null,2)}load()}load();</script></body></html>`;
