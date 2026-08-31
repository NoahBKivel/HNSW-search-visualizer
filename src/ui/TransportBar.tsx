import type { TimelineFrame } from '../algorithms/playback';
import type { PlaybackControls } from '../hooks/usePlayback';
import type { SearchMode } from '../viz/Scene';
import { layerColorCss, palette } from '../viz/theme';

interface TransportBarProps {
  playback: PlaybackControls;
  frame: TimelineFrame | undefined;
  mode: SearchMode;
  topLayer: number;
}

/**
 * Bottom overlay: scrubber, transport buttons, and the narration for the current
 * step. This is where the algorithm is explained in words while the scene shows it
 * in geometry.
 */
export function TransportBar({ playback, frame, mode, topLayer }: TransportBarProps) {
  const { step, length, playing } = playback;

  return (
    <section className="panel panel--transport">
      <div className="transport__row">
        <button className="btn btn--icon" onClick={playback.restart} title="Replay (R)">
          ⟲
        </button>
        <button className="btn btn--icon" onClick={playback.stepBackward} title="Previous step (←)">
          ◀◀
        </button>
        <button className="btn btn--primary" onClick={playback.toggle} title="Play / pause (Space)">
          {playing ? '❚❚ pause' : '▶ play'}
        </button>
        <button className="btn btn--icon" onClick={playback.stepForward} title="Next step (→)">
          ▶▶
        </button>

        <input
          className="scrubber"
          type="range"
          min={0}
          max={Math.max(0, length - 1)}
          value={step}
          onChange={(event) => playback.seek(Number(event.target.value))}
          aria-label="search step"
        />

        <span className="transport__counter">
          step {length === 0 ? 0 : step + 1} / {length}
        </span>
      </div>

      <div className="transport__caption">
        <span
          className="pill"
          style={{
            background: mode === 'hnsw' ? palette.visited : palette.knnScan,
          }}
        >
          {mode === 'hnsw' ? 'HNSW' : 'BRUTE FORCE'}
        </span>

        {mode === 'hnsw' && (
          <span className="pill pill--outline" style={{ color: layerColorCss(frame?.layer ?? topLayer) }}>
            layer {frame?.layer ?? topLayer}
          </span>
        )}

        <p>{frame?.caption ?? 'Press play to run a query.'}</p>
      </div>
    </section>
  );
}
