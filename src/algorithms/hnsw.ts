/**
 * HNSW — Hierarchical Navigable Small World graphs.
 *
 * Reference: Malkov & Yashunin, "Efficient and robust approximate nearest neighbor
 * search using Hierarchical Navigable Small World graphs" (2016), arXiv:1603.09320.
 * Algorithm numbers quoted below refer to that paper.
 *
 * ---------------------------------------------------------------------------
 * THE IDEA IN ONE PARAGRAPH
 * ---------------------------------------------------------------------------
 * A brute-force KNN scan touches all N points, so it costs O(N) distance
 * computations per query. HNSW instead builds a *navigable* proximity graph and
 * walks it greedily, which would still be slow on a flat graph because greedy
 * walks take many small hops. So HNSW stacks several graphs: layer 0 holds every
 * point with short, dense links, and each layer above holds an exponentially
 * thinning random sample of the points with correspondingly longer links. A query
 * enters at the sparse top, takes a few enormous strides to land in roughly the
 * right region, then descends layer by layer refining its position. It is a skip
 * list generalised from 1D to a metric space, and it turns O(N) into
 * O(log N) distance computations.
 *
 * This file is deliberately free of any rendering concern. It computes a graph
 * and, on request, records a search as a list of plain {@link SearchEvent}
 * objects that the React/Three.js layer replays as an animation.
 */

import { CandidateHeap } from './heap';
import { mulberry32, streamSeed } from './random';
import { distance, distanceSq, type Candidate, type Point2D, type SearchEvent, type SearchTrace } from './types';

export interface HnswParams {
  /** M — target number of bidirectional links created for each new element per layer. */
  M: number;
  /**
   * m_L — the level generation multiplier (called `mL` in the paper).
   * Larger values push more points into upper layers. The paper's rule of thumb is
   * m_L = 1 / ln(M), which minimises the expected overlap between layers.
   */
  mL: number;
  /** Hard cap on the number of layers, so the visualization stays legible. */
  maxLayers: number;
  /** efConstruction — size of the dynamic candidate list used while inserting. */
  efConstruction: number;
  /** Seed for the level-assignment stream. */
  seed: number;
}

/** An undirected link between two nodes, resident on a specific layer. */
export interface LayerEdge {
  readonly a: number;
  readonly b: number;
  readonly layer: number;
}

export interface HnswBuildStats {
  /** Distance computations spent constructing the index. */
  distanceComputations: number;
  /** Number of undirected edges per layer, indexed by layer. */
  edgesPerLayer: number[];
  /** Number of resident nodes per layer, indexed by layer. */
  nodesPerLayer: number[];
}

/** The suggested m_L for a given M, per section 4.1 of the paper. */
export function suggestedML(M: number): number {
  return 1 / Math.log(Math.max(2, M));
}

export class HnswIndex {
  readonly points: readonly Point2D[];
  readonly params: HnswParams;

  /** `levels[i]` is the top layer on which node `i` is resident (0 means base layer only). */
  readonly levels: number[] = [];

  /**
   * Adjacency, indexed as `graph[layer].get(nodeId) -> neighbour ids`.
   * Links are undirected: if `a` lists `b`, then `b` lists `a`.
   */
  private readonly graph: Map<number, number[]>[] = [];

  /** Global entry point: the node sitting on the highest occupied layer. */
  private entryPoint = -1;
  /** Index of the highest occupied layer. */
  private topLayer = -1;

  private distanceComputations = 0;

  constructor(points: readonly Point2D[], params: HnswParams) {
    this.points = points;
    this.params = params;

    for (let l = 0; l < params.maxLayers; l++) this.graph.push(new Map());

    for (const point of points) this.insert(point);
  }

  // ---------------------------------------------------------------------------
  // Public accessors used by the visualization
  // ---------------------------------------------------------------------------

  get entryPointId(): number {
    return this.entryPoint;
  }

  get topLayerIndex(): number {
    return this.topLayer;
  }

  /** Neighbours of `id` on layer `layer`, or an empty array if it is not resident there. */
  neighbors(id: number, layer: number): readonly number[] {
    return this.graph[layer]?.get(id) ?? [];
  }

  /** Every undirected edge in the hierarchy, deduplicated (`a < b`). */
  allEdges(): LayerEdge[] {
    const edges: LayerEdge[] = [];
    for (let layer = 0; layer < this.graph.length; layer++) {
      for (const [a, neighbours] of this.graph[layer]!) {
        for (const b of neighbours) {
          if (a < b) edges.push({ a, b, layer });
        }
      }
    }
    return edges;
  }

