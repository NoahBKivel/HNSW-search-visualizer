/**
 * Headless sanity check for the HNSW implementation.
 *
 * The 3D scene can look convincing while the index is quietly wrong, so this
 * script exercises the algorithm on its own: it builds indexes across a range of
 * parameters, compares every query against the exhaustive baseline, and asserts on
 * recall, graph invariants, and the cost saving that is the whole premise of the
 * visualization.
 *
 * Run with: npm run verify
 */

import { generateDataset } from '../src/algorithms/dataset';
import { HnswIndex, suggestedML } from '../src/algorithms/hnsw';
import { bruteForceKnn, recall } from '../src/algorithms/knn';
import { buildTimeline } from '../src/algorithms/playback';
import { randomUint32 } from '../src/algorithms/random';
import { distance, type Point2D } from '../src/algorithms/types';

let failures = 0;

function check(label: string, condition: boolean, detail = '') {
  const status = condition ? 'PASS' : 'FAIL';
  if (!condition) failures++;
  console.log(`  [${status}] ${label}${detail ? ` — ${detail}` : ''}`);
}

interface Scenario {
  name: string;
  count: number;
  M: number;
  maxLayers: number;
  efConstruction: number;
  efSearch: number;
  k: number;
  distribution: 'uniform' | 'clustered';
  minRecall: number;
}

const scenarios: Scenario[] = [
  { name: 'uniform / default', count: 400, M: 8, maxLayers: 5, efConstruction: 32, efSearch: 16, k: 5, distribution: 'uniform', minRecall: 0.85 },
  { name: 'uniform / large ef', count: 800, M: 12, maxLayers: 6, efConstruction: 64, efSearch: 64, k: 10, distribution: 'uniform', minRecall: 0.95 },
  { name: 'clustered', count: 600, M: 10, maxLayers: 5, efConstruction: 48, efSearch: 32, k: 5, distribution: 'clustered', minRecall: 0.9 },
  { name: 'minimal M', count: 300, M: 3, maxLayers: 4, efConstruction: 16, efSearch: 16, k: 3, distribution: 'uniform', minRecall: 0.5 },
  { name: 'single layer (degenerate)', count: 200, M: 8, maxLayers: 1, efConstruction: 32, efSearch: 32, k: 5, distribution: 'uniform', minRecall: 0.9 },
  { name: 'tiny dataset', count: 5, M: 8, maxLayers: 4, efConstruction: 32, efSearch: 16, k: 3, distribution: 'uniform', minRecall: 1 },
];

const QUERIES = 40;

for (const scenario of scenarios) {
  console.log(`\n${scenario.name}  (N=${scenario.count}, M=${scenario.M}, L=${scenario.maxLayers})`);

  const points = generateDataset({ count: scenario.count, seed: 42, distribution: scenario.distribution });
  const index = new HnswIndex(points, {
    M: scenario.M,
    mL: suggestedML(scenario.M),
    maxLayers: scenario.maxLayers,
    efConstruction: scenario.efConstruction,
    seed: 42,
  });

  // --- Graph invariants ----------------------------------------------------
  let asymmetric = 0;
  let overDegree = 0;
  let missingBaseNode = 0;
  let selfLoop = 0;

  for (let layer = 0; layer <= index.topLayerIndex; layer++) {
    const maxDegree = layer === 0 ? scenario.M * 2 : scenario.M;
    for (const point of points) {
      const level = index.levels[point.id] ?? 0;
      const neighbours = index.neighbors(point.id, layer);

      if (layer === 0 && level >= 0 && neighbours.length === 0 && points.length > 1) missingBaseNode++;
      if (level < layer && neighbours.length > 0) missingBaseNode++;
      if (neighbours.length > maxDegree) overDegree++;
      if (neighbours.includes(point.id)) selfLoop++;

      for (const other of neighbours) {
        if (!index.neighbors(other, layer).includes(point.id)) asymmetric++;
      }
    }
  }

  check('links are bidirectional', asymmetric === 0, `${asymmetric} one-way links`);
  check('degree caps respected (Mmax0 = 2M)', overDegree === 0, `${overDegree} over-connected nodes`);
  check('no self-loops', selfLoop === 0, `${selfLoop} self-loops`);
  check('every point is connected on the base layer', missingBaseNode === 0, `${missingBaseNode} orphans`);
  check(
    'layer count respects the cap',
    index.topLayerIndex < scenario.maxLayers,
    `top layer = ${index.topLayerIndex}`,
  );

  // Occupancy should thin out going up — that is the whole point of the hierarchy.
  const stats = index.stats();
  const occupancy = stats.nodesPerLayer.slice(0, index.topLayerIndex + 1);
  const monotonic = occupancy.every((n, i) => i === 0 || n <= occupancy[i - 1]!);
  check('layer occupancy decreases with height', monotonic, occupancy.join(' -> '));

  // --- Recall and cost against the exact baseline --------------------------
  let recallSum = 0;
  let hnswCost = 0;
  let knnCost = 0;
  let worstRecall = 1;

  for (let q = 0; q < QUERIES; q++) {
    const query: Point2D = { id: -1, x: ((q * 37) % 100) / 100 * 24 - 12, y: ((q * 61) % 100) / 100 * 24 - 12 };

    const approx = index.search(query, scenario.k, scenario.efSearch);
    const exact = bruteForceKnn(points, query, scenario.k);

    // Results must come back sorted by distance, best first.
    const distances = approx.neighbors.map((id) => distance(query, points[id]!));
    const sorted = distances.every((d, i) => i === 0 || d >= distances[i - 1]! - 1e-9);
    if (!sorted) {
      check('results sorted nearest-first', false, `query ${q}`);
      break;
    }

    const r = recall(approx.neighbors, exact.neighbors);
    recallSum += r;
    worstRecall = Math.min(worstRecall, r);
    hnswCost += approx.distanceComputations;
    knnCost += exact.distanceComputations;

    if (q === 0) {
      const timeline = buildTimeline(approx, points.length);
      check(
        'timeline covers every event',
        timeline.length === approx.events.length && timeline.length > 0,
        `${timeline.length} frames`,
      );
      check(
        'timeline distance count matches the trace',
        timeline.frames[timeline.length - 1]!.distanceCount <= approx.distanceComputations,
        `${timeline.frames[timeline.length - 1]!.distanceCount} vs ${approx.distanceComputations}`,
      );
    }
  }

  const avgRecall = recallSum / QUERIES;
  check(
    `mean recall@${scenario.k} >= ${scenario.minRecall}`,
    avgRecall >= scenario.minRecall,
    `${(avgRecall * 100).toFixed(1)}% (worst query ${(worstRecall * 100).toFixed(0)}%)`,
  );

  const speedup = knnCost / hnswCost;
  const shouldBeFaster = scenario.count >= 200 && scenario.maxLayers > 1;
  check(
    shouldBeFaster ? 'cheaper than brute force' : 'cost recorded',
    !shouldBeFaster || speedup > 1,
    `${(hnswCost / QUERIES).toFixed(0)} vs ${(knnCost / QUERIES).toFixed(0)} distances/query (${speedup.toFixed(1)}x)`,
  );
}

