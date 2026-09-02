/**
 * Deterministic pseudo-random number generation.
 *
 * The visualizer must be reproducible: tweaking `M` in the control panel should
 * re-link the graph without teleporting every point to a new location. We get
 * that by deriving every random draw from an explicit seed instead of
 * `Math.random()`, and by giving each concern (positions, layer assignment,
 * query placement) its own independent stream.
 */

/** A function returning uniformly distributed values in the half-open range [0, 1). */
export type Rng = () => number;

/**
 * Mulberry32 — a compact, fast, well-distributed 32-bit PRNG.
 * Good enough for visualization; not cryptographically secure.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Mixes a base seed with a string tag into a new 32-bit seed (FNV-1a style).
 * Lets us spawn labelled, independent streams from a single user-facing seed:
 * `streamSeed(seed, 'levels')` never correlates with `streamSeed(seed, 'points')`.
 */
export function streamSeed(seed: number, tag: string): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < tag.length; i++) {
    h = Math.imul(h ^ tag.charCodeAt(i), 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * Picks a fresh 32-bit seed for the user-facing "randomize" path.
 * The dataset itself is then generated deterministically from that seed.
 */
export function randomUint32(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]!;
}
