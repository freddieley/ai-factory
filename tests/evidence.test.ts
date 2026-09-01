import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, createProject } from "../src/db.js";
import { addEvidenceClaim, addEvidenceSource, getEvidenceFreshness, searchEvidence } from "../src/evidence.js";

describe("engineering evidence layer",()=>{
  it("stores attributed claims and ranks current evidence before expired evidence",()=>{
    const project=createProject(`evidence-${randomUUID()}`,"evidence test") as {id:string};
    const current=addEvidenceSource(project.id,{kind:"datasheet",ref:"motor-datasheet-v2",observedAt:new Date().toISOString(),confidence:.95});
    const expired=addEvidenceSource(project.id,{kind:"datasheet",ref:"motor-datasheet-old",expiresAt:"2020-01-01T00:00:00.000Z",confidence:1});
    addEvidenceClaim(project.id,{sourceId:expired,claim:"motor has 1000 RPM",subject:"motor",property:"rpm",value:1000});
    addEvidenceClaim(project.id,{sourceId:current,claim:"motor has 1200 RPM",subject:"motor",property:"rpm",value:1200});
    const results=searchEvidence(project.id,"motor");
    expect(results).toHaveLength(2);
    expect((results[0] as {source_ref:string}).source_ref).toBe("motor-datasheet-v2");
    const freshness=getEvidenceFreshness(project.id) as {total:number;expired:number;current:number};
    expect(freshness.total).toBe(2); expect(freshness.expired).toBe(1); expect(freshness.current).toBe(1);
  });

  it("rejects claims whose source belongs to another project",()=>{
    const a=createProject(`a-${randomUUID()}`,"a") as {id:string};
    const b=createProject(`b-${randomUUID()}`,"b") as {id:string};
    const source=addEvidenceSource(a.id,{kind:"manual",ref:"manual-1"});
    expect(()=>addEvidenceClaim(b.id,{sourceId:source,claim:"not allowed"})).toThrow("evidence source not found in project");
  });

  it("has the evidence schema available after migration",()=>{
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='evidence_sources'`).get()).toBeTruthy();
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='evidence_claims'`).get()).toBeTruthy();
  });
});
