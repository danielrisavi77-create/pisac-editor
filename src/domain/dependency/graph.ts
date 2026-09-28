export const DEPENDENCY_KINDS = ["supports", "used_by", "derived_from", "affects"] as const;
export type DependencyKind = (typeof DEPENDENCY_KINDS)[number];

export type AcademicObjectType = "source" | "claim" | "section" | "decision" | "artifact" | "review";
export type AcademicObjectRef = { type: AcademicObjectType; id: string };

export type DependencyEdge = {
  id: string;
  from: AcademicObjectRef;
  to: AcademicObjectRef;
  kind: DependencyKind;
};

export type ImpactItem = {
  object: AcademicObjectRef;
  depth: number;
  path: readonly DependencyEdge[];
};

function key(ref: AcademicObjectRef): string { return `${ref.type}:${ref.id}`; }

export function createDependencyEdge(edge: DependencyEdge): DependencyEdge {
  if (!edge.id || !edge.from.id || !edge.to.id) throw new Error("createDependencyEdge: missing id");
  if (key(edge.from) === key(edge.to)) throw new Error("createDependencyEdge: self edge");
  if (!DEPENDENCY_KINDS.includes(edge.kind)) throw new Error("createDependencyEdge: invalid kind");
  return { ...edge, from: { ...edge.from }, to: { ...edge.to } };
}

export function analyzeImpact(
  start: AcademicObjectRef,
  edges: readonly DependencyEdge[],
  maxDepth = 8,
): ImpactItem[] {
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1) throw new Error("analyzeImpact: invalid maxDepth");
  const adjacency = new Map<string, DependencyEdge[]>();
  for (const raw of edges) {
    const edge = createDependencyEdge(raw);
    const list = adjacency.get(key(edge.from)) ?? [];
    list.push(edge);
    adjacency.set(key(edge.from), list);
  }

  const seen = new Set<string>([key(start)]);
  const queue: Array<{ object: AcademicObjectRef; depth: number; path: DependencyEdge[] }> = [
    { object: start, depth: 0, path: [] },
  ];
  const result: ImpactItem[] = [];

  while (queue.length) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;
    for (const edge of adjacency.get(key(current.object)) ?? []) {
      const nextKey = key(edge.to);
      if (seen.has(nextKey)) continue;
      seen.add(nextKey);
      const path = [...current.path, edge];
      const item = { object: edge.to, depth: current.depth + 1, path };
      result.push(item);
      queue.push(item);
    }
  }
  return result;
}
