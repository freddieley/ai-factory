import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "../src/migrations.js";
import { db, getSchemaVersion, listSchemaMigrations } from "../src/db.js";

describe("database schema migrations", () => {
  it("records the current schema version and migration history", () => {
    expect(getSchemaVersion()).toBe(2);
    expect(listSchemaMigrations()).toEqual([
      expect.objectContaining({ version: 1, name: "initial-factory-schema" }),
      expect.objectContaining({ version: 2, name: "repair-legacy-factory-schema" }),
    ]);
  });

  it("exposes the lineage and timestamp columns required by the factory graph", () => {
    const requirements = db.prepare("PRAGMA table_info(requirements)").all() as Array<{ name: string }>;
    const artifacts = db.prepare("PRAGMA table_info(artifacts)").all() as Array<{ name: string }>;
    expect(requirements.map(column => column.name)).toEqual(expect.arrayContaining(["source", "key", "value", "created_at", "updated_at"]));
    expect(artifacts.map(column => column.name)).toEqual(expect.arrayContaining(["run_id", "parent_artifact_id", "metadata", "created_at"]));
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='artifact_links'").get()).toBeTruthy();
  });

  it("repairs a legacy database that incorrectly claims version 1", () => {
    const legacy = new Database(":memory:");
    legacy.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
      CREATE TABLE requirements (id TEXT PRIMARY KEY, project_id TEXT NOT NULL);
      CREATE TABLE artifacts (id TEXT PRIMARY KEY, project_id TEXT NOT NULL);
      INSERT INTO schema_migrations VALUES (1, 'initial-factory-schema', '2026-01-01T00:00:00.000Z');
    `);

    applyMigrations(legacy);

    const requirementColumns = legacy.prepare("PRAGMA table_info(requirements)").all() as Array<{ name: string }>;
    const artifactColumns = legacy.prepare("PRAGMA table_info(artifacts)").all() as Array<{ name: string }>;
    expect(requirementColumns.map(column => column.name)).toEqual(expect.arrayContaining(["source", "key", "value", "created_at", "updated_at"]));
    expect(artifactColumns.map(column => column.name)).toEqual(expect.arrayContaining(["run_id", "parent_artifact_id", "metadata", "created_at"]));
    expect(legacy.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([{ version: 1 }, { version: 2 }]);
    legacy.close();
  });
});
