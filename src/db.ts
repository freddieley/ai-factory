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
CREATE TABLE IF NOT EXISTS requirements (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  unit TEXT,
  required INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'unverified',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_id TEXT,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  uri TEXT,
  content_hash TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'created',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artifact_links (
  parent_artifact_id TEXT NOT NULL,
  child_artifact_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (parent_artifact_id, child_artifact_id, relation)
);
`);

function tableColumns(table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name));
}

function ensureColumn(table: string, column: string, definition: string) {
  if (!tableColumns(table).has(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// The kernel schema is intentionally forward-migrating. Older local databases
// were created before requirements/artifacts became durable entities, so
// CREATE TABLE IF NOT EXISTS alone is not sufficient when a developer upgrades.
ensureColumn("requirements", "source", "TEXT NOT NULL DEFAULT 'unknown'");
ensureColumn("requirements", "unit", "TEXT");
ensureColumn("requirements", "required", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("requirements", "status", "TEXT NOT NULL DEFAULT 'unverified'");
ensureColumn("requirements", "created_at", "TEXT NOT NULL DEFAULT ''");
ensureColumn("artifacts", "run_id", "TEXT");
ensureColumn("artifacts", "uri", "TEXT");
ensureColumn("artifacts", "content_hash", "TEXT");
ensureColumn("artifacts", "metadata", "TEXT NOT NULL DEFAULT '{}'");
ensureColumn("artifacts", "status", "TEXT NOT NULL DEFAULT 'created'");
ensureColumn("artifacts", "created_at", "TEXT NOT NULL DEFAULT ''");
ensureColumn("artifact_links", "created_at", "TEXT NOT NULL DEFAULT ''");

// Backfill timestamps introduced by the kernel migration. Empty strings are
// only possible on legacy rows because all new writes use ISO timestamps.
db.prepare(`UPDATE requirements SET created_at=? WHERE created_at=''`).run(new Date().toISOString());
db.prepare(`UPDATE artifacts SET created_at=? WHERE created_at=''`).run(new Date().toISOString());
db.prepare(`UPDATE artifact_links SET created_at=? WHERE created_at=''`).run(new Date().toISOString());

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
export function listEvents(runId: string) { return db.prepare(`SELECT id,run_id,type,payload,created_at FROM events WHERE run_id=? ORDER BY created_at ASC`).all(); }
export function getRun(id: string) { return db.prepare(`SELECT * FROM runs WHERE id=?`).get(id); }
export function requestApproval(projectId: string, action: string, payload: unknown) {
  const id = randomUUID();
  db.prepare(`INSERT INTO approvals (id,project_id,action,payload,created_at) VALUES (?,?,?,?,?)`).run(id, projectId, action, JSON.stringify(payload), new Date().toISOString());
  return id;
}
export function listApprovals(projectId?: string) {
  if (projectId) return db.prepare(`SELECT * FROM approvals WHERE project_id=? ORDER BY created_at DESC`).all(projectId);
  return db.prepare(`SELECT * FROM approvals ORDER BY created_at DESC`).all();
}
export function createRequirement(projectId: string, source: string, key: string, value: string, unit?: string, required = true) {
  const id = randomUUID();
  db.prepare(`INSERT INTO requirements (id,project_id,source,key,value,unit,required,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(id, projectId, source, key, value, unit ?? null, required ? 1 : 0, "unverified", new Date().toISOString());
  return id;
}
export function listRequirements(projectId: string) { return db.prepare(`SELECT * FROM requirements WHERE project_id=? ORDER BY created_at ASC`).all(projectId); }
export function updateRequirementStatus(id: string, status: string) { db.prepare(`UPDATE requirements SET status=? WHERE id=?`).run(status, id); }
export function createArtifact(projectId: string, runId: string | undefined, kind: string, name: string, uri?: string, contentHash?: string, metadata: unknown = {}) {
  const id = randomUUID();
  db.prepare(`INSERT INTO artifacts (id,project_id,run_id,kind,name,uri,content_hash,metadata,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, projectId, runId ?? null, kind, name, uri ?? null, contentHash ?? null, JSON.stringify(metadata), "created", new Date().toISOString());
  return id;
}
export function listArtifacts(projectId: string) { return db.prepare(`SELECT * FROM artifacts WHERE project_id=? ORDER BY created_at ASC`).all(projectId); }
export function linkArtifacts(parentArtifactId: string, childArtifactId: string, relation: string) {
  db.prepare(`INSERT OR IGNORE INTO artifact_links (parent_artifact_id,child_artifact_id,relation,created_at) VALUES (?,?,?,?)`).run(parentArtifactId, childArtifactId, relation, new Date().toISOString());
}
export function listArtifactLinks(projectId: string) {
  return db.prepare(`SELECT al.* FROM artifact_links al JOIN artifacts p ON p.id=al.parent_artifact_id WHERE p.project_id=? ORDER BY al.created_at ASC`).all(projectId);
}
