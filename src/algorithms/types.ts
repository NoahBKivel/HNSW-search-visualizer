/** Shared domain types for the search algorithms. All of these are render-agnostic. */

/** A data point living on the 2D plane. The 3rd dimension in the scene is the HNSW layer. */
export interface Point2D {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

/** Squared Euclidean distance. Monotonic with true distance, so it is safe for ranking. */
export function distanceSq(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Euclidean distance. Used where an absolute magnitude is displayed to the user. */
export function distance(a: Point2D, b: Point2D): number {
  return Math.sqrt(distanceSq(a, b));
}

/** A candidate under consideration during a search, paired with its distance to the query. */
export interface Candidate {
  readonly id: number;
  readonly dist: number;
}

/**
 * One recorded moment of a search, replayed by the animation layer.
 *
 * The algorithms never touch Three.js; they only append these plain objects to a
 * trace. The renderer then interprets the trace as a timeline.
 */
export type SearchEvent =
  /** Search begins at the graph's global entry point, on the top-most populated layer. */
  | { kind: 'enter'; layer: number; node: number; note: string }
  /** A neighbour's distance to the query was computed (one distance evaluation). */
  | { kind: 'evaluate'; layer: number; from: number; to: number; dist: number; improved: boolean }
  /** Greedy step: the frontier moved along an edge to a strictly closer node. */
  | { kind: 'move'; layer: number; from: number; to: number; dist: number; note: string }
  /** A layer converged to a local minimum; the search drops to the layer below. */
  | { kind: 'descend'; fromLayer: number; toLayer: number; node: number; note: string }
  /** Brute-force KNN measured the query against one point. */
  | { kind: 'scan'; node: number; dist: number; inTopK: boolean }
  /** Terminal event: the final ranked neighbour ids. */
  | { kind: 'result'; neighbors: number[]; note: string };

/** A complete, replayable recording of one search run. */
export interface SearchTrace {
  readonly algorithm: 'hnsw' | 'knn';
  readonly query: Point2D;
  readonly events: readonly SearchEvent[];
  /** Number of point-to-point distance computations performed — the cost metric we compare. */
  readonly distanceComputations: number;
  /** Final result ids, best-first. */
  readonly neighbors: readonly number[];
}
