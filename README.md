# HNSW vs. KNN — 3D Search Visualizer

An interactive 3D visualization of **HNSW** (Hierarchical Navigable Small World) approximate
nearest-neighbor search, shown side by side with an exact **brute-force KNN** baseline.

The dataset is a cloud of 2D points. The third dimension in the scene is not data — it is the
HNSW layer hierarchy. Base-layer points sit at `z = 0`, and points promoted into upper layers
appear again, higher up, connected to their own copies by vertical links. Watching a query
enter at the sparse top, take a few enormous strides, and spiral down into the dense base layer
is the clearest way to see why HNSW turns an `O(N)` scan into roughly `O(log N)` work.

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
```

| script | what it does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | typecheck, then production build to `dist/` |
| `npm run typecheck` | TypeScript only |
| `npm run verify` | headless correctness suite for the algorithm (see below) |

## What you are looking at

**HNSW mode** animates the real search, one step per recorded event:

1. The query enters the graph at the single **entry point** on the top layer.
2. On each layer it runs a greedy hill-climb (`ef = 1`), hopping to any neighbor closer to the
   query than the current node. Thin yellow lines are individual distance computations; the
   bright white line is the hop actually taken.
3. When a layer has no closer neighbor left, the search has hit a local minimum. It drops to
   the layer below and resumes from there. The layer planes brighten as the search reaches them.
4. On the base layer it widens the beam to `efSearch` candidates and returns the best `k`,
   ringed in green.

**KNN mode** collapses the hierarchy. There is no graph to walk, so the edges disappear
entirely and the query simply measures itself against every single point — drawn as a wavefront
expanding outward with a spoke to each point as its distance is computed. It always finds the
exact answer; it always costs `N` distance computations.

The scoreboard in the top-left keeps both costs on screen at once, plus the resulting speedup
and the **recall@k** of the approximate answer against the exact one.

## Controls

The floating Leva panel in the top-right corner is draggable by its title bar.

| parameter | effect |
| --- | --- |
| **points** | dataset size (20–2500) |
| **layout** | uniform, or six Gaussian clusters |
| **M** | max links per element per layer. Higher `M` means a denser, more navigable graph and a more expensive index |
| **auto m_L** | derive `m_L = 1/ln(M)`, the value the paper recommends |
| **m_L** | level generation multiplier — the knob that decides how aggressively points get promoted upward |
| **max layers (L)** | hard cap on hierarchy height |
| **efConstruction** | beam width while inserting; raises index quality and build cost |
| **algorithm** | HNSW or brute-force KNN |
| **k** | how many neighbors to return |
| **efSearch** | beam width on the base layer at query time — the main recall/speed dial |
| **speed** | playback rate, normalized so a 90-step HNSW walk and a 2500-step scan take similar wall time |
| **run new query** | picks a fresh query point and replays |

Keyboard: `space` play/pause, `←`/`→` step, `R` replay, `N` new query.
Mouse: drag to orbit, scroll to zoom.

## Architecture

Algorithm and rendering are strictly separated. Nothing in `src/algorithms/` imports Three.js,
React, or anything else from the view layer — it could run in Node, a worker, or a test, and in
fact `npm run verify` runs exactly that code headlessly.

```
src/
  algorithms/          pure TypeScript, zero rendering dependencies
    hnsw.ts            index construction + instrumented search (Algorithms 1-5 of the paper)
    knn.ts             exhaustive baseline + recall metric
    heap.ts            one binary heap serving as both the min- and max-heap SEARCH-LAYER needs
    dataset.ts         seeded, prefix-stable point generation
    random.ts          mulberry32 + labelled seed streams
    playback.ts        turns a search trace into a scrubbable timeline
    types.ts           points, distances, and the SearchEvent union
  hooks/
    useSimulation.ts   memoized pipeline: dataset -> index -> searches -> timelines
    usePlayback.ts     the animation clock
    useDebouncedValue.ts
  viz/                 React Three Fiber components
    Scene.tsx          composition root
    NodeCloud.tsx      one instanced mesh for every (node, layer) pair
    GraphEdges.tsx     intra-layer links per layer, plus vertical promotion links
    LayerPlanes.tsx    the slabs that give the Z axis meaning
    SearchOverlay.tsx  hops, probes, wavefront, query marker, result halos
    theme.ts           colors and the single algorithm-space -> world-space mapping
  ui/                  DOM overlays
    useControlPanel.ts Leva schema
    StatsPanel.tsx     the HNSW-vs-KNN scoreboard
    TransportBar.tsx   scrubber and step narration
    Legend.tsx
```

### How the search animation works

The algorithm never knows it is being watched. `HnswIndex.search()` optionally appends plain
`SearchEvent` objects — `enter`, `evaluate`, `move`, `descend`, `result` — to an array as it
runs. `buildTimeline()` then converts that trace into a random-access structure the renderer can
scrub in either direction.

The trick that keeps it fast is inversion. Snapshotting the visited set at every step would cost
`O(events x N)` memory. Instead each node stores the single event index at which it was first
touched, so "was node `i` visited by step `s`?" is the `O(1)` test `firstTouch[i] <= s`, and
`s - firstTouch[i]` doubles as the age driving the highlight fade. All per-frame color and scale
work is written directly into instanced buffers from `useFrame`; React re-renders only when the
graph itself changes.

## Verifying the algorithm

A pretty scene can hide a broken index, so the implementation is checked headlessly:

```bash
npm run verify
```

It builds indexes across six parameter regimes (including the degenerate single-layer and
five-point cases), and asserts that links are bidirectional, degree caps hold (`Mmax0 = 2M` on
the base layer), no node is orphaned, layer occupancy decreases with height, results come back
sorted, and mean recall clears a per-scenario floor. It finishes with a scaling table:

```
N= 250  ->   94 distances/query  (37.5% of N)
N= 500  ->  103 distances/query  (20.6% of N)
N=1000  ->  114 distances/query  (11.4% of N)
N=2000  ->  123 distances/query  ( 6.1% of N)
N=4000  ->  127 distances/query  ( 3.2% of N)
```

16x the data for 1.4x the work — the whole reason HNSW exists.

`scripts/screenshot.mjs` is a development aid that drives the running dev server in a real
browser — it plays through both modes, exercises the sliders, reports any console errors, and
writes screenshots to `shots/`. It needs an installed Chrome or Edge and is not part of the app.

## Reference

Yu. A. Malkov, D. A. Yashunin, *Efficient and robust approximate nearest neighbor search using
Hierarchical Navigable Small World graphs*, [arXiv:1603.09320](https://arxiv.org/abs/1603.09320).
Algorithm numbers in the source comments refer to that paper.
