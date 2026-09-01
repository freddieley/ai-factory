import { describe, expect, it } from "vitest";
import { db, getSchemaVersion, listSchemaMigrations } from "../src/db.js";

describe("database schema migrations", () => {
  it("records a current schema baseline", () => {
    expect(getSchemaVersion()).toBeGreaterThanOrEqual(1);
    expect(listSchemaMigrations()).toEqual(expect.arrayContaining([
      expect.objectContaining({ version: 1, name: "initial-factory-schema" })
    ]));
  });

  it("exposes the lineage and timestamp columns required by the factory graph", () => {
    const requirements = db.prepare("PRAGMA table_info(requirements)").all() as Array<{ name: string }>;
    const artifacts = db.prepare("PRAGMA table_info(artifacts)").all() as Array<{ name: string }>;
    expect(requirements.map(column => column.name)).toEqual(expect.arrayContaining(["source", "key", "value", "created_at", "updated_at"]));
    expect(artifacts.map(column => column.name)).toEqual(expect.arrayContaining(["run_id", "parent_artifact_id", "metadata", "created_at"]));
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='artifact_links'").get()).toBeTruthy();
  });
});
