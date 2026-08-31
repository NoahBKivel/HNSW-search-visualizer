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
  /** Reduced view: uniform node colour before the search reaches them. */
  reducedNode: '#4b6bb5',
  /** Reduced view: nodes whose distance to the query has been computed. */
  reducedSearched: '#38bdf8',
  /** Reduced view: greedy hops taken during the walk. */
  reducedHop: '#f472b6',
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
