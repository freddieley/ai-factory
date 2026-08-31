import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

mkdirSync(dirname(config.DATABASE_PATH), { recursive: true });

export const db = new Database(config.DATABASE_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  output TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
`);

export function createProject(name: string, description: string) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO projects (id,name,description,created_at) VALUES (?,?,?,?)`
  ).run(id, name, description, new Date().toISOString());
  return getProject(id);
}

export function getProject(id: string) {
  return db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id);
}

export function listProjects() {
  return db.prepare(`SELECT * FROM projects ORDER BY created_at DESC`).all();
}

export function createRun(projectId: string, prompt: string, provider: string, model: string) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO runs (id,project_id,prompt,provider,model,status,created_at) VALUES (?,?,?,?,?,?,?)`
  ).run(id, projectId, prompt, provider, model, "running", new Date().toISOString());
  return id;
}

export function finishRun(id: string, status: string, output: string) {
  db.prepare(
    `UPDATE runs SET status=?, output=?, completed_at=? WHERE id=?`
  ).run(status, output, new Date().toISOString(), id);
}

export function addEvent(runId: string, type: string, payload: unknown) {
  db.prepare(
    `INSERT INTO events (id,run_id,type,payload,created_at) VALUES (?,?,?,?,?)`
  ).run(randomUUID(), runId, type, JSON.stringify(payload), new Date().toISOString());
}

export function requestApproval(projectId: string, action: string, payload: unknown) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO approvals (id,project_id,action,payload,created_at) VALUES (?,?,?,?,?)`
  ).run(id, projectId, action, JSON.stringify(payload), new Date().toISOString());
  return id;
}

export function listApprovals(projectId?: string) {
  if (projectId) {
    return db.prepare(`SELECT * FROM approvals WHERE project_id=? ORDER BY created_at DESC`).all(projectId);
  }
  return db.prepare(`SELECT * FROM approvals ORDER BY created_at DESC`).all();
}
