import { describe, expect, it } from "vitest";
import { createArtifact, createProject } from "../src/db.js";
import { addReviewFinding, analyzeChangeImpact, createDesignReview, decideDesignReview, getDesignReview, linkRequirementArtifact } from "../src/design-review.js";
import { db } from "../src/db.js";

describe("change impact and design review gates",()=>{
  it("traverses downstream artifact lineage and linked requirements",()=>{
    const project=createProject("Impact project","test") as {id:string};
    const root=createArtifact(project.id,undefined,"cad","root");
    const child=createArtifact(project.id,undefined,"drawing","drawing");
    const verification=createArtifact(project.id,undefined,"verification","verification");
    db.prepare("INSERT INTO artifact_links(parent_artifact_id,child_artifact_id,relation,created_at) VALUES(?,?,?,?)").run(root,child,"derived-from",new Date().toISOString());
    db.prepare("INSERT INTO artifact_links(parent_artifact_id,child_artifact_id,relation,created_at) VALUES(?,?,?,?)").run(child,verification,"verified-by",new Date().toISOString());
    const requirementId="ER-IMPACT-1";
    db.prepare(`INSERT INTO engineering_requirements(id,project_id,description,category,value,unit,priority,verification_method,verification_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(requirementId,project.id,"overall width","mechanical","50","mm","must","measurement","unverified",new Date().toISOString(),new Date().toISOString());
    linkRequirementArtifact(requirementId,child);
    const result=analyzeChangeImpact(project.id,root) as {analysis:{severity:string};items:Array<{item_type:string;item_id:string;severity:string}>};
    expect(result.analysis.severity).toBe("critical");
    expect(result.items.map(item=>item.item_id)).toEqual(expect.arrayContaining([root,child,verification,requirementId]));
  });
  it("prevents approval when must requirements or critical findings remain open",()=>{
    const project=createProject("Review project","test") as {id:string};
    const review=createDesignReview(project.id,"artifact-change");
    addReviewFinding(review,"critical","unsafe tolerance","critical finding");
    expect(()=>decideDesignReview(review,"approved","operator")).toThrow(/cannot be approved/);
    const pending=getDesignReview(review) as {review:{status:string}};
    expect(pending.review.status).toBe("pending");
    expect(decideDesignReview(review,"rejected","operator")?.review.status).toBe("rejected");
  });
  it("allows approval after all blocking conditions are cleared",()=>{
    const project=createProject("Approval project","test") as {id:string};
    const requirementId="ER-APPROVAL-1";
    db.prepare(`INSERT INTO engineering_requirements(id,project_id,description,category,value,unit,priority,verification_method,verification_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(requirementId,project.id,"width","mechanical","50","mm","must","measurement","pass",new Date().toISOString(),new Date().toISOString());
    const review=createDesignReview(project.id,"planned-release");
    expect(decideDesignReview(review,"approved","operator")?.review.status).toBe("approved");
  });
});