  stats(): HnswBuildStats {
    const edgesPerLayer = new Array<number>(this.params.maxLayers).fill(0);
    const nodesPerLayer = new Array<number>(this.params.maxLayers).fill(0);
    for (let layer = 0; layer < this.graph.length; layer++) {
      for (const [a, neighbours] of this.graph[layer]!) {
        nodesPerLayer[layer]! += 1;
        for (const b of neighbours) if (a < b) edgesPerLayer[layer]! += 1;
      }
    }
    return { distanceComputations: this.distanceComputations, edgesPerLayer, nodesPerLayer };
  }

  // ---------------------------------------------------------------------------
  // Distance
  // ---------------------------------------------------------------------------

  /**
   * Every distance evaluation in the index funnels through here so we can count
   * them — that counter is the whole point of the HNSW-vs-KNN comparison.
   * Squared distance is used internally because it ranks identically to the true
   * distance while avoiding a square root per call.
   */
  private dist(a: Point2D, b: Point2D): number {
    this.distanceComputations++;
    return distanceSq(a, b);
  }

  // ---------------------------------------------------------------------------
  // Level assignment
  // ---------------------------------------------------------------------------

  /**
   * Draws the maximum layer for a new element (Algorithm 1, line 4):
   *
   *     l = floor( -ln(U(0,1)) * m_L )
   *
   * `-ln(U)` is an Exponential(1) variate, so `l` follows a geometric-like
   * distribution: P(level >= k) decays as exp(-k / m_L). With the recommended
   * m_L = 1/ln(M) the expected number of points on layer k shrinks by a factor of
   * M each level up, which is exactly the skip-list-style thinning HNSW relies on.
   *
   * The draw is keyed by node id rather than taken from a running stream, so a
   * point keeps its level when the user adds more points to the dataset.
   */
  private assignLevel(id: number): number {
    const rng = mulberry32(streamSeed(this.params.seed, `level-${id}`));
    // 1 - rng() keeps the argument of the log inside (0, 1], avoiding log(0) = -Infinity.
    const level = Math.floor(-Math.log(1 - rng()) * this.params.mL);
    return Math.min(level, this.params.maxLayers - 1);
  }

  // ---------------------------------------------------------------------------
  // Algorithm 2 — SEARCH-LAYER
  // ---------------------------------------------------------------------------

  /**
   * Best-first (greedy) search restricted to a single layer.
   *
   *   C — min-heap of candidates still to expand, nearest to the query on top.
   *   W — max-heap of the best `ef` results found so far, *farthest* on top so the
   *       worst result can be evicted in O(log ef).
   *
   * The loop expands the closest unexplored candidate; it stops as soon as that
   * candidate is farther away than the worst element already in W, because the
   * graph is traversed in order of increasing distance and nothing better can lie
   * behind it. `ef = 1` degenerates to a plain greedy hill-climb, which is what the
   * upper layers use; layer 0 uses `ef > 1` to widen the beam and raise recall.
   */
  private searchLayer(
    query: Point2D,
    entryPoints: readonly number[],
    ef: number,
    layer: number,
    trace?: SearchEvent[],
  ): Candidate[] {
    const visited = new Set<number>(entryPoints);
    const candidates = new CandidateHeap('min');
    const results = new CandidateHeap('max');

    for (const ep of entryPoints) {
      const d = this.dist(query, this.points[ep]!);
      candidates.push({ id: ep, dist: d });
      results.push({ id: ep, dist: d });
    }

    // The nearest node seen so far on this layer; only used to narrate the walk.
    let bestSoFar = results.toSortedArray()[0] ?? { id: entryPoints[0] ?? -1, dist: Infinity };

    while (candidates.size > 0) {
      const nearest = candidates.pop()!;
      const furthest = results.peek()!;

      // Stopping condition (Algorithm 2, line 8): every remaining candidate is
      // farther than the current worst result, so the result set cannot improve.
      if (nearest.dist > furthest.dist) break;

      for (const neighbour of this.neighbors(nearest.id, layer)) {
        if (visited.has(neighbour)) continue;
        visited.add(neighbour);

        const d = this.dist(query, this.points[neighbour]!);
        const worst = results.peek()!;
        const accepted = d < worst.dist || results.size < ef;

        trace?.push({
          kind: 'evaluate',
          layer,
          from: nearest.id,
          to: neighbour,
          dist: Math.sqrt(d),
          improved: accepted,
        });

        if (!accepted) continue;

        candidates.push({ id: neighbour, dist: d });
        results.push({ id: neighbour, dist: d });
        if (results.size > ef) results.pop(); // evict the farthest

        // Narration: a strict improvement on the layer's best is the "greedy hop"
        // the animation draws as a travelling pulse along the edge.
        if (d < bestSoFar.dist) {
          trace?.push({
            kind: 'move',
            layer,
            from: bestSoFar.id,
            to: neighbour,
            dist: Math.sqrt(d),
            note: `Layer ${layer}: hop to node ${neighbour} (${Math.sqrt(d).toFixed(2)} from query)`,
          });
          bestSoFar = { id: neighbour, dist: d };
        }
      }
    }

    return results.toSortedArray();
  }

