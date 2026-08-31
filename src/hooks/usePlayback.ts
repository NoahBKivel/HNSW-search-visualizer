import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface PlaybackControls {
  /** Index of the event currently being shown. */
  step: number;
  /** Sub-step interpolation in [0, 1), used to animate motion *between* two events. */
  fraction: React.RefObject<number>;
  playing: boolean;
  atEnd: boolean;
  length: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  restart: () => void;
  seek: (step: number) => void;
  stepForward: () => void;
  stepBackward: () => void;
}

/**
 * Drives the search animation clock.
 *
 * The step rate is derived from the trace length rather than fixed, so a 60-event
 * HNSW walk and a 2000-event brute-force scan both play out over a comparable wall
 * time — otherwise the KNN baseline would take minutes at a rate tuned for HNSW.
 * `speed` is a multiplier on top of that.
 *
 * Playback never starts on its own. A brand-new trace (load, parameter change, or
 * a fresh query) rewinds the clock and waits for play / replay.
 */
export function usePlayback(length: number, speed: number, autoPlay = false, resetKey?: unknown): PlaybackControls {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const fraction = useRef(0);

  const stepsPerSecond = useMemo(() => {
    const base = Math.min(220, Math.max(4, length / 10));
    return base * speed;
  }, [length, speed]);

  useEffect(() => {
    setStep(0);
    fraction.current = 0;
    setPlaying(autoPlay && length > 0);
  }, [length, autoPlay, resetKey]);

  const rateRef = useRef(stepsPerSecond);
  rateRef.current = stepsPerSecond;

  useEffect(() => {
    if (!playing || length === 0) return;

    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const deltaSeconds = Math.min(0.1, (now - last) / 1000);
      last = now;

      fraction.current += deltaSeconds * rateRef.current;
      if (fraction.current >= 1) {
        const advance = Math.floor(fraction.current);
        fraction.current -= advance;
        setStep((prev) => {
          const next = prev + advance;
          if (next >= length - 1) {
            setPlaying(false);
            fraction.current = 0;
            return length - 1;
          }
          return next;
        });
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, length]);

  const seek = useCallback(
    (value: number) => {
      fraction.current = 0;
      setStep(Math.max(0, Math.min(length - 1, Math.round(value))));
    },
    [length],
  );

  const restart = useCallback(() => {
    fraction.current = 0;
    setStep(0);
    setPlaying(true);
  }, []);

  return {
    step,
    fraction,
    playing,
    atEnd: step >= length - 1,
    length,
    play: useCallback(() => setPlaying(true), []),
    pause: useCallback(() => setPlaying(false), []),
    toggle: useCallback(() => setPlaying((p) => !p), []),
    restart,
    seek,
    stepForward: useCallback(() => {
      setPlaying(false);
      seek(step + 1);
    }, [seek, step]),
    stepBackward: useCallback(() => {
      setPlaying(false);
      seek(step - 1);
    }, [seek, step]),
  };
}
