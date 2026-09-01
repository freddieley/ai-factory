import { describe, expect, it } from "vitest";
import { createProject } from "../src/db.js";
import { addComponent, addSupplier, addSupplierOffer, addApprovedSource, findProcurementOptions, listApprovedSources } from "../src/knowledge.js";

describe("supplier discovery and approved procurement sources",()=>{
  it("stores supplier offers and ranks in-stock options before backorders",()=>{
    const project=createProject("supplier-test","procurement");
    const component=addComponent(project!.id,{partNumber:"MOTOR-01",name:"Motor",category:"actuator"});
    const supplierA=addSupplier(project!.id,{code:"SUP-A",name:"Supplier A",status:"active"});
    const supplierB=addSupplier(project!.id,{code:"SUP-B",name:"Supplier B",status:"active"});
    addSupplierOffer(project!.id,{componentId:component,supplierId:supplierB,supplierPartNumber:"B-01",unitPrice:4,currency:"GBP",availability:"backorder",leadTimeDays:3,source:{kind:"supplier",ref:"quote-b"}});
    addSupplierOffer(project!.id,{componentId:component,supplierId:supplierA,supplierPartNumber:"A-01",unitPrice:8,currency:"GBP",availability:"in_stock",stockQuantity:12,source:{kind:"supplier",ref:"quote-a"}});
    const options=findProcurementOptions(project!.id,component) as Array<{supplier_code:string;availability:string}>;
    expect(options.map(option=>option.supplier_code)).toEqual(["SUP-A","SUP-B"]);
  });
  it("prevents cross-project offers and requires a matching offer for approval",()=>{
    const p1=createProject("supplier-isolation-1","procurement");
    const p2=createProject("supplier-isolation-2","procurement");
    const component=addComponent(p1!.id,{partNumber:"CTRL-01",name:"Controller",category:"electronics"});
    const supplier=addSupplier(p2!.id,{code:"SUP-X",name:"Other Supplier"});
    expect(()=>addSupplierOffer(p1!.id,{componentId:component,supplierId:supplier,supplierPartNumber:"X",unitPrice:1,currency:"GBP",availability:"unknown",source:{kind:"supplier",ref:"x"}})).toThrow("suppliers not found in project");
    const ownSupplier=addSupplier(p1!.id,{code:"SUP-OWN",name:"Own Supplier"});
    expect(()=>addApprovedSource(p1!.id,{componentId:component,supplierId:ownSupplier,offerId:"missing",reason:"qualified source",approvedBy:"operator"})).toThrow("offer not found");
  });
  it("records an approved source against the exact component and supplier",()=>{
    const project=createProject("supplier-approval","procurement");
    const component=addComponent(project!.id,{partNumber:"ESC-01",name:"ESC",category:"electronics"});
    const supplier=addSupplier(project!.id,{code:"SUP-APP",name:"Approved Supplier"});
    const offer=addSupplierOffer(project!.id,{componentId:component,supplierId:supplier,supplierPartNumber:"ESC-A",unitPrice:12.5,currency:"GBP",availability:"in_stock",stockQuantity:5,source:{kind:"supplier",ref:"catalog-1"}});
    const approval=addApprovedSource(project!.id,{componentId:component,supplierId:supplier,offerId:offer,reason:"Verified supplier and current stock",approvedBy:"engineering-review"});
    const sources=listApprovedSources(project!.id,component) as Array<{id:string;offer_id:string;status:string}>;
    expect(sources[0]).toMatchObject({id:approval,offer_id:offer,status:"approved"});
  });
});