  // ---------------------------------------------------------------------------
  // Algorithm 4 — SELECT-NEIGHBORS-HEURISTIC
  // ---------------------------------------------------------------------------

  /**
   * Chooses which `M` of the found candidates a new element should actually link to.
   *
   * Taking the M literally-nearest candidates is tempting but produces clumped,
   * redundant links: if three candidates sit in the same tight cluster, all three
   * links lead to the same place. The heuristic instead keeps a candidate `e` only
   * when it is closer to the query than to every neighbour already selected:
   *
   *     accept e  <=>  d(e, q) < min over r in R of d(e, r)
   *
   * This is the relative-neighbourhood rule. It spreads the links out over distinct
   * directions and, crucially, preserves the long-range "shortcut" edges that make
   * the graph navigable — without them a greedy walk gets stuck in local minima.
   *
   * @param candidates each entry's `dist` must already be its distance to the base
   *        element, which is why the base element itself is not needed here.
   * @param keepPrunedConnections top up the result with the best rejected candidates,
   *        so an element still reaches its full M degree in sparse regions.
   */
  private selectNeighborsHeuristic(
    candidates: readonly Candidate[],
    M: number,
    keepPrunedConnections = true,
  ): number[] {
    const working = new CandidateHeap('min');
    for (const c of candidates) working.push(c);

    const selected: number[] = [];
    const discarded: Candidate[] = [];

    while (working.size > 0 && selected.length < M) {
      const candidate = working.pop()!;
      const candidatePoint = this.points[candidate.id]!;

      // `candidate.dist` is d(candidate, base). Accept only if no already-selected
      // neighbour lies between the candidate and the base element.
      let closerToBaseThanToSelected = true;
      for (const chosen of selected) {
        if (this.dist(candidatePoint, this.points[chosen]!) < candidate.dist) {
          closerToBaseThanToSelected = false;
          break;
        }
      }

      if (closerToBaseThanToSelected) selected.push(candidate.id);
      else discarded.push(candidate);
    }

    if (keepPrunedConnections) {
      discarded.sort((a, b) => a.dist - b.dist);
      for (const c of discarded) {
        if (selected.length >= M) break;
        selected.push(c.id);
      }
    }

    return selected;
  }

  // ---------------------------------------------------------------------------
  // Algorithm 1 — INSERT
  // ---------------------------------------------------------------------------

  private insert(point: Point2D): void {
    const id = point.id;
    const level = this.assignLevel(id);
    this.levels[id] = level;

    // First element ever inserted: it simply becomes the entry point.
    if (this.entryPoint === -1) {
      for (let l = 0; l <= level; l++) this.graph[l]!.set(id, []);
      this.entryPoint = id;
      this.topLayer = level;
      return;
    }

    let entryPoints = [this.entryPoint];

    // Phase 1 — Zoom in. From the top of the hierarchy down to just above the new
    // element's own level, run a plain greedy walk (ef = 1) and carry the nearest
    // node found forward as the entry point for the next layer down. No links are
    // created here; this phase only positions the search.
    for (let layer = this.topLayer; layer > level; layer--) {
      const found = this.searchLayer(point, entryPoints, 1, layer);
      if (found.length > 0) entryPoints = [found[0]!.id];
    }

    // Phase 2 — Connect. On every layer the new element is resident on, search with
    // the wider `efConstruction` beam, pick M neighbours with the heuristic, and
    // wire them up bidirectionally.
    const startLayer = Math.min(this.topLayer, level);
    for (let layer = startLayer; layer >= 0; layer--) {
      const found = this.searchLayer(point, entryPoints, this.params.efConstruction, layer);

      // Layer 0 is allowed twice the degree of the upper layers (Mmax0 = 2M in the
      // paper): it carries every point, so it needs the extra connectivity.
      const maxDegree = layer === 0 ? this.params.M * 2 : this.params.M;
      const chosen = this.selectNeighborsHeuristic(found, this.params.M);

      this.graph[layer]!.set(id, [...chosen]);
      for (const neighbourId of chosen) {
        this.link(neighbourId, id, layer);
        this.shrinkIfNeeded(neighbourId, layer, maxDegree);
      }

      // The results of this layer seed the search on the layer below.
      entryPoints = found.map((c) => c.id);
      if (entryPoints.length === 0) entryPoints = [this.entryPoint];
    }

    // If the new element was drawn into a layer above everything else, it becomes
    // the graph's entry point — the single node every future query starts from.
    if (level > this.topLayer) {
      for (let l = this.topLayer + 1; l <= level; l++) this.graph[l]!.set(id, []);
      this.topLayer = level;
      this.entryPoint = id;
    }
  }

