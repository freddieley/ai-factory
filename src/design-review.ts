import { randomUUID } from "node:crypto";
import { db, getArtifact, getProject } from "./db.js";

export const ImpactSeverity = ["info", "warning", "critical"] as const;
export type ImpactSeverity = typeof ImpactSeverity[number];
export const ReviewStatus = ["pending", "approved", "rejected"] as const;
export type ReviewStatus = typeof ReviewStatus[number];

function now() { return new Date().toISOString(); }

export function linkRequirementArtifact(requirementId: string, artifactId: string, relation = "satisfies") {
  if (!getArtifact(artifactId)) throw new Error("artifact not found");
  const requirement = db.prepare("SELECT id FROM engineering_requirements WHERE id=? UNION ALL SELECT id FROM requirements WHERE id=?").get(requirementId, requirementId);
  if (!requirement) throw new Error("requirement not found");
  db.prepare("INSERT OR IGNORE INTO requirement_artifact_links(requirement_id,artifact_id,relation,created_at) VALUES(?,?,?,?)").run(requirementId, artifactId, relation, now());
}

export function listRequirementArtifactLinks(projectId: string) {
  return db.prepare(`SELECT l.requirement_id,l.artifact_id,l.relation,l.created_at
    FROM requirement_artifact_links l JOIN artifacts a ON a.id=l.artifact_id
    WHERE a.project_id=? ORDER BY l.created_at ASC`).all(projectId);
}

function downstreamArtifacts(projectId: string, rootArtifactId: string) {
  const seen = new Set<string>();
  const queue = [rootArtifactId];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    const artifact = getArtifact(id) as { id: string; project_id: string } | undefined;
    if (!artifact || artifact.project_id !== projectId) continue;
    seen.add(id);
    const children = db.prepare(`SELECT child_artifact_id FROM artifact_links l JOIN artifacts a ON a.id=l.child_artifact_id WHERE l.parent_artifact_id=? AND a.project_id=?`).all(id, projectId) as Array<{child_artifact_id:string}>;
    for (const child of children) queue.push(child.child_artifact_id);
  }
  return [...seen];
}

export function analyzeChangeImpact(projectId: string, artifactId: string) {
  if (!getProject(projectId)) throw new Error("project not found");
  const root = getArtifact(artifactId) as { id:string; project_id:string; kind:string; name:string } | undefined;
  if (!root || root.project_id !== projectId) throw new Error("artifact not found in project");
  const artifactIds = downstreamArtifacts(projectId, artifactId);
  const placeholders = artifactIds.map(() => "?").join(",");
  const linkedRequirements = placeholders ? db.prepare(`SELECT DISTINCT requirement_id,artifact_id,relation FROM requirement_artifact_links WHERE artifact_id IN (${placeholders})`).all(...artifactIds) : [];
  const requirementIds = [...new Set((linkedRequirements as Array<{requirement_id:string}>).map(row => row.requirement_id))];
  const impactedRequirements = requirementIds.length
    ? db.prepare(`SELECT id,description,category,value,unit,priority,verification_status FROM engineering_requirements WHERE id IN (${requirementIds.map(() => "?").join(",")})`).all(...requirementIds)
    : [];
  const affectedArtifacts = artifactIds.length
    ? db.prepare(`SELECT id,kind,name,run_id,created_at FROM artifacts WHERE id IN (${placeholders}) ORDER BY created_at ASC`).all(...artifactIds)
    : [];
  const criticalRequirements = (impactedRequirements as Array<{priority:string;verification_status:string}>).filter(r => r.priority === "must" && r.verification_status !== "pass");
  const severity: ImpactSeverity = criticalRequirements.length ? "critical" : artifactIds.length > 1 ? "warning" : "info";
  const id = randomUUID();
  db.prepare(`INSERT INTO impact_analyses(id,project_id,root_artifact_id,severity,summary_json,created_at) VALUES(?,?,?,?,?,?)`).run(id, projectId, artifactId, severity, JSON.stringify({artifactCount: artifactIds.length, requirementCount: requirementIds.length, criticalRequirementCount: criticalRequirements.length}), now());
  const insert = db.prepare(`INSERT INTO impact_items(id,analysis_id,item_type,item_id,impact,severity,created_at) VALUES(?,?,?,?,?,?,?)`);
  const tx = db.transaction(() => {
    insert.run(randomUUID(), id, "artifact", artifactId, "changed artifact", "warning", now());
    for (const artifact of affectedArtifacts as Array<{id:string}>) if (artifact.id !== artifactId) insert.run(randomUUID(), id, "artifact", artifact.id, "downstream artifact may require regeneration or review", "warning", now());
    for (const requirement of impactedRequirements as Array<{id:string;description:string}>) insert.run(randomUUID(), id, "requirement", requirement.id, `requirement may be affected: ${requirement.description}`, criticalRequirements.some(r => (r as {id?:string}).id === requirement.id) ? "critical" : "warning", now());
  });
  tx();
  return getImpactAnalysis(id);
}

