import { Leva } from 'leva';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import { usePlayback, type PlaybackControls } from './hooks/usePlayback';
import { useSimulation, type SimulationParams } from './hooks/useSimulation';
import { Legend } from './ui/Legend';
import { StatsPanel } from './ui/StatsPanel';
import { TransportBar } from './ui/TransportBar';
import { useControlPanel } from './ui/useControlPanel';
import { Scene } from './viz/Scene';

export default function App() {
  const [datasetSeed, setDatasetSeed] = useState(1);
  const [querySeed, setQuerySeed] = useState(11);

  // The control panel is declared before playback exists, so its transport buttons
  // reach the live controls through a ref rather than a stale closure.
  const playbackRef = useRef<PlaybackControls | null>(null);

  const panel = useControlPanel({
    newQuery: useCallback(() => setQuerySeed((seed) => seed + 1), []),
    regenerateDataset: useCallback(() => setDatasetSeed((seed) => seed + 1), []),
    restart: useCallback(() => playbackRef.current?.restart(), []),
    togglePlay: useCallback(() => playbackRef.current?.toggle(), []),
    stepForward: useCallback(() => playbackRef.current?.stepForward(), []),
    stepBackward: useCallback(() => playbackRef.current?.stepBackward(), []),
  });

  // Parameters split by cost. The structural ones force a full index rebuild, so
  // they are debounced while a slider is being dragged; the query-side ones only
  // re-run a search and can apply on every keystroke.
  const structural = useMemo(
    () => ({
      pointCount: panel.pointCount,
      distribution: panel.distribution,
      datasetSeed,
      M: panel.M,
      mL: panel.mL,
      maxLayers: panel.maxLayers,
      efConstruction: panel.efConstruction,
    }),
    [panel.pointCount, panel.distribution, panel.M, panel.mL, panel.maxLayers, panel.efConstruction, datasetSeed],
  );

  const appliedStructural = useDebouncedValue(structural, 160);
  const rebuilding = appliedStructural !== structural;

  const params = useMemo<SimulationParams>(
    () => ({ ...appliedStructural, k: panel.k, efSearch: panel.efSearch, querySeed }),
    [appliedStructural, panel.k, panel.efSearch, querySeed],
  );

  const simulation = useSimulation(params);
  const timeline = panel.mode === 'hnsw' ? simulation.hnswTimeline : simulation.knnTimeline;

  const playback = usePlayback(timeline.length, panel.speed, false, timeline);
  useEffect(() => {
    playbackRef.current = playback;
  });

  const frame = timeline.frames[playback.step];

  useKeyboardShortcuts(playback, {
    newQuery: () => setQuerySeed((seed) => seed + 1),
  });

  return (
    <div className="app">
      <Scene
        simulation={simulation}
        playback={playback}
        frame={frame}
        mode={panel.mode}
        showEdges={panel.showEdges}
        showNodeLabels={panel.showNodeLabels}
        autoRotate={panel.autoRotate}
        reducedView={panel.reducedView}
      />

      <Leva
        titleBar={{ title: 'HNSW parameters', drag: true, filter: false }}
        theme={{
          colors: {
            elevation1: 'rgba(11, 16, 32, 0.92)',
            elevation2: 'rgba(15, 22, 42, 0.92)',
            elevation3: 'rgba(28, 39, 68, 0.95)',
            accent1: '#38bdf8',
            accent2: '#0ea5e9',
            accent3: '#7dd3fc',
            highlight1: '#8ea3c8',
            highlight2: '#dbe6f7',
            highlight3: '#ffffff',
          },
          sizes: { rootWidth: '310px', controlWidth: '150px' },
          radii: { xs: '3px', sm: '5px', lg: '10px' },
        }}
      />

      <StatsPanel
        simulation={simulation}
        mode={panel.mode}
        frame={frame}
        k={panel.k}
        mL={panel.mL}
        M={panel.M}
        stale={rebuilding}
      />

      <Legend mode={panel.mode} reducedView={panel.reducedView} />

      <TransportBar
        playback={playback}
        timeline={timeline}
        frame={frame}
        mode={panel.mode}
        topLayer={simulation.metrics.topLayer}
      />

      {rebuilding && <div className="rebuilding-toast">rebuilding index…</div>}
    </div>
  );
}

/** Space to play/pause, shift+arrows to step, R to replay, N for a fresh query. */
function useKeyboardShortcuts(playback: PlaybackControls, actions: { newQuery: () => void }) {
  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      switch (event.key) {
        case ' ':
          event.preventDefault();
          playbackRef.current.toggle();
          break;
        case 'ArrowRight':
          if (event.shiftKey) playbackRef.current.stepForward();
          break;
        case 'ArrowLeft':
          if (event.shiftKey) playbackRef.current.stepBackward();
          break;
        case 'r':
        case 'R':
          playbackRef.current.restart();
          break;
        case 'n':
        case 'N':
          actionsRef.current.newQuery();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
