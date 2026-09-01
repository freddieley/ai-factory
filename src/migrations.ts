import type Database from "better-sqlite3";

export type Migration = {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
};

function columns(db: Database.Database, table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
}

function addColumn(db: Database.Database, table: string, name: string, definition: string) {
  if (!columns(db, table).has(name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: "initial-factory-schema",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          prompt TEXT NOT NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          status TEXT NOT NULL,
          output TEXT,
          created_at TEXT NOT NULL,
          completed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          type TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS approvals (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          action TEXT NOT NULL,
          payload TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL,
          resolved_at TEXT
        );
        CREATE TABLE IF NOT EXISTS requirements (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          source TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          unit TEXT,
          required INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS artifacts (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          run_id TEXT,
          parent_artifact_id TEXT,
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          uri TEXT,
          content_hash TEXT,
          metadata TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS artifact_links (
          parent_artifact_id TEXT NOT NULL,
          child_artifact_id TEXT NOT NULL,
          relation TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (parent_artifact_id, child_artifact_id, relation)
        );
      `);
    },
  },
  {
    version: 2,
    name: "repair-legacy-factory-schema",
    up(db) {
      // Development databases created by pre-migration builds may already have
      // schema_migrations=1 while still missing columns introduced afterward.
      // Migration 2 makes that legacy state convergent and is deliberately
      // idempotent so it can repair interrupted or partially upgraded databases.
      addColumn(db, "requirements", "source", "TEXT NOT NULL DEFAULT 'unknown'");
      addColumn(db, "requirements", "key", "TEXT NOT NULL DEFAULT 'unspecified'");
      addColumn(db, "requirements", "value", "TEXT NOT NULL DEFAULT ''");
      addColumn(db, "requirements", "unit", "TEXT");
      addColumn(db, "requirements", "required", "INTEGER NOT NULL DEFAULT 1");
      addColumn(db, "requirements", "status", "TEXT NOT NULL DEFAULT 'active'");
      addColumn(db, "requirements", "created_at", "TEXT NOT NULL DEFAULT ''");
      addColumn(db, "requirements", "updated_at", "TEXT NOT NULL DEFAULT ''");
      addColumn(db, "artifacts", "run_id", "TEXT");
      addColumn(db, "artifacts", "parent_artifact_id", "TEXT");
      addColumn(db, "artifacts", "kind", "TEXT NOT NULL DEFAULT 'unknown'");
      addColumn(db, "artifacts", "name", "TEXT NOT NULL DEFAULT 'artifact'");
      addColumn(db, "artifacts", "uri", "TEXT");
      addColumn(db, "artifacts", "content_hash", "TEXT");
      addColumn(db, "artifacts", "metadata", "TEXT NOT NULL DEFAULT '{}'");
      addColumn(db, "artifacts", "created_at", "TEXT NOT NULL DEFAULT ''");

      const now = new Date().toISOString();
      db.prepare(`UPDATE requirements SET created_at=? WHERE created_at=''`).run(now);
      db.prepare(`UPDATE requirements SET updated_at=created_at WHERE updated_at=''`).run();
      db.prepare(`UPDATE artifacts SET created_at=? WHERE created_at=''`).run(now);

      db.exec(`
        CREATE TABLE IF NOT EXISTS artifact_links (
          parent_artifact_id TEXT NOT NULL,
          child_artifact_id TEXT NOT NULL,
          relation TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (parent_artifact_id, child_artifact_id, relation)
        );
        CREATE INDEX IF NOT EXISTS idx_requirements_project ON requirements(project_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_artifacts_project ON artifacts(project_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_artifacts_parent ON artifacts(parent_artifact_id);
        CREATE INDEX IF NOT EXISTS idx_artifact_links_parent ON artifact_links(parent_artifact_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_artifact_links_child ON artifact_links(child_artifact_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, created_at);
      `);
    },
  },
];

export function applyMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    (db.prepare(`SELECT version FROM schema_migrations ORDER BY version ASC`).all() as Array<{ version: number }>).map(
      (row) => row.version,
    ),
  );

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;

    const transaction = db.transaction(() => {
      migration.up(db);
      db.prepare(`INSERT INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)`).run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
    });
    transaction();
  }

  const knownVersions = new Set(migrations.map((migration) => migration.version));
  const unknown = [...applied].filter((version) => !knownVersions.has(version));
  if (unknown.length > 0) {
    throw new Error(`Database contains unknown migration version(s): ${unknown.join(", ")}`);
  }
}