function samePoints(a: Point2D[], b: Point2D[]): boolean {
  return a.length === b.length && a.every((p, i) => p.id === b[i]!.id && p.x === b[i]!.x && p.y === b[i]!.y);
}

// --- Dataset seeds: the same number must always rebuild the same cloud ------
console.log('\ndataset seed reproducibility');
{
  const uniformA = generateDataset({ count: 100, seed: 42, distribution: 'uniform' });
  const uniformB = generateDataset({ count: 100, seed: 42, distribution: 'uniform' });
  const uniformOther = generateDataset({ count: 100, seed: 43, distribution: 'uniform' });
  const clusteredA = generateDataset({ count: 100, seed: 42, distribution: 'clustered' });
  const clusteredB = generateDataset({ count: 100, seed: 42, distribution: 'clustered' });

  check('same seed + uniform yields identical points', samePoints(uniformA, uniformB));
  check('different seed yields a different uniform cloud', !samePoints(uniformA, uniformOther));
  check('same seed + clustered yields identical points', samePoints(clusteredA, clusteredB));
  check('same seed uniform vs clustered differ', !samePoints(uniformA, clusteredA));

  const samples = [randomUint32(), randomUint32(), randomUint32()];
  check(
    'randomUint32 returns unsigned 32-bit integers',
    samples.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff),
    samples.join(', '),
  );
}

// --- Scaling: the headline claim is sub-linear query cost -------------------
console.log('\nquery cost scaling (M=12, efSearch=32, k=5)');
const costs: { n: number; cost: number }[] = [];
for (const n of [250, 500, 1000, 2000, 4000]) {
  const points = generateDataset({ count: n, seed: 7, distribution: 'uniform' });
  const index = new HnswIndex(points, { M: 12, mL: suggestedML(12), maxLayers: 8, efConstruction: 48, seed: 7 });

  let total = 0;
  for (let q = 0; q < 25; q++) {
    const query: Point2D = { id: -1, x: ((q * 53) % 100) / 100 * 22 - 11, y: ((q * 29) % 100) / 100 * 22 - 11 };
    total += index.search(query, 5, 32).distanceComputations;
  }
  const cost = total / 25;
  costs.push({ n, cost });
  console.log(`  N=${String(n).padStart(4)}  ->  ${cost.toFixed(0)} distances/query  (${((cost / n) * 100).toFixed(1)}% of N)`);
}

// A 16x growth in N must not cost 16x more work; log-like growth stays well under.
const first = costs[0]!;
const last = costs[costs.length - 1]!;
const growth = last.cost / first.cost;
const nGrowth = last.n / first.n;
check(
  'query cost grows far slower than N',
  growth < nGrowth / 3,
  `${nGrowth}x more points cost only ${growth.toFixed(1)}x more distances`,
);

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
