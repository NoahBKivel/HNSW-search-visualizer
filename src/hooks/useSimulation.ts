import { useMemo } from 'react';
import { generateDataset, generateQuery, type Distribution } from '../algorithms/dataset';
import { HnswIndex, type LayerEdge } from '../algorithms/hnsw';
import { bruteForceKnn, recall } from '../algorithms/knn';
import { buildTimeline, type Timeline } from '../algorithms/playback';
import type { Point2D } from '../algorithms/types';

export interface SimulationParams {
  pointCount: number;
  distribution: Distribution;
  datasetSeed: number;
  M: number;
  mL: number;
  maxLayers: number;
  efConstruction: number;
  k: number;
  efSearch: number;
  querySeed: number;
}

export interface SimulationResult {
  points: Point2D[];
  index: HnswIndex;
  query: Point2D;
  /** Links inside a single layer — the "navigable small world" part. */
  intraLayerEdges: LayerEdge[];
  /** Links between a node's copies on consecutive layers — the "hierarchical" part. */
  interLayerEdges: LayerEdge[];
  hnswTimeline: Timeline;
  knnTimeline: Timeline;
  metrics: {
    hnswDistanceComputations: number;
    knnDistanceComputations: number;
    speedup: number;
    recall: number;
    buildDistanceComputations: number;
    buildMs: number;
    topLayer: number;
    nodesPerLayer: number[];
    edgesPerLayer: number[];
  };
}

/**
 * Runs the whole pipeline — dataset, index build, both searches, both timelines —
 * and memoizes each stage on exactly the inputs it depends on.
 *
 * The dependency split matters for interactivity: changing `k` re-runs only the
 * searches, and moving the query re-runs only the searches, while the expensive
 * index build is reused. Only the structural parameters force a rebuild.
 */
export function useSimulation(params: SimulationParams): SimulationResult {
  const { pointCount, distribution, datasetSeed, M, mL, maxLayers, efConstruction, k, efSearch, querySeed } =
    params;

  const points = useMemo(
    () => generateDataset({ count: pointCount, seed: datasetSeed, distribution }),
    [pointCount, datasetSeed, distribution],
  );

  const { index, buildMs } = useMemo(() => {
    const started = performance.now();
    const built = new HnswIndex(points, { M, mL, maxLayers, efConstruction, seed: datasetSeed });
    return { index: built, buildMs: performance.now() - started };
  }, [points, M, mL, maxLayers, efConstruction, datasetSeed]);

  const { intraLayerEdges, interLayerEdges } = useMemo(() => {
    const intra = index.allEdges();

    // A promoted node is drawn once per layer it lives on; the vertical links make
    // those copies read as one element rather than several unrelated points.
    const inter: LayerEdge[] = [];
    for (const point of points) {
      const level = index.levels[point.id] ?? 0;
      for (let layer = 0; layer < level; layer++) {
        inter.push({ a: point.id, b: point.id, layer });
      }
    }
    return { intraLayerEdges: intra, interLayerEdges: inter };
  }, [index, points]);

  const query = useMemo(() => generateQuery(querySeed), [querySeed]);

  const hnswTrace = useMemo(() => index.search(query, k, efSearch), [index, query, k, efSearch]);
  const knnTrace = useMemo(() => bruteForceKnn(points, query, k), [points, query, k]);

  const hnswTimeline = useMemo(() => buildTimeline(hnswTrace, points.length), [hnswTrace, points.length]);
  const knnTimeline = useMemo(() => buildTimeline(knnTrace, points.length), [knnTrace, points.length]);

  const metrics = useMemo(() => {
    const buildStats = index.stats();
    const hnswCost = Math.max(1, hnswTrace.distanceComputations);
    return {
      hnswDistanceComputations: hnswTrace.distanceComputations,
      knnDistanceComputations: knnTrace.distanceComputations,
      speedup: knnTrace.distanceComputations / hnswCost,
      recall: recall(hnswTrace.neighbors, knnTrace.neighbors),
      buildDistanceComputations: buildStats.distanceComputations,
      buildMs,
      topLayer: index.topLayerIndex,
      nodesPerLayer: buildStats.nodesPerLayer,
      edgesPerLayer: buildStats.edgesPerLayer,
    };
  }, [index, hnswTrace, knnTrace, buildMs]);

  return { points, index, query, intraLayerEdges, interLayerEdges, hnswTimeline, knnTimeline, metrics };
}
