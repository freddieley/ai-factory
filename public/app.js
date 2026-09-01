var projectId = "";
var cycleId = "";
var running = false;
var jsonEvents = [];

function $(id) { return document.getElementById(id); }

function addMessage(role, text) {
  if (!text) return;
  var wrap = document.createElement("div");
  wrap.className = "message " + role;
  var bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  wrap.appendChild(bubble);
  $("messages").appendChild(wrap);
  $("messages").scrollTop = $("messages").scrollHeight;
}

function setStatus(text, working) {
  $("status").textContent = text;
  if (working) {
    var dots = document.createElement("span");
    dots.className = "typing";
    dots.innerHTML = "<i></i><i></i><i></i>";
    $("status").appendChild(dots);
  }
}

function renderJson() {
  $("json").textContent = jsonEvents.length ? JSON.stringify(jsonEvents, null, 2) : "Events will appear here as the cycle runs.";
}

function readError(response) {
  return response.json().then(function (payload) {
    return payload && payload.error ? payload.error : response.statusText;
  }).catch(function () { return response.statusText; });
}

function createProject() {
  return fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: $("name").value.trim(), description: $("description").value.trim() })
  }).then(function (response) {
    if (!response.ok) return readError(response).then(function (message) { addMessage("assistant", "I could not create the project: " + message); return null; });
    return response.json().then(function (project) {
      projectId = project.id;
      $("project-state").textContent = "Project ready: " + projectId.slice(0, 8);
      return project;
    });
  }).catch(function (error) {
    addMessage("assistant", "I could not create the project: " + error.message);
    return null;
  });
}

function sendMessage(event) {
  event.preventDefault();
  if (running) return;
  var text = $("prompt").value.trim();
  if (!text) return;

  var projectPromise = projectId ? Promise.resolve({ id: projectId }) : createProject();
  projectPromise.then(function (project) {
    if (!project) return;
    $("prompt").value = "";
    addMessage("user", text);
    running = true;
    $("send").disabled = true;
    setStatus("Working", true);

    var endpoint = cycleId ? "/api/cycles/" + encodeURIComponent(cycleId) + "/continue/stream" : "/api/factory/run/stream";
    var body = cycleId ? { message: text } : { projectId: projectId, objective: text, constraints: [], maxIterations: 2 };

    return fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(body)
    }).then(function (response) {
      if (!response.ok) return readError(response).then(function (message) { throw new Error(message); });
      jsonEvents = [];
      renderJson();
      return consumeSse(response);
    }).catch(function (error) {
      addMessage("assistant", "The cycle could not be completed. " + error.message);
      setStatus("Failed", false);
    }).then(function () {
      running = false;
      $("send").disabled = false;
      $("prompt").focus();
    });
  });
}

function consumeSse(response) {
  if (!response.body) return Promise.reject(new Error("Streaming is not available in this browser."));
  var reader = response.body.getReader();
  var decoder = new TextDecoder();
  var buffer = "";
  function readNext() {
    return reader.read().then(function (result) {
      if (result.done) {
        buffer += decoder.decode();
        if (buffer.trim()) handleSse(buffer);
        return;
      }
      buffer += decoder.decode(result.value, { stream: true });
      var frames = buffer.split("\n\n");
      buffer = frames.pop() || "";
      frames.forEach(handleSse);
      return readNext();
    });
  }
  return readNext();
}

function handleSse(frame) {
  var lines = frame.split("\n");
  var eventLine = lines.find(function (line) { return line.indexOf("event:") === 0; });
  var dataLine = lines.find(function (line) { return line.indexOf("data:") === 0; });
  if (!dataLine) return;
  var eventName = (eventLine || "event: message").slice(6).trim();
  var data;
  try { data = JSON.parse(dataLine.slice(5).trim()); } catch (_) { return; }

  if (eventName === "cycle") {
    cycleId = data.cycleId;
    $("cycle").textContent = "Cycle " + cycleId.slice(0, 8);
    return;
  }
  if (eventName === "json") {
    jsonEvents.push(data);
    renderJson();
    return;
  }
  if (eventName === "message") {
    addMessage(data.role === "user" ? "user" : "assistant", data.text);
    return;
  }
  if (eventName === "complete") {
    var status = data.result && data.result.status ? data.result.status : "finished";
    setStatus("Cycle " + status, false);
    loadPlan();
  }
}

function loadPlan() {
  if (!projectId) return Promise.resolve();
  return fetch("/api/projects/" + encodeURIComponent(projectId) + "/plan")
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (plan) { if (plan) $("plan").textContent = JSON.stringify(plan, null, 2); })
    .catch(function () {});
}

function newCycle() {
  cycleId = "";
  jsonEvents = [];
  renderJson();
  $("cycle").textContent = "No active cycle";
  $("messages").innerHTML = "";
  addMessage("assistant", "New cycle ready. What should we build or investigate?");
  setStatus("Ready", false);
  $("prompt").focus();
}

$("composer").addEventListener("submit", sendMessage);
$("create-project").addEventListener("click", createProject);
$("new-cycle").addEventListener("click", newCycle);
$("prompt").addEventListener("keydown", function (event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("composer").requestSubmit();
  }
});

fetch("/api/health").catch(function () { setStatus("Backend unavailable", false); });
