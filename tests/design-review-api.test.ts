import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { app } from "../src/server.js";
import { createProject, createArtifact } from "../src/db.js";

describe("design review API contracts",()=>{
  let projectId="";
  let artifactId="";
  beforeAll(async()=>{await app.ready();const project=createProject("Review API","contract") as {id:string};projectId=project.id;artifactId=createArtifact(projectId,undefined,"cad","root");});
  afterAll(async()=>{await app.close();});
  it("exposes impact analysis and requirement-artifact linkage",async()=>{
    const missing=await app.inject({method:"POST",url:`/api/projects/${projectId}/impact-analyses`,payload:{}});
    expect(missing.statusCode).toBe(400);
    const analysis=await app.inject({method:"POST",url:`/api/projects/${projectId}/impact-analyses`,payload:{artifactId}});
    expect(analysis.statusCode).toBe(200);
    expect(analysis.json().analysis.root_artifact_id).toBe(artifactId);
    const list=await app.inject({method:"GET",url:`/api/projects/${projectId}/impact-analyses`});
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);
  });
  it("creates reviews, findings, and enforces the approval gate",async()=>{
    const review=await app.inject({method:"POST",url:`/api/projects/${projectId}/design-reviews`,payload:{triggerType:"artifact-change"}});
    expect(review.statusCode).toBe(200);
    const reviewId=review.json().id;
    expect((await app.inject({method:"POST",url:`/api/design-reviews/${reviewId}/findings`,payload:{severity:"critical",title:"blocking issue",detail:"must be resolved"}})).statusCode).toBe(200);
    const blocked=await app.inject({method:"POST",url:`/api/design-reviews/${reviewId}/decision`,payload:{decision:"approved",decidedBy:"contract-test"}});
    expect(blocked.statusCode).toBe(409);
    const rejected=await app.inject({method:"POST",url:`/api/design-reviews/${reviewId}/decision`,payload:{decision:"rejected",decidedBy:"contract-test"}});
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().review.status).toBe("rejected");
  });
});
