/**
 * Turns a {@link SearchTrace} into a random-access timeline the renderer can scrub.
 *
 * The naive approach — snapshotting the full visited-set at every step — costs
 * O(events x N) memory. Instead we invert it: each node records the single event
 * index at which it was first touched. "Was node i visited by step s?" then becomes
 * `firstTouch[i] <= s`, an O(1) test the render loop can run per node per frame,
 * and `s - firstTouch[i]` conveniently doubles as the age used to fade out the
 * highlight pulse.
 */

import type { SearchEvent, SearchTrace } from './types';

/** An edge drawn while the search runs. */
export interface TimelineEdge {
  readonly from: number;
  readonly to: number;
  readonly layer: number;
  /** Event index at which this edge appears. */
  readonly at: number;
}

/** Per-step scalar state. Cheap enough to precompute one per event. */
export interface TimelineFrame {
  readonly at: number;
  readonly kind: SearchEvent['kind'];
  /** Layer currently in focus. Always 0 for the flat KNN baseline. */
  readonly layer: number;
  /** The node the camera / highlight should centre on. */
  readonly focus: number;
  /** Running count of distance computations up to and including this step. */
  readonly distanceCount: number;
  /** Radius of the KNN scan wavefront; 0 for HNSW. */
  readonly radius: number;
  /** Human-readable narration shown in the HUD. */
  readonly caption: string;
}

export interface Timeline {
  readonly trace: SearchTrace;
  readonly length: number;
  readonly frames: readonly TimelineFrame[];
  /** `firstTouch[id]` = event index of the first distance computation involving node `id`. */
  readonly firstTouch: Float64Array;
  /** `touchDist[id]` = that node's distance to the query, or NaN if never measured. */
  readonly touchDist: Float64Array;
  /** Greedy hops: the spine of the HNSW walk. */
  readonly hops: readonly TimelineEdge[];
  /** Probes: every neighbour link whose distance was evaluated. */
  readonly probes: readonly TimelineEdge[];
  /** Final answer ids, best-first. */
  readonly neighbors: readonly number[];
}

export function buildTimeline(trace: SearchTrace, nodeCount: number): Timeline {
  const firstTouch = new Float64Array(nodeCount).fill(Number.POSITIVE_INFINITY);
  const touchDist = new Float64Array(nodeCount).fill(Number.NaN);
  const hops: TimelineEdge[] = [];
  const probes: TimelineEdge[] = [];
  const frames: TimelineFrame[] = [];

  let layer = 0;
  let focus = -1;
  let distanceCount = 0;
  let radius = 0;

  const touch = (id: number, at: number, dist: number) => {
    if (id < 0 || id >= nodeCount) return;
    if (firstTouch[id] === Number.POSITIVE_INFINITY) {
      firstTouch[id] = at;
      touchDist[id] = dist;
    }
  };

  trace.events.forEach((event, at) => {
    let caption = '';

    switch (event.kind) {
      case 'enter': {
        layer = event.layer;
        focus = event.node;
        distanceCount++;
        touch(event.node, at, 0);
        caption = event.note;
        break;
      }
      case 'evaluate': {
        layer = event.layer;
        focus = event.from;
        distanceCount++;
        touch(event.to, at, event.dist);
        probes.push({ from: event.from, to: event.to, layer: event.layer, at });
        caption = event.improved
          ? `Evaluate node ${event.to} — d=${event.dist.toFixed(2)}, accepted into the candidate list`
          : `Evaluate node ${event.to} — d=${event.dist.toFixed(2)}, too far, discarded`;
        break;
      }
      case 'move': {
        layer = event.layer;
        focus = event.to;
        hops.push({ from: event.from, to: event.to, layer: event.layer, at });
        caption = event.note;
        break;
      }
      case 'descend': {
        layer = event.toLayer;
        focus = event.node;
        caption = event.note;
        break;
      }
      case 'scan': {
        layer = 0;
        focus = event.node;
        distanceCount++;
        radius = Math.max(radius, event.dist);
        touch(event.node, at, event.dist);
        caption = `Distance to node ${event.node} = ${event.dist.toFixed(2)}${
          event.inTopK ? ' — currently in the top-k' : ''
        }`;
        break;
      }
      case 'result': {
        focus = event.neighbors[0] ?? focus;
        caption = event.note;
        break;
      }
    }

    frames.push({ at, kind: event.kind, layer, focus, distanceCount, radius, caption });
  });

  return {
    trace,
    length: frames.length,
    frames,
    firstTouch,
    touchDist,
    hops,
    probes,
    neighbors: trace.neighbors,
  };
}

/** Empty timeline placeholder, so the renderer never has to branch on `null`. */
export function emptyTimeline(trace: SearchTrace): Timeline {
  return buildTimeline({ ...trace, events: [] }, 0);
}
