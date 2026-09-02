import { button, folder, useControls } from 'leva';
import { useEffect, useRef } from 'react';
import type { Distribution } from '../algorithms/dataset';
import { suggestedML } from '../algorithms/hnsw';
import { randomUint32 } from '../algorithms/random';
import type { SearchMode } from '../viz/Scene';

/** Picked once per page load so Strict Mode remounts keep the same cloud. */
const INITIAL_DATASET_SEED = randomUint32();

export interface PanelActions {
  newQuery: () => void;
  restart: () => void;
  togglePlay: () => void;
  stepForward: () => void;
  stepBackward: () => void;
}

export interface PanelValues {
  pointCount: number;
  distribution: Distribution;
  seed: number;
  mode: SearchMode;
  M: number;
  autoML: boolean;
  mL: number;
  maxLayers: number;
  efConstruction: number;
  k: number;
  efSearch: number;
  speed: number;
  showEdges: boolean;
  showNodeLabels: boolean;
  autoRotate: boolean;
  reducedView: boolean;
}

/**
 * Declares the floating Leva panel and returns its live values.
 *
 * Leva builds its schema once, so button handlers would otherwise capture the
 * callbacks from the first render. Routing them through a ref keeps every button
 * bound to the current playback state.
 */
export function useControlPanel(actions: PanelActions): PanelValues {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const setSeedRef = useRef<((partial: { seed: number }) => void) | null>(null);

  const [values, set] = useControls(() => ({
    Dataset: folder(
      {
        pointCount: { label: 'points', value: 400, min: 20, max: 2500, step: 10 },
        distribution: {
          label: 'layout',
          value: 'uniform' as Distribution,
          options: { uniform: 'uniform', clustered: 'clustered' } as const,
        },
        seed: { label: 'seed', value: INITIAL_DATASET_SEED, step: 1 },
        'shuffle points': button(() => {
          setSeedRef.current?.({ seed: randomUint32() });
        }),
      },
      { collapsed: false },
    ),

    'HNSW graph': folder(
      {
        M: { label: 'M (links / node)', value: 8, min: 2, max: 32, step: 1 },
        autoML: { label: 'auto m_L = 1/ln M', value: true },
        mL: { label: 'm_L (level mult.)', value: suggestedML(8), min: 0.05, max: 2, step: 0.01 },
        maxLayers: { label: 'max layers (L)', value: 5, min: 1, max: 8, step: 1 },
        efConstruction: { label: 'efConstruction', value: 32, min: 4, max: 200, step: 1 },
      },
      { collapsed: false },
    ),

    Search: folder(
      {
        mode: {
          label: 'algorithm',
          value: 'hnsw' as SearchMode,
          options: { 'HNSW (greedy descent)': 'hnsw', 'KNN (brute force)': 'knn' } as const,
        },
        k: { label: 'k neighbours', value: 5, min: 1, max: 25, step: 1 },
        efSearch: { label: 'efSearch', value: 16, min: 1, max: 200, step: 1 },
        speed: { label: 'speed', value: 1, min: 0.1, max: 6, step: 0.1 },
        'run new query': button(() => actionsRef.current.newQuery()),
      },
      { collapsed: false },
    ),

    Playback: folder(
      {
        'play / pause': button(() => actionsRef.current.togglePlay()),
        replay: button(() => actionsRef.current.restart()),
        'step  <': button(() => actionsRef.current.stepBackward()),
        'step  >': button(() => actionsRef.current.stepForward()),
      },
      { collapsed: true },
    ),

    Display: folder(
      {
        reducedView: { label: 'reduced view', value: false },
        showEdges: { label: 'show edges', value: true },
        showNodeLabels: { label: 'node labels', value: true },
        autoRotate: { label: 'auto-orbit', value: false },
      },
      { collapsed: true },
    ),
  }));

  setSeedRef.current = set;

  const { M, autoML } = values;

  // The paper's recommended m_L is a function of M. When "auto" is on we keep the
  // slider in sync so the user can see the value it derives, and still take it over
  // manually by switching the toggle off.
  useEffect(() => {
    if (autoML) set({ mL: Number(suggestedML(M).toFixed(3)) });
  }, [autoML, M, set]);

  return values as PanelValues;
}
