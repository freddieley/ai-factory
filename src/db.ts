import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { applyMigrations } from "./migrations.js";

mkdirSync(dirname(config.DATABASE_PATH), { recursive: true });

export const db = new Database(config.DATABASE_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

applyMigrations(db);

export function getSchemaVersion(): number {
  return (db.prepare(`SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations`).get() as { version: number }).version;
}

export function listSchemaMigrations() {
  return db.prepare(`SELECT version,name,applied_at FROM schema_migrations ORDER BY version ASC`).all();
}

export function createProject(name: string, description: string) { const id=randomUUID(); db.prepare(`INSERT INTO projects (id,name,description,created_at) VALUES (?,?,?,?)`).run(id,name,description,new Date().toISOString()); return getProject(id); }
export function getProject(id:string){return db.prepare(`SELECT * FROM projects WHERE id=?`).get(id);}
export function listProjects(){return db.prepare(`SELECT * FROM projects ORDER BY created_at DESC`).all();}
export function createRun(projectId:string,prompt:string,provider:string,model:string){const id=randomUUID();db.prepare(`INSERT INTO runs (id,project_id,prompt,provider,model,status,created_at) VALUES (?,?,?,?,?,?,?)`).run(id,projectId,prompt,provider,model,"running",new Date().toISOString());return id;}
export function finishRun(id:string,status:string,output:string){db.prepare(`UPDATE runs SET status=?,output=?,completed_at=? WHERE id=?`).run(status,output,new Date().toISOString(),id);}
export function addEvent(runId:string,type:string,payload:unknown){db.prepare(`INSERT INTO events (id,run_id,type,payload,created_at) VALUES (?,?,?,?,?)`).run(randomUUID(),runId,type,JSON.stringify(payload),new Date().toISOString());}
export function listEvents(runId:string){return db.prepare(`SELECT id,run_id,type,payload,created_at FROM events WHERE run_id=? ORDER BY created_at ASC`).all(runId);}
export function getRun(id:string){return db.prepare(`SELECT * FROM runs WHERE id=?`).get(id);}
export function createRequirement(projectId:string,source:string,key:string,value:unknown,unit?:string|null,required=true){const id=randomUUID(),timestamp=new Date().toISOString();db.prepare(`INSERT INTO requirements (id,project_id,source,key,value,unit,required,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id,projectId,source,key,typeof value==="string"?value:JSON.stringify(value),unit??null,required?1:0,"active",timestamp,timestamp);return id;}
export function getRequirement(id:string){return db.prepare(`SELECT * FROM requirements WHERE id=?`).get(id);}
export function listRequirements(projectId:string){return db.prepare(`SELECT * FROM requirements WHERE project_id=? ORDER BY created_at ASC`).all(projectId);}
export function updateRequirementStatus(id:string,status:string){db.prepare(`UPDATE requirements SET status=?,updated_at=? WHERE id=?`).run(status,new Date().toISOString(),id);}
export function createArtifact(projectId:string,runId:string|undefined,kind:string,name:string,uri?:string|null,contentHash?:string|null,metadata?:unknown){const id=randomUUID();db.prepare(`INSERT INTO artifacts (id,project_id,run_id,kind,name,uri,content_hash,metadata,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(id,projectId,runId??null,kind,name,uri??null,contentHash??null,JSON.stringify(metadata??{}),new Date().toISOString());return id;}
export function getArtifact(id:string){return db.prepare(`SELECT * FROM artifacts WHERE id=?`).get(id);}
export function listArtifacts(projectId:string){return db.prepare(`SELECT * FROM artifacts WHERE project_id=? ORDER BY created_at ASC`).all(projectId);}
export function linkArtifacts(parentArtifactId:string,childArtifactId:string,relation:string){if(!getArtifact(parentArtifactId))throw new Error("parent artifact not found");if(!getArtifact(childArtifactId))throw new Error("child artifact not found");if(parentArtifactId===childArtifactId)throw new Error("artifact cannot link to itself");db.prepare(`INSERT OR IGNORE INTO artifact_links (parent_artifact_id,child_artifact_id,relation,created_at) VALUES (?,?,?,?)`).run(parentArtifactId,childArtifactId,relation,new Date().toISOString());}
export function listArtifactLinks(projectId:string){return db.prepare(`SELECT l.parent_artifact_id,l.child_artifact_id,l.relation,l.created_at FROM artifact_links l JOIN artifacts p ON p.id=l.parent_artifact_id JOIN artifacts c ON c.id=l.child_artifact_id WHERE p.project_id=? AND c.project_id=? ORDER BY l.created_at ASC`).all(projectId,projectId);}
export function listArtifactChildren(parentArtifactId:string){return db.prepare(`SELECT * FROM artifacts WHERE parent_artifact_id=? ORDER BY created_at ASC`).all(parentArtifactId);}
export function requestApproval(projectId:string,action:string,payload:unknown){const id=randomUUID();db.prepare(`INSERT INTO approvals (id,project_id,action,payload,created_at) VALUES (?,?,?,?,?)`).run(id,projectId,action,JSON.stringify(payload),new Date().toISOString());return id;}
export function listApprovals(projectId?:string){if(projectId)return db.prepare(`SELECT * FROM approvals WHERE project_id=? ORDER BY created_at DESC`).all(projectId);return db.prepare(`SELECT * FROM approvals ORDER BY created_at DESC`).all();}
