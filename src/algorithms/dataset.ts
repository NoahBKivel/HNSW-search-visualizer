import { mulberry32, streamSeed } from './random';
import type { Point2D } from './types';

/** Half-width of the square the dataset occupies, in world units. */
export const WORLD_EXTENT = 12;

export type Distribution = 'uniform' | 'clustered';

export interface DatasetOptions {
  count: number;
  seed: number;
  distribution: Distribution;
}

/**
 * Generates the 2D dataset the graph is built over.
 *
 * Point `i` is drawn from a stream keyed by `i`, not from one sequential stream.
 * That makes the dataset *prefix-stable*: raising the point count in the UI adds
 * new points instead of reshuffling the existing ones, so the scene grows
 * smoothly rather than flickering into a brand-new cloud.
 */
export function generateDataset({ count, seed, distribution }: DatasetOptions): Point2D[] {
  const points: Point2D[] = [];

  // Cluster centres for the clustered mode. Fixed count so the layout stays
  // recognisable while the user drags the point-count slider.
  const clusterCount = 6;
  const centreRng = mulberry32(streamSeed(seed, 'cluster-centres'));
  const centres = Array.from({ length: clusterCount }, () => ({
    x: (centreRng() * 2 - 1) * WORLD_EXTENT * 0.65,
    y: (centreRng() * 2 - 1) * WORLD_EXTENT * 0.65,
  }));

  for (let i = 0; i < count; i++) {
    const rng = mulberry32(streamSeed(seed, `point-${i}`));

    if (distribution === 'uniform') {
      points.push({
        id: i,
        x: (rng() * 2 - 1) * WORLD_EXTENT,
        y: (rng() * 2 - 1) * WORLD_EXTENT,
      });
      continue;
    }

    // Clustered: pick a centre, then offset by a 2D Gaussian via the Box-Muller transform.
    const centre = centres[Math.floor(rng() * clusterCount) % clusterCount]!;
    const radius = Math.sqrt(-2 * Math.log(1 - rng()));
    const angle = 2 * Math.PI * rng();
    const spread = WORLD_EXTENT * 0.16;
    points.push({
      id: i,
      x: clamp(centre.x + radius * Math.cos(angle) * spread, -WORLD_EXTENT, WORLD_EXTENT),
      y: clamp(centre.y + radius * Math.sin(angle) * spread, -WORLD_EXTENT, WORLD_EXTENT),
    });
  }

  return points;
}

/** Picks a random query location inside the world bounds. */
export function generateQuery(seed: number): Point2D {
  const rng = mulberry32(streamSeed(seed, 'query'));
  return {
    id: -1,
    x: (rng() * 2 - 1) * WORLD_EXTENT * 0.9,
    y: (rng() * 2 - 1) * WORLD_EXTENT * 0.9,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
