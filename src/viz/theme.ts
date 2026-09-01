import { Color } from 'three';
import type { Point2D } from '../algorithms/types';

/**
 * Visual constants and the single mapping from algorithm space to world space.
 *
 * The scene is Z-up: the dataset lives on the XY plane exactly as the algorithm
 * sees it, and the Z axis is purely a visual device carrying the HNSW layer index.
 * Keeping that mapping in one function means no component ever has to reason about
 * layer geometry on its own.
 */

/** World-space distance between two consecutive HNSW layers. */
export const LAYER_SPACING = 6;

/** Maps a data point plus its layer to a world position. */
export function toWorld(point: Point2D, layer: number): [number, number, number] {
  return [point.x, point.y, layer * LAYER_SPACING];
}

export const palette = {
  background: '#070a14',
  fog: '#070a14',
  /** Base-layer node colour, brightening as layers go up. */
  layerHues: [200, 190, 170, 140, 100, 60, 35, 320],
  node: '#4b6bb5',
  nodeDim: '#233152',
  visited: '#38bdf8',
  probing: '#facc15',
  hop: '#f472b6',
  focus: '#ffffff',
  result: '#22c55e',
  query: '#f97316',
  entry: '#e879f9',
  intraEdge: '#2a3f6b',
  interEdge: '#7c3aed',
  knnScan: '#0ea5e9',
} as const;

/** Distinct colour per hierarchy layer, used for nodes, planes and labels alike. */
export function layerColor(layer: number): Color {
  const hue = palette.layerHues[layer % palette.layerHues.length]! / 360;
  const saturation = 0.65;
  const lightness = 0.45 + Math.min(layer, 5) * 0.05;
  return new Color().setHSL(hue, saturation, lightness);
}

/** Hex string form of {@link layerColor}, for DOM overlays. */
export function layerColorCss(layer: number): string {
  return `#${layerColor(layer).getHexString()}`;
}

/** How many events a node stays "hot" for after being evaluated. */
export const NODE_PULSE_EVENTS = 14;

export interface NodeColorParams {
  nodeId: number;
  layer: number;
  activeLayer: number;
  step: number;
  firstTouch: Float64Array;
  searchStarted: boolean;
  finished: boolean;
  focusNode: number;
  entryPointId: number;
  topLayer: number;
  flatten: boolean;
  resultIds: ReadonlySet<number>;
}

/**
 * Writes the same colour NodeCloud uses for an instanced sphere. Priority order
 * mirrors the render loop so labels and points always match.
 */
export function setNodeColor(target: Color, params: NodeColorParams): void {
  const {
    nodeId,
    layer,
    activeLayer,
    step,
    firstTouch,
    searchStarted,
    finished,
    focusNode,
    entryPointId,
    topLayer,
    flatten,
    resultIds,
  } = params;

  const onActiveLayer = layer === activeLayer;
  target.set(layerColor(layer));

  const touchedAt = firstTouch[nodeId] ?? Number.POSITIVE_INFINITY;
  const touched = searchStarted && touchedAt <= step;

  if (touched) {
    target.set(palette.probing);
  }

  if (resultIds.has(nodeId) && layer === 0 && finished) {
    target.set(palette.result);
  }

  if (searchStarted && nodeId === focusNode && onActiveLayer) {
    target.set(palette.focus);
  }

  // The graph entry stays purple on the top layer for the whole run — a fixed
  // landmark even after the search has touched it and moved on.
  if (nodeId === entryPointId && layer === topLayer && !flatten) {
    target.set(palette.entry);
  }

  if (!flatten && !onActiveLayer && searchStarted) {
    target.multiplyScalar(0.45);
  }
}

/** DOM-friendly form of {@link setNodeColor}. */
export function nodeColorCss(params: NodeColorParams): string {
  const color = new Color();
  setNodeColor(color, params);
  return `#${color.getHexString()}`;
}
