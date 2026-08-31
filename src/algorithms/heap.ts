import type { Candidate } from './types';

/**
 * A binary heap of {@link Candidate}s ordered by `dist`.
 *
 * HNSW's `SEARCH-LAYER` routine needs two priority queues simultaneously:
 *   - a *min*-heap of candidates still to expand (always expand the closest first), and
 *   - a *max*-heap of the best results found so far (so the worst one can be evicted in O(log ef)).
 *
 * One class with a sign flip covers both, which keeps the algorithm file focused
 * on the algorithm rather than on data-structure bookkeeping.
 */
export class CandidateHeap {
  private readonly items: Candidate[] = [];
  /** +1 for a min-heap (smallest dist on top), -1 for a max-heap (largest dist on top). */
  private readonly sign: number;

  constructor(order: 'min' | 'max') {
    this.sign = order === 'min' ? 1 : -1;
  }

  get size(): number {
    return this.items.length;
  }

  /** The extreme element (closest for a min-heap, farthest for a max-heap). */
  peek(): Candidate | undefined {
    return this.items[0];
  }

  push(item: Candidate): void {
    this.items.push(item);
    this.siftUp(this.items.length - 1);
  }

  pop(): Candidate | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (last !== undefined && this.items.length > 0) {
      this.items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  /** Snapshot of the contents, sorted nearest-first. Does not mutate the heap. */
  toSortedArray(): Candidate[] {
    return [...this.items].sort((a, b) => a.dist - b.dist);
  }

  /** True when `a` should sit above `b` in this heap. */
  private higher(a: Candidate, b: Candidate): boolean {
    return (a.dist - b.dist) * this.sign < 0;
  }

  private siftUp(start: number): void {
    let i = start;
    const item = this.items[i]!;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.higher(item, this.items[parent]!)) break;
      this.items[i] = this.items[parent]!;
      i = parent;
    }
    this.items[i] = item;
  }

  private siftDown(start: number): void {
    let i = start;
    const n = this.items.length;
    const item = this.items[i]!;
    for (;;) {
      const left = 2 * i + 1;
      if (left >= n) break;
      const right = left + 1;
      const child = right < n && this.higher(this.items[right]!, this.items[left]!) ? right : left;
      if (!this.higher(this.items[child]!, item)) break;
      this.items[i] = this.items[child]!;
      i = child;
    }
    this.items[i] = item;
  }
}
