import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { DEFAULT_STAGES, StageName, StageStatus } from "./lifecycle.js";

// Stage state is separate from the core entity tables so lifecycle evolution
// does not require rewriting the durable requirements/artifact schema.
db.exec(`
CREATE TABLE IF NOT EXISTS project_stages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  stage_order INTEGER NOT NULL,
  status TEXT NOT NULL,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  approval_id TEXT,
  run_id TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, stage)
);
CREATE INDEX IF NOT EXISTS idx_project_stages_project_order
  ON project_stages(project_id, stage_order);
`);

function now() { return new Date().toISOString(); }

export function initializeProjectStages(projectId: string) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO project_stages
      (id, project_id, stage, stage_order, status, requires_approval, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const transaction = db.transaction(() => {
    for (const stage of DEFAULT_STAGES) {
      insert.run(randomUUID(), projectId, stage.name, stage.order, "pending", stage.requiresApproval ? 1 : 0, now());
    }
  });
  transaction();
  return listProjectStages(projectId);
}

export function listProjectStages(projectId: string) {
  return db.prepare(`SELECT * FROM project_stages WHERE project_id=? ORDER BY stage_order ASC`).all(projectId) as Array<{
    id: string; project_id: string; stage: StageName; stage_order: number; status: StageStatus;
    requires_approval: number; approval_id: string | null; run_id: string | null; attempt: number;
    started_at: string | null; completed_at: string | null; error: string | null; created_at: string;
  }>;
}

export function getProjectStage(projectId: string, stage: StageName) {
  return db.prepare(`SELECT * FROM project_stages WHERE project_id=? AND stage=?`).get(projectId, stage) as {
    id: string; project_id: string; stage: StageName; stage_order: number; status: StageStatus;
    requires_approval: number; approval_id: string | null; run_id: string | null; attempt: number;
    started_at: string | null; completed_at: string | null; error: string | null; created_at: string;
  } | undefined;
}

export function transitionProjectStage(
  projectId: string,
  stage: StageName,
  status: StageStatus,
  options: { runId?: string; approvalId?: string; error?: string } = {}
) {
  const current = getProjectStage(projectId, stage);
  if (!current) throw new Error(`Stage not initialized: ${stage}`);

  const timestamp = now();
  const startedAt = status === "running" ? timestamp : current.started_at;
  const completedAt = ["passed", "failed", "skipped"].includes(status) ? timestamp : current.completed_at;
  const attempt = status === "running" ? current.attempt + 1 : current.attempt;

  db.prepare(`
    UPDATE project_stages
    SET status=?, approval_id=COALESCE(?, approval_id), run_id=COALESCE(?, run_id),
        attempt=?, started_at=?, completed_at=?, error=?
    WHERE project_id=? AND stage=?
  `).run(
    status,
    options.approvalId ?? null,
    options.runId ?? null,
    attempt,
    startedAt,
    completedAt,
    options.error ?? null,
    projectId,
    stage
  );
  return getProjectStage(projectId, stage);
}
