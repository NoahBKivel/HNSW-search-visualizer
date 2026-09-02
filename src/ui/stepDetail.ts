import type { Timeline } from '../algorithms/playback';
import type { SearchEvent } from '../algorithms/types';
import type { SearchMode } from '../viz/Scene';

export interface StepDetail {
  /** One-line label for the node the step centres on. */
  readonly focusLabel: string;
  /** Longer explanation of what this step means for that node. */
  readonly body: string;
}

function focusDistance(timeline: Timeline, nodeId: number): string | null {
  if (nodeId < 0) return null;
  const dist = timeline.touchDist[nodeId];
  return Number.isFinite(dist) ? dist.toFixed(2) : null;
}

function nodePhrase(id: number, dist: string | null): string {
  return dist === null ? `node ${id}` : `node ${id} (${dist} from query)`;
}

function describeHnswEvent(event: SearchEvent, timeline: Timeline): StepDetail | null {
  switch (event.kind) {
    case 'enter': {
      const dist = focusDistance(timeline, event.node);
      return {
        focusLabel: `Entry · ${nodePhrase(event.node, dist)}`,
        body: `${nodePhrase(event.node, dist)} is the graph entry point on layer ${event.layer} — the highest layer where any point lives. The search begins here with a greedy hill-climb: it expands neighbors on this layer and hops whenever it finds one strictly closer to the query.`,
      };
    }
    case 'evaluate': {
      const fromDist = focusDistance(timeline, event.from);
      const toDist = event.dist.toFixed(2);
      const from = nodePhrase(event.from, fromDist);
      const acceptance = event.improved
        ? `Node ${event.to} is close enough to join the candidate list on layer ${event.layer}. It may be expanded later, and if it beats the current best, the walk will hop to it.`
        : `Node ${event.to} is farther from the query than the worst candidate already kept on this layer, so it is discarded. The search stays on ${from} and keeps checking remaining neighbors.`;
      return {
        focusLabel: `Expanding · ${nodePhrase(event.from, fromDist)}`,
        body: `${from} was pulled from the candidate heap and is being expanded — each graph neighbor on layer ${event.layer} is measured against the query. This probe checks node ${event.to} at distance ${toDist}. ${acceptance}`,
      };
    }
    case 'move': {
      const toDist = event.dist.toFixed(2);
      const fromDist = focusDistance(timeline, event.from);
      return {
        focusLabel: `Hop · ${nodePhrase(event.to, toDist)}`,
        body: `Node ${event.to} (${toDist} from query) is now the closest point seen on layer ${event.layer}, closer than ${nodePhrase(event.from, fromDist)}. This greedy hop is drawn as the bright path. The search still finishes checking neighbors of nodes already on the frontier before the layer converges.`,
      };
    }
    case 'descend': {
      const dist = focusDistance(timeline, event.node);
      return {
        focusLabel: `Local min · ${nodePhrase(event.node, dist)}`,
        body: `${nodePhrase(event.node, dist)} has no unexplored neighbor on layer ${event.fromLayer} that is closer to the query — a local minimum on that layer. The search drops to layer ${event.toLayer} and continues from the same point's copy there, refining the position with shorter, denser links.`,
      };
    }
    case 'result':
      return {
        focusLabel: `Result · node ${event.neighbors[0] ?? '—'}`,
        body: `Base-layer beam search finished. The nearest neighbors found are nodes ${event.neighbors.join(', ')} (best first). These are the approximate answer HNSW returns; compare them to the brute-force scan for recall.`,
      };
    default:
      return null;
  }
}

function describeKnnEvent(event: SearchEvent): StepDetail | null {
  if (event.kind !== 'scan') return null;

  const dist = event.dist.toFixed(2);
  const rankNote = event.inTopK
    ? 'It currently sits in the running top-k heap.'
    : 'It is not in the top-k yet — a farther point may be evicted later as better ones are found.';

  return {
    focusLabel: `Scan · node ${event.node} (${dist})`,
    body: `Brute-force KNN is measuring the query against every point. Node ${event.node} is ${dist} away. ${rankNote} No graph is involved: each spoke is one distance computation until all points have been checked.`,
  };
}

/** Rich narration for the transport bar details dropdown. */
export function describeStepDetail(
  timeline: Timeline,
  step: number,
  mode: SearchMode,
): StepDetail | null {
  const event = timeline.trace.events[step];
  if (!event) return null;
  return mode === 'hnsw' ? describeHnswEvent(event, timeline) : describeKnnEvent(event);
}
