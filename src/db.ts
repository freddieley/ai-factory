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
  unit TEXT,
  required INTEGER NOT NULL DEFAULT 1,
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
  content_hash TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artifact_links (
  parent_artifact_id TEXT NOT NULL,
  child_artifact_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (parent_artifact_id, child_artifact_id, relation)
);
CREATE INDEX IF NOT EXISTS idx_requirements_project ON requirements(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_artifacts_project ON artifacts(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_artifacts_parent ON artifacts(parent_artifact_id);
CREATE INDEX IF NOT EXISTS idx_artifact_links_parent ON artifact_links(parent_artifact_id, created_at);
CREATE INDEX IF NOT EXISTS idx_artifact_links_child ON artifact_links(child_artifact_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, created_at);
`);

function tableColumns(table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name));
}

function addColumnIfMissing(table: string, column: string, definition: string) {
  if (!tableColumns(table).has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// Upgrade databases created by earlier factory builds in-place. Existing rows
// receive safe defaults; new writes always provide authoritative timestamps.
addColumnIfMissing("requirements", "source", "TEXT NOT NULL DEFAULT 'unknown'");
addColumnIfMissing("requirements", "key", "TEXT NOT NULL DEFAULT 'unspecified'");
addColumnIfMissing("requirements", "value", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("requirements", "unit", "TEXT");
addColumnIfMissing("requirements", "required", "INTEGER NOT NULL DEFAULT 1");
addColumnIfMissing("requirements", "status", "TEXT NOT NULL DEFAULT 'active'");
addColumnIfMissing("requirements", "created_at", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("requirements", "updated_at", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("artifacts", "run_id", "TEXT");
addColumnIfMissing("artifacts", "parent_artifact_id", "TEXT");
addColumnIfMissing("artifacts", "kind", "TEXT NOT NULL DEFAULT 'unknown'");
addColumnIfMissing("artifacts", "name", "TEXT NOT NULL DEFAULT 'artifact'");
addColumnIfMissing("artifacts", "uri", "TEXT");
addColumnIfMissing("artifacts", "content_hash", "TEXT");
addColumnIfMissing("artifacts", "metadata", "TEXT NOT NULL DEFAULT '{}'");
addColumnIfMissing("artifacts", "created_at", "TEXT NOT NULL DEFAULT ''");

db.exec(`
CREATE TABLE IF NOT EXISTS artifact_links (
  parent_artifact_id TEXT NOT NULL,
  child_artifact_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (parent_artifact_id, child_artifact_id, relation)
);
CREATE INDEX IF NOT EXISTS idx_artifact_links_parent ON artifact_links(parent_artifact_id, created_at);
CREATE INDEX IF NOT EXISTS idx_artifact_links_child ON artifact_links(child_artifact_id, created_at);
`);

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

export function createRequirement(
  projectId: string,
  source: string,
  key: string,
  value: unknown,
  unit?: string | null,
  required = true,
) {
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  db.prepare(`INSERT INTO requirements (id,project_id,source,key,value,unit,required,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, projectId, source, key, typeof value === "string" ? value : JSON.stringify(value), unit ?? null, required ? 1 : 0, "active", timestamp, timestamp);
  return id;
}
export function getRequirement(id: string) { return db.prepare(`SELECT * FROM requirements WHERE id=?`).get(id); }
export function listRequirements(projectId: string) { return db.prepare(`SELECT * FROM requirements WHERE project_id=? ORDER BY created_at ASC`).all(projectId); }
export function updateRequirementStatus(id: string, status: string) {
  db.prepare(`UPDATE requirements SET status=?, updated_at=? WHERE id=?`).run(status, new Date().toISOString(), id);
}

/**
 * Persist an immutable artifact record. contentHash allows later verification
 * that a CAD file, BOM, test result, firmware build, or other artifact has not
 * silently changed since the factory produced it.
 */
export function createArtifact(
  projectId: string,
  runId: string | undefined,
  kind: string,
  name: string,
  uri?: string | null,
  contentHash?: string | null,
  metadata?: unknown,
) {
  const id = randomUUID();
  db.prepare(`INSERT INTO artifacts (id,project_id,run_id,kind,name,uri,content_hash,metadata,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, projectId, runId ?? null, kind, name, uri ?? null, contentHash ?? null, JSON.stringify(metadata ?? {}), new Date().toISOString());
  return id;
}
export function getArtifact(id: string) { return db.prepare(`SELECT * FROM artifacts WHERE id=?`).get(id); }
export function listArtifacts(projectId: string) { return db.prepare(`SELECT * FROM artifacts WHERE project_id=? ORDER BY created_at ASC`).all(projectId); }

export function linkArtifacts(parentArtifactId: string, childArtifactId: string, relation: string) {
  if (!getArtifact(parentArtifactId)) throw new Error("parent artifact not found");
  if (!getArtifact(childArtifactId)) throw new Error("child artifact not found");
  if (parentArtifactId === childArtifactId) throw new Error("artifact cannot link to itself");
  db.prepare(`INSERT OR IGNORE INTO artifact_links (parent_artifact_id,child_artifact_id,relation,created_at) VALUES (?,?,?,?)`)
    .run(parentArtifactId, childArtifactId, relation, new Date().toISOString());
}
export function listArtifactLinks(projectId: string) {
  return db.prepare(`
    SELECT l.parent_artifact_id, l.child_artifact_id, l.relation, l.created_at
    FROM artifact_links l
    JOIN artifacts p ON p.id=l.parent_artifact_id
    JOIN artifacts c ON c.id=l.child_artifact_id
    WHERE p.project_id=? AND c.project_id=?
    ORDER BY l.created_at ASC
  `).all(projectId, projectId);
}
export function listArtifactChildren(parentArtifactId: string) {
  return db.prepare(`SELECT * FROM artifacts WHERE parent_artifact_id=? ORDER BY created_at ASC`).all(parentArtifactId);
}

export function requestApproval(projectId: string, action: string, payload: unknown) {
  const id = randomUUID();
  db.prepare(`INSERT INTO approvals (id,project_id,action,payload,created_at) VALUES (?,?,?,?,?)`).run(id, projectId, action, JSON.stringify(payload), new Date().toISOString());
  return id;
}
export function listApprovals(projectId?: string) {
  if (projectId) return db.prepare(`SELECT * FROM approvals WHERE project_id=? ORDER BY created_at DESC`).all(projectId);
  return db.prepare(`SELECT * FROM approvals ORDER BY created_at DESC`).all();
}
