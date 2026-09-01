import { Html } from '@react-three/drei';
import { useMemo } from 'react';
import type { Timeline, TimelineFrame } from '../algorithms/playback';
import type { Point2D } from '../algorithms/types';
import { nodeColorCss, palette, toWorld } from './theme';

/** How many recent evaluate/scan events keep a neighbour labelled while stepping. */
const LABEL_WINDOW = 10;

type LabelRole =
  | 'query'
  | 'entry'
  | 'expanding'
  | 'best'
  | 'local-min'
  | 'candidate'
  | 'discarded'
  | 'scanned'
  | 'top-k'
  | 'neighbour';

interface NodeLabel {
  key: string;
  x: number;
  y: number;
  z: number;
  text: string;
  role: LabelRole;
  color: string;
}

const ROLE_PRIORITY: Record<LabelRole, number> = {
  query: 60,
  neighbour: 55,
  best: 50,
  expanding: 45,
  'local-min': 44,
  candidate: 30,
  'top-k': 28,
  entry: 25,
  discarded: 20,
  scanned: 15,
};

interface NodeLabelsProps {
  points: readonly Point2D[];
  query: Point2D;
  timeline: Timeline;
  frame: TimelineFrame | undefined;
  step: number;
  activeLayer: number;
  focusNode: number;
  entryPointId: number;
  topLayer: number;
  resultIds: readonly number[];
  flatten: boolean;
  searchStarted: boolean;
  finished: boolean;
  visible: boolean;
}

/**
 * Tiny HUD chips on the handful of nodes that matter at the current step.
 *
 * The highlighted node is labelled by what this *step* means — expanding,
 * best so far, local min — not a generic "frontier". Recently evaluated
 * neighbours keep candidate / discarded / scanned labels in a short window.
 */
export function NodeLabels({
  points,
  query,
  timeline,
  frame,
  step,
  activeLayer,
  focusNode,
  entryPointId,
  topLayer,
  resultIds,
  flatten,
  searchStarted,
  finished,
  visible,
}: NodeLabelsProps) {
  const labels = useMemo(
    () =>
      collectLabels({
        points,
        query,
        timeline,
        frame,
        step,
        activeLayer,
        focusNode,
        entryPointId,
        topLayer,
        resultIds,
        flatten,
        searchStarted,
        finished,
      }),
    [
      points,
      query,
      timeline,
      frame,
      step,
      activeLayer,
      focusNode,
      entryPointId,
      topLayer,
      resultIds,
      flatten,
      searchStarted,
      finished,
    ],
  );

  if (!visible) return null;

  return (
    <group>
      {labels.map((label) => (
        <Html
          key={label.key}
          position={[label.x, label.y, label.z]}
          pointerEvents="none"
          style={{ pointerEvents: 'none', userSelect: 'none' }}
          zIndexRange={[30, 10]}
        >
          <div
            className={`node-label node-label--${label.role}`}
            style={{ borderColor: label.color, color: label.color }}
          >
            {label.text}
          </div>
        </Html>
      ))}
    </group>
  );
}

function collectLabels(args: Omit<NodeLabelsProps, 'visible'>): NodeLabel[] {
  const {
    points,
    query,
    timeline,
    frame,
    step,
    activeLayer,
    focusNode,
    entryPointId,
    topLayer,
    resultIds,
    flatten,
    searchStarted,
    finished,
  } = args;

  const resultSet = new Set(resultIds);
  const colorParams = {
    activeLayer,
    step,
    firstTouch: timeline.firstTouch,
    searchStarted,
    finished,
    focusNode,
    entryPointId,
    topLayer,
    flatten,
    resultIds: resultSet,
  };

  const byKey = new Map<string, NodeLabel & { priority: number }>();

  const upsert = (
    key: string,
    nodeId: number,
    point: Point2D,
    layer: number,
    text: string,
    role: LabelRole,
    color?: string,
  ) => {
    const priority = ROLE_PRIORITY[role];
    const existing = byKey.get(key);
    if (existing && existing.priority >= priority) return;
    const [x, y, z] = toWorld(point, layer);
    byKey.set(key, {
      key,
      x,
      y,
      z: z + 0.55,
      text,
      role,
      color:
        color ??
        nodeColorCss({
          nodeId,
          layer,
          ...colorParams,
        }),
      priority,
    });
  };

  upsert('query', -1, query, activeLayer, 'query', 'query', palette.query);

  if (!flatten) {
    const entry = points[entryPointId];
    if (entry) upsert(`n:${entryPointId}`, entryPointId, entry, topLayer, 'entry', 'entry', palette.entry);
  }

  // One label for the highlighted node, keyed to the current step's event kind.
  if (searchStarted && focusNode >= 0 && frame) {
    const focus = focusLabel(frame.kind);
    const isEntryLandmark = focusNode === entryPointId && activeLayer === topLayer;
    if (focus && !(isEntryLandmark && frame.kind === 'evaluate')) {
      const node = points[focusNode];
      if (node) upsert(`n:${focusNode}`, focusNode, node, activeLayer, focus.text, focus.role);
    }
  }

  if (searchStarted) {
    const from = Math.max(0, step - LABEL_WINDOW);
    const events = timeline.trace.events;
    for (let i = from; i <= step && i < events.length; i++) {
      const event = events[i]!;
      switch (event.kind) {
        case 'evaluate': {
          const toNode = points[event.to];
          if (toNode) {
            upsert(
              `n:${event.to}`,
              event.to,
              toNode,
              event.layer,
              event.improved ? 'candidate' : 'discarded',
              event.improved ? 'candidate' : 'discarded',
            );
          }
          break;
        }
        case 'scan': {
          const node = points[event.node];
          if (node) {
            upsert(
              `n:${event.node}`,
              event.node,
              node,
              0,
              event.inTopK ? 'top-k' : 'scanned',
              event.inTopK ? 'top-k' : 'scanned',
            );
          }
          break;
        }
        default:
          break;
      }
    }
  }

  if (finished) {
    resultIds.forEach((id, rank) => {
      const node = points[id];
      if (!node) return;
      const text = rank === 0 ? 'best neighbour' : `${rank + 1}${ordinalSuffix(rank + 1)} neighbour`;
      upsert(`n:${id}`, id, node, 0, text, 'neighbour');
    });
  }

  return [...byKey.values()];
}

function focusLabel(kind: TimelineFrame['kind']): { text: string; role: LabelRole } | null {
  switch (kind) {
    case 'evaluate':
      return { text: 'expanding', role: 'expanding' };
    case 'move':
      return { text: 'best so far', role: 'best' };
    case 'descend':
      return { text: 'local min', role: 'local-min' };
    default:
      return null;
  }
}

function ordinalSuffix(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  switch (n % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}
