import { useEffect, useState } from 'react';

/**
 * Holds back a value until it has stopped changing for `delay` ms.
 *
 * Rebuilding the HNSW index is the one heavy operation in the app, so dragging the
 * "points" or "M" slider must not rebuild on every intermediate value. React's
 * `useDeferredValue` looks like the natural fit but is the wrong tool here: the
 * playback clock issues high-priority state updates continuously, which starves the
 * low-priority deferred render for as long as an animation is running. An explicit
 * timer is predictable regardless of what else is updating.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    if (Object.is(settled, value)) return;
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay, settled]);

  return settled;
}
