import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, createProject } from "../src/db.js";
import { addComponent } from "../src/knowledge.js";
import { createBomRevision, getBomRevision, listBomRevisions, setBomRevisionStatus, recordComponentLifecycle, listComponentLifecycle, getApprovedBom } from "../src/bom.js";

describe("BOM and component lifecycle",()=>{
  it("versions BOMs and keeps exactly one approved revision",()=>{
    const project=createProject(`bom-${randomUUID()}`,"test");
    const a=createBomRevision(project!.id,[{partNumber:"FRAME-1",name:"Frame",quantity:1}],"initial design");
    const b=createBomRevision(project!.id,[{partNumber:"FRAME-2",name:"Updated frame",quantity:1}],"mass reduction");
    expect((getBomRevision(a) as any).version).toBe(1);
    expect((getBomRevision(b) as any).version).toBe(2);
    setBomRevisionStatus(a,"approved");
    setBomRevisionStatus(b,"approved");
    expect((getBomRevision(a) as any).status).toBe("superseded");
    expect((getApprovedBom(project!.id) as any).id).toBe(b);
    expect(listBomRevisions(project!.id)).toHaveLength(2);
  });

  it("binds BOM items to project components and rejects cross-project references",()=>{
    const p1=createProject(`p1-${randomUUID()}`,"test")!;
    const p2=createProject(`p2-${randomUUID()}`,"test")!;
    const component=addComponent(p1.id,{partNumber:"MOTOR-1",name:"Motor",category:"actuator",lifecycle:"active"});
    const bom=createBomRevision(p1.id,[{componentId:component,partNumber:"MOTOR-1",name:"Motor",quantity:2,source:"purchased"}],"select motor");
    expect((getBomRevision(bom) as any).items[0].component_id).toBe(component);
    expect(()=>createBomRevision(p2.id,[{componentId:component,partNumber:"MOTOR-1",name:"Motor",quantity:1}],"invalid cross-project reference")).toThrow(/component not found/);
  });

  it("records lifecycle transitions with an auditable reason",()=>{
    const project=createProject(`life-${randomUUID()}`,"test")!;
    const component=addComponent(project.id,{partNumber:"ESC-1",name:"ESC",category:"electronics",lifecycle:"active"});
    const event=recordComponentLifecycle(project.id,component,"obsolete","manufacturer EOL confirmed");
    expect(event).toBeTruthy();
    const row=db.prepare(`SELECT lifecycle FROM components WHERE id=?`).get(component) as {lifecycle:string};
    expect(row.lifecycle).toBe("obsolete");
    const events=listComponentLifecycle(project.id,component) as any[];
    expect(events).toHaveLength(1);
    expect(events[0].from_status).toBe("active");
    expect(events[0].to_status).toBe("obsolete");
    expect(events[0].reason).toContain("EOL");
  });
});
