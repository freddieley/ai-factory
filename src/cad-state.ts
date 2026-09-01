import { createHash } from "node:crypto";
import { appendArtifactRevision, createArtifact, getArtifact, listArtifactRevisions } from "./db.js";
import { ParametricModel, canonicalParametricJson, validateParametricModel } from "./parametric.js";

export type CadState = {
  model: ParametricModel;
  metadata?: Record<string, unknown>;
};

export type CadSnapshot = {
  schema: "ai-factory.cad-snapshot/v1";
  contentHash: string;
  state: CadState;
};

export type CadDiff = {
  changed: boolean;
  addedParameters: string[];
  removedParameters: string[];
  changedParameters: Array<{ name: string; before: number; after: number }>;
  addedFeatures: string[];
  removedFeatures: string[];
  changedFeatures: string[];
};

function canonicalState(state: CadState): string {
  const model = validateParametricModel(state.model);
  return JSON.stringify({ model: JSON.parse(canonicalParametricJson(model)), metadata: state.metadata ?? {} });
}

export function snapshotCadState(state: CadState): CadSnapshot {
  const canonical = canonicalState(state);
  const contentHash = createHash("sha256").update(canonical).digest("hex");
  return { schema: "ai-factory.cad-snapshot/v1", contentHash, state: JSON.parse(canonical) as CadState };
}

export function diffCadStates(before: CadState, after: CadState): CadDiff {
  const a = validateParametricModel(before.model);
  const b = validateParametricModel(after.model);
  const aParams = new Map(a.parameters.map(p => [p.name, p.valueMm]));
  const bParams = new Map(b.parameters.map(p => [p.name, p.valueMm]));
  const addedParameters = [...bParams.keys()].filter(name => !aParams.has(name)).sort();
  const removedParameters = [...aParams.keys()].filter(name => !bParams.has(name)).sort();
  const changedParameters = [...aParams.keys()].filter(name => bParams.has(name) && aParams.get(name) !== bParams.get(name)).sort().map(name => ({ name, before: aParams.get(name)!, after: bParams.get(name)! }));
  const featureKey = (feature: ParametricModel["features"][number]) => JSON.stringify(feature);
  const aFeatures = new Map(a.features.map(feature => [feature.name, featureKey(feature)]));
  const bFeatures = new Map(b.features.map(feature => [feature.name, featureKey(feature)]));
  const addedFeatures = [...bFeatures.keys()].filter(name => !aFeatures.has(name)).sort();
  const removedFeatures = [...aFeatures.keys()].filter(name => !bFeatures.has(name)).sort();
  const changedFeatures = [...aFeatures.keys()].filter(name => bFeatures.has(name) && aFeatures.get(name) !== bFeatures.get(name)).sort();
  return {
    changed: addedParameters.length > 0 || removedParameters.length > 0 || changedParameters.length > 0 || addedFeatures.length > 0 || removedFeatures.length > 0 || changedFeatures.length > 0,
    addedParameters, removedParameters, changedParameters, addedFeatures, removedFeatures, changedFeatures,
  };
}

export function recordCadSnapshot(projectId: string, state: CadState, runId?: string): CadSnapshot & { artifactId: string } {
  const snapshot = snapshotCadState(state);
  const artifactId = createArtifact(projectId, runId, "cad_snapshot", state.model.name, undefined, snapshot.contentHash, snapshot);
  return { ...snapshot, artifactId };
}

export function appendCadSnapshot(artifactId: string, state: CadState, runId?: string): CadSnapshot & { artifactId: string; revision: number } {
  const snapshot = snapshotCadState(state);
  const revision = appendArtifactRevision(artifactId, "cad_snapshot", snapshot, snapshot.contentHash, undefined, runId);
  return { ...snapshot, artifactId, revision };
}

export function restoreCadSnapshot(artifactId: string): CadSnapshot {
  const artifact = getArtifact(artifactId) as { kind: string; content_hash?: string; metadata: string } | undefined;
  if (!artifact || artifact.kind !== "cad_snapshot") throw new Error("CAD snapshot artifact not found");
  const metadata = JSON.parse(artifact.metadata) as CadSnapshot;
  const restored = snapshotCadState(metadata.state);
  if (artifact.content_hash && artifact.content_hash !== restored.contentHash) throw new Error("CAD snapshot content hash mismatch");
  return restored;
}

export function replayCadHistory(artifactId: string): CadSnapshot[] {
  const revisions = listArtifactRevisions(artifactId) as Array<{ metadata: string; content_hash?: string | null; source_kind?: string | null }>;
  const snapshots = revisions.filter(revision => revision.source_kind === "cad_snapshot").map(revision => {
    const metadata = JSON.parse(revision.metadata) as CadSnapshot;
    const snapshot = snapshotCadState(metadata.state);
    if (revision.content_hash && revision.content_hash !== snapshot.contentHash) throw new Error("CAD revision content hash mismatch");
    return snapshot;
  });
  if (!snapshots.length) throw new Error("CAD artifact has no snapshot revisions");
  return snapshots;
}