export function getImpactAnalysis(id: string) {
  const analysis = db.prepare("SELECT * FROM impact_analyses WHERE id=?").get(id);
  if (!analysis) return undefined;
  return { analysis, items: db.prepare("SELECT * FROM impact_items WHERE analysis_id=? ORDER BY created_at ASC").all(id) };
}

export function listImpactAnalyses(projectId: string) {
  return db.prepare("SELECT * FROM impact_analyses WHERE project_id=? ORDER BY created_at DESC").all(projectId);
}

export function createDesignReview(projectId: string, triggerType: string, triggerRef?: string, impactAnalysisId?: string) {
  if (!getProject(projectId)) throw new Error("project not found");
  if (impactAnalysisId) {
    const impact = db.prepare("SELECT id,project_id FROM impact_analyses WHERE id=?").get(impactAnalysisId) as {id:string;project_id:string}|undefined;
    if (!impact || impact.project_id !== projectId) throw new Error("impact analysis not found in project");
  }
  const id = randomUUID();
  const timestamp = now();
  db.prepare(`INSERT INTO design_reviews(id,project_id,trigger_type,trigger_ref,impact_analysis_id,status,summary_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(id,projectId,triggerType,triggerRef??null,impactAnalysisId??null,"pending",JSON.stringify({}),timestamp,timestamp);
  return id;
}

export function addReviewFinding(reviewId: string, severity: ImpactSeverity, title: string, detail: string) {
  const review = db.prepare("SELECT id FROM design_reviews WHERE id=?").get(reviewId);
  if (!review) throw new Error("design review not found");
  const id = randomUUID();
  db.prepare("INSERT INTO design_review_findings(id,review_id,severity,title,detail,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(id,reviewId,severity,title,detail,"open",now(),now());
  return id;
}

export function listDesignReviews(projectId: string) {
  return db.prepare("SELECT * FROM design_reviews WHERE project_id=? ORDER BY created_at DESC").all(projectId);
}

export function getDesignReview(id: string) {
  const review = db.prepare("SELECT * FROM design_reviews WHERE id=?").get(id);
  if (!review) return undefined;
  return { review, findings: db.prepare("SELECT * FROM design_review_findings WHERE review_id=? ORDER BY created_at ASC").all(id) };
}

export function decideDesignReview(reviewId: string, decision: Exclude<ReviewStatus,"pending">, decidedBy: string) {
  const review = db.prepare("SELECT * FROM design_reviews WHERE id=?").get(reviewId) as {id:string;project_id:string;status:ReviewStatus}|undefined;
  if (!review) throw new Error("design review not found");
  if (review.status !== "pending") throw new Error("design review is already decided");
  const openCritical = db.prepare("SELECT COUNT(*) AS count FROM design_review_findings WHERE review_id=? AND severity='critical' AND status='open'").get(reviewId) as {count:number};
  const requiredFailures = db.prepare(`SELECT COUNT(*) AS count FROM engineering_requirements WHERE project_id=? AND priority='must' AND verification_status!='pass'`).get(review.project_id) as {count:number};
  if (decision === "approved" && (openCritical.count > 0 || requiredFailures.count > 0)) throw new Error(`design review cannot be approved: ${openCritical.count} open critical finding(s), ${requiredFailures.count} unverified/failed must requirement(s)`);
  const timestamp = now();
  db.prepare("UPDATE design_reviews SET status=?,decided_by=?,decided_at=?,updated_at=? WHERE id=?").run(decision,decidedBy,timestamp,timestamp,reviewId);
  return getDesignReview(reviewId);
}
