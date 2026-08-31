/**
 * The brute-force baseline: exact K-Nearest Neighbors by exhaustive scan.
 *
 * There is no cleverness here, and that is the point. Every query compares itself
 * against every one of the N points, giving exactly N distance computations and a
 * guaranteed-correct answer. It is the yardstick the HNSW trace is measured
 * against, both for cost (how many distances) and for quality (did the
 * approximate search find the same neighbours?).
 */

import { distanceSq, type Point2D, type SearchEvent, type SearchTrace } from './types';

/**
 * Scans the whole dataset and records a trace.
 *
 * A real brute-force loop visits points in storage order, which looks like random
 * flickering on screen and teaches nothing. Since the set of distances computed is
 * identical either way, we replay the same N computations ordered by distance,
 * which reads as an expanding wavefront radiating from the query. The cost
 * reported (`distanceComputations = N`) is unaffected by the reordering.
 */
export function bruteForceKnn(points: readonly Point2D[], query: Point2D, k: number): SearchTrace {
  const measured = points.map((p) => ({ id: p.id, dist: Math.sqrt(distanceSq(query, p)) }));

  measured.sort((a, b) => a.dist - b.dist);

  const topK = new Set(measured.slice(0, k).map((m) => m.id));

  const events: SearchEvent[] = measured.map((m) => ({
    kind: 'scan' as const,
    node: m.id,
    dist: m.dist,
    inTopK: topK.has(m.id),
  }));

  const neighbors = measured.slice(0, k).map((m) => m.id);

  events.push({
    kind: 'result',
    neighbors,
    note: `Scanned all ${points.length} points — exact top ${neighbors.length}`,
  });

  return {
    algorithm: 'knn',
    query,
    events,
    distanceComputations: points.length,
    neighbors,
  };
}

/**
 * Recall@k of an approximate result against the exact one: the fraction of the
 * true k nearest neighbours that the approximate search actually returned.
 */
export function recall(approximate: readonly number[], exact: readonly number[]): number {
  if (exact.length === 0) return 1;
  const truth = new Set(exact);
  let hits = 0;
  for (const id of approximate) if (truth.has(id)) hits++;
  return hits / exact.length;
}
