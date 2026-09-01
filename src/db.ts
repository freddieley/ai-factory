import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

mkdirSync(dirname(config.DATABASE_PATH), { recursive: true });

export const db = new Database(config.DATABASE_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

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
CREATE TABLE IF NOT EXISTS requirements (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_id TEXT,
  parent_artifact_id TEXT,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  uri TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requirements_project ON requirements(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_artifacts_project ON artifacts(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_artifacts_parent ON artifacts(parent_artifact_id);
CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, created_at);
`);

function tableColumns(table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name));
}

function addColumnIfMissing(table: string, column: string, definition: string) {
  if (!tableColumns(table).has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// Upgrade databases created by older factory builds in-place. The defaults
// make the migration safe for existing rows while new writes always provide
// real timestamps and structured values.
addColumnIfMissing("requirements", "source", "TEXT NOT NULL DEFAULT 'unknown'");
addColumnIfMissing("requirements", "key", "TEXT NOT NULL DEFAULT 'unspecified'");
addColumnIfMissing("requirements", "value", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("requirements", "status", "TEXT NOT NULL DEFAULT 'active'");
addColumnIfMissing("requirements", "created_at", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("requirements", "updated_at", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("artifacts", "run_id", "TEXT");
addColumnIfMissing("artifacts", "parent_artifact_id", "TEXT");
addColumnIfMissing("artifacts", "kind", "TEXT NOT NULL DEFAULT 'unknown'");
addColumnIfMissing("artifacts", "name", "TEXT NOT NULL DEFAULT 'artifact'");
addColumnIfMissing("artifacts", "uri", "TEXT");
addColumnIfMissing("artifacts", "metadata", "TEXT NOT NULL DEFAULT '{}'");
addColumnIfMissing("artifacts", "created_at", "TEXT NOT NULL DEFAULT ''");

const migrationNow = new Date().toISOString();
db.prepare(`UPDATE requirements SET created_at=? WHERE created_at=''`).run(migrationNow);
db.prepare(`UPDATE requirements SET updated_at=created_at WHERE updated_at=''`).run();
db.prepare(`UPDATE artifacts SET created_at=? WHERE created_at=''`).run(migrationNow);

export function createProject(name: string, description: string) {
  const id = randomUUID();
  db.prepare(`INSERT INTO projects (id,name,description,created_at) VALUES (?,?,?,?)`).run(id, name, description, new Date().toISOString());
  return getProject(id);
}
export function getProject(id: string) { return db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id); }
export function listProjects() { return db.prepare(`SELECT * FROM projects ORDER BY created_at DESC`).all(); }

export function createRun(projectId: string, prompt: string, provider: string, model: string) {
  const id = randomUUID();
  db.prepare(`INSERT INTO runs (id,project_id,prompt,provider,model,status,created_at) VALUES (?,?,?,?,?,?,?)`).run(id, projectId, prompt, provider, model, "running", new Date().toISOString());
  return id;
}
export function finishRun(id: string, status: string, output: string) {
  db.prepare(`UPDATE runs SET status=?, output=?, completed_at=? WHERE id=?`).run(status, output, new Date().toISOString(), id);
}
export function addEvent(runId: string, type: string, payload: unknown) {
  db.prepare(`INSERT INTO events (id,run_id,type,payload,created_at) VALUES (?,?,?,?,?)`).run(randomUUID(), runId, type, JSON.stringify(payload), new Date().toISOString());
}
export function listEvents(runId: string) {
  return db.prepare(`SELECT id,run_id,type,payload,created_at FROM events WHERE run_id=? ORDER BY created_at ASC`).all(runId);
}
export function getRun(id: string) { return db.prepare(`SELECT * FROM runs WHERE id=?`).get(id); }

export function createRequirement(projectId: string, source: string, key: string, value: unknown) {
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  db.prepare(`INSERT INTO requirements (id,project_id,source,key,value,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, projectId, source, key, typeof value === "string" ? value : JSON.stringify(value), "active", timestamp, timestamp);
  return id;
}
export function getRequirement(id: string) { return db.prepare(`SELECT * FROM requirements WHERE id=?`).get(id); }
export function listRequirements(projectId: string) { return db.prepare(`SELECT * FROM requirements WHERE project_id=? ORDER BY created_at ASC`).all(projectId); }
export function updateRequirementStatus(id: string, status: string) {
  db.prepare(`UPDATE requirements SET status=?, updated_at=? WHERE id=?`).run(status, new Date().toISOString(), id);
}

// parentArtifactId is intentionally the sixth argument: lineage is the most
// important relationship for the kernel. runId remains available as the
// seventh optional argument so artifacts can also be traced to an execution.
export function createArtifact(
  projectId: string,
  kind: string,
  name: string,
  uri?: string | null,
  metadata?: unknown,
  parentArtifactId?: string | null,
  runId?: string | null,
) {
  const id = randomUUID();
  db.prepare(`INSERT INTO artifacts (id,project_id,run_id,parent_artifact_id,kind,name,uri,metadata,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, projectId, runId ?? null, parentArtifactId ?? null, kind, name, uri ?? null, JSON.stringify(metadata ?? {}), new Date().toISOString());
  return id;
}
export function getArtifact(id: string) { return db.prepare(`SELECT * FROM artifacts WHERE id=?`).get(id); }
export function listArtifacts(projectId: string) { return db.prepare(`SELECT * FROM artifacts WHERE project_id=? ORDER BY created_at ASC`).all(projectId); }
export function listArtifactChildren(parentArtifactId: string) { return db.prepare(`SELECT * FROM artifacts WHERE parent_artifact_id=? ORDER BY created_at ASC`).all(parentArtifactId); }

export function requestApproval(projectId: string, action: string, payload: unknown) {
  const id = randomUUID();
  db.prepare(`INSERT INTO approvals (id,project_id,action,payload,created_at) VALUES (?,?,?,?,?)`).run(id, projectId, action, JSON.stringify(payload), new Date().toISOString());
  return id;
}
export function listApprovals(projectId?: string) {
  if (projectId) return db.prepare(`SELECT * FROM approvals WHERE project_id=? ORDER BY created_at DESC`).all(projectId);
  return db.prepare(`SELECT * FROM approvals ORDER BY created_at DESC`).all();
}
