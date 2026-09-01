import { describe, expect, it } from "vitest";
import { FactoryRequest } from "../src/factory.js";
import { BomItem, WorkOrder } from "../src/bom.js";

describe("factory contracts", () => {
  it("normalizes omitted cycle options", () => {
    const request = FactoryRequest.parse({ projectId: "p1", objective: "Design a plate" });
    expect(request.maxIterations).toBe(2);
    expect(request.constraints).toEqual([]);
  });
  it("validates BOM items", () => {
    const item = BomItem.parse({ partNumber: "PLATE-001", name: "Mounting plate", quantity: 1 });
    expect(item.source).toBe("designed");
  });
  it("models manufacturing work orders as approval-gated", () => {
    const order = WorkOrder.parse({ id: "WO-1", projectId: "p1", objective: "Print plate", bom: [{ partNumber: "PLATE-001", name: "Mounting plate", quantity: 1 }], status: "awaiting_approval" });
    expect(order.status).toBe("awaiting_approval");
  });
});
