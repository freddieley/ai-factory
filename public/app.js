let projectId = "";
let cycleId = "";
let running = false;
let jsonEvents = [];

const $ = id => document.getElementById(id);

function addMessage(role, text) {
  if (!text) return;
  const wrap = document.createElement("div");
  wrap.className = `message ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  wrap.appendChild(bubble);
  $("messages").appendChild(wrap);
  $("messages").scrollTop = $("messages").scrollHeight;
}

function setStatus(text, working = false) {
  $("status").textContent = "";
  const label = document.createElement("span");
  label.textContent = text;
  $("status").appendChild(label);
  if (working) {
    const dots = document.createElement("span");
    dots.className = "typing";
    dots.innerHTML = "<i></i><i></i><i></i>";
    $("status").appendChild(dots);
  }
}

function renderJson() {
  $("json").textContent = jsonEvents.length
    ? JSON.stringify(jsonEvents, null, 2)
    : "Events will appear here as the cycle runs.";
}

async function createProject() {
  const response = await fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: $("name").value.trim(),
      description: $("description").value.trim()
    })
  });
  const project = await response.json();
  if (!response.ok || project.error) {
    addMessage("assistant", `I couldn't create the project: ${project.error || response.statusText}`);
    return null;
  }
  projectId = project.id;
  $("project-state").textContent = `Project ready: ${projectId.slice(0, 8)}`;
  return project;
}

async function sendMessage(event) {
  event.preventDefault();
  if (running) return;
  const text = $("prompt").value.trim();
  if (!text) return;

  if (!projectId && !(await createProject())) return;

  $("prompt").value = "";
  addMessage("user", text);
  running = true;
  $("send").disabled = true;
  setStatus("Working", true);

  try {
    const endpoint = cycleId
      ? `/api/cycles/${encodeURIComponent(cycleId)}/continue/stream`
      : "/api/factory/run/stream";
    const body = cycleId
      ? { message: text }
      : { projectId, objective: text, constraints: [], maxIterations: 2 };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      let message = response.statusText;
      try {
        const payload = await response.json();
        message = payload.error || message;
      } catch {}
      throw new Error(message);
    }

    jsonEvents = [];
    renderJson();
    await consumeSse(response);
  } catch (error) {
    addMessage("assistant", `The cycle could not be completed. ${error.message}`);
    setStatus("Failed");
  } finally {
    running = false;
    $("send").disabled = false;
    $("prompt").focus();
  }
}

async function consumeSse(response) {
  if (!response.body) throw new Error("Streaming is not available in this browser.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() || "";
    for (const frame of frames) handleSse(frame);
  }

  buffer += decoder.decode();
  if (buffer.trim()) handleSse(buffer);
}

function handleSse(frame) {
  const lines = frame.split("\n");
  const eventLine = lines.find(line => line.startsWith("event:"));
  const dataLine = lines.find(line => line.startsWith("data:"));
  if (!dataLine) return;

  const event = (eventLine || "event: message").slice(6).trim();
  let data;
  try {
    data = JSON.parse(dataLine.slice(5).trim());
  } catch {
    return;
  }

  if (event === "cycle") {
    cycleId = data.cycleId;
    $("cycle").textContent = `Cycle ${cycleId.slice(0, 8)}`;
    return;
  }

  if (event === "json") {
    jsonEvents.push(data);
    renderJson();
    return;
  }

  if (event === "message") {
    addMessage(data.role === "user" ? "user" : "assistant", data.text);
    return;
  }

  if (event === "complete") {
    const status = data.result?.status || "finished";
    setStatus(`Cycle ${status}`);
    loadPlan();
  }
}

async function loadPlan() {
  if (!projectId) return;
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/plan`).catch(() => null);
  if (!response?.ok) return;
  const plan = await response.json();
  $("plan").textContent = JSON.stringify(plan, null, 2);
}

function newCycle() {
  cycleId = "";
  jsonEvents = [];
  renderJson();
  $("cycle").textContent = "No active cycle";
  $("messages").innerHTML = "";
  addMessage("assistant", "New cycle ready. What should we build or investigate?");
  setStatus("Ready");
  $("prompt").focus();
}

$("composer").addEventListener("submit", sendMessage);
$("create-project").addEventListener("click", createProject);
$("new-cycle").addEventListener("click", newCycle);
$("prompt").addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("composer").requestSubmit();
  }
});

fetch("/api/health").catch(() => setStatus("Backend unavailable"));
