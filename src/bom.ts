import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "./db.js";

export const BomItem = z.object({ partNumber:z.string().min(1), name:z.string().min(1), quantity:z.number().positive(), material:z.string().optional(), source:z.enum(["designed","purchased","reused"]).default("designed"), notes:z.string().optional() });
export const WorkOrder = z.object({ id:z.string(), projectId:z.string(), objective:z.string(), status:z.enum(["draft","awaiting_approval","approved","rejected","completed"]).default("draft"), bom:z.array(BomItem), manufacturingNotes:z.array(z.string()).default([]) });
export type BomItem = z.infer<typeof BomItem>;

export function createWorkOrder(projectId:string, objective:string, bom:BomItem[], manufacturingNotes:string[]=[]){ const id=`WO-${randomUUID().slice(0,8)}`; const now=new Date().toISOString(); db.prepare(`INSERT INTO work_orders(id,project_id,objective,status,bom_json,notes_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`).run(id,projectId,objective,"awaiting_approval",JSON.stringify(bom),JSON.stringify(manufacturingNotes),now,now); return getWorkOrder(id); }
export function getWorkOrder(id:string){ const row=db.prepare(`SELECT * FROM work_orders WHERE id=?`).get(id) as any; if(!row)return null; return WorkOrder.parse({id:row.id,projectId:row.project_id,objective:row.objective,status:row.status,bom:JSON.parse(row.bom_json),manufacturingNotes:JSON.parse(row.notes_json)}); }
export function listWorkOrders(projectId?:string){ const rows=projectId?db.prepare(`SELECT * FROM work_orders WHERE project_id=? ORDER BY created_at DESC`).all(projectId):db.prepare(`SELECT * FROM work_orders ORDER BY created_at DESC`).all(); return rows.map((row:any)=>WorkOrder.parse({id:row.id,projectId:row.project_id,objective:row.objective,status:row.status,bom:JSON.parse(row.bom_json),manufacturingNotes:JSON.parse(row.notes_json)})); }