  private link(from: number, to: number, layer: number): void {
    const adjacency = this.graph[layer]!;
    const list = adjacency.get(from);
    if (!list) adjacency.set(from, [to]);
    else if (!list.includes(to)) list.push(to);
  }

  /**
   * Enforces the degree cap after a new bidirectional link pushed a node over it
   * (Algorithm 1, lines 13-15). Rather than dropping the newest link, the node
   * re-runs the selection heuristic over all of its current neighbours, so it keeps
   * the best-spread subset instead of an arbitrary one.
   */
  private shrinkIfNeeded(id: number, layer: number, maxDegree: number): void {
    const adjacency = this.graph[layer]!;
    const list = adjacency.get(id);
    if (!list || list.length <= maxDegree) return;

    const self = this.points[id]!;
    const candidates: Candidate[] = list.map((n) => ({
      id: n,
      dist: this.dist(self, this.points[n]!),
    }));

    const kept = this.selectNeighborsHeuristic(candidates, maxDegree);
    adjacency.set(id, kept);

    // Links are undirected, so anything pruned must forget this node too.
    const keptSet = new Set(kept);
    for (const n of list) {
      if (keptSet.has(n)) continue;
      const reverse = adjacency.get(n);
      if (reverse) adjacency.set(n, reverse.filter((x) => x !== id));
    }
  }

  // ---------------------------------------------------------------------------
  // Algorithm 5 — K-NN-SEARCH (instrumented for playback)
  // ---------------------------------------------------------------------------

  /**
   * Answers a query and records every step as a replayable trace.
   *
   * The shape of the search mirrors construction: a greedy `ef = 1` descent through
   * the sparse upper layers to get into the right neighbourhood cheaply, then one
   * wide `ef = efSearch` sweep on the dense base layer to actually rank the results.
   */
  search(query: Point2D, k: number, efSearch: number): SearchTrace {
    const events: SearchEvent[] = [];
    const before = this.distanceComputations;

    if (this.entryPoint === -1) {
      return { algorithm: 'hnsw', query, events, distanceComputations: 0, neighbors: [] };
    }

    let entryPoints = [this.entryPoint];
    events.push({
      kind: 'enter',
      layer: this.topLayer,
      node: this.entryPoint,
      note: `Enter at node ${this.entryPoint} on the top layer (L=${this.topLayer})`,
    });

    // Coarse phase: one greedy hill-climb per layer, each ending in a local minimum
    // that becomes the entry point one layer down.
    for (let layer = this.topLayer; layer > 0; layer--) {
      const found = this.searchLayer(query, entryPoints, 1, layer, events);
      const nearest = found[0];
      if (nearest) entryPoints = [nearest.id];

      events.push({
        kind: 'descend',
        fromLayer: layer,
        toLayer: layer - 1,
        node: entryPoints[0]!,
        note: `Layer ${layer} converged at node ${entryPoints[0]} — drop to layer ${layer - 1}`,
      });
    }

    // Fine phase: widen the beam on the base layer. ef must be at least k for the
    // result set to be able to hold k answers.
    const ef = Math.max(k, efSearch);
    const found = this.searchLayer(query, entryPoints, ef, 0, events);
    const neighbors = found.slice(0, k).map((c) => c.id);

    events.push({
      kind: 'result',
      neighbors,
      note: `Base layer done — returning top ${neighbors.length} of ${found.length} candidates`,
    });

    return {
      algorithm: 'hnsw',
      query,
      events,
      distanceComputations: this.distanceComputations - before,
      neighbors,
    };
  }

  /** Convenience for the stats panel: true distance from the query to a node. */
  distanceTo(query: Point2D, id: number): number {
    return distance(query, this.points[id]!);
  }
}
