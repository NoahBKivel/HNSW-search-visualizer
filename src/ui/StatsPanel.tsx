import type { TimelineFrame } from '../algorithms/playback';
import type { SimulationResult } from '../hooks/useSimulation';
import type { SearchMode } from '../viz/Scene';
import { layerColorCss, palette } from '../viz/theme';

interface StatsPanelProps {
  simulation: SimulationResult;
  mode: SearchMode;
  frame: TimelineFrame | undefined;
  k: number;
  mL: number;
  M: number;
  stale: boolean;
}

/**
 * The scoreboard. Everything here exists to make one comparison concrete:
 * HNSW answers the same query as the exhaustive scan while touching a small
 * fraction of the dataset.
 */
export function StatsPanel({ simulation, mode, frame, k, mL, M, stale }: StatsPanelProps) {
  const { metrics, points } = simulation;
  const activeTotal =
    mode === 'hnsw' ? metrics.hnswDistanceComputations : metrics.knnDistanceComputations;
  const soFar = frame?.distanceCount ?? 0;
  const fractionOfDataset = points.length > 0 ? activeTotal / points.length : 0;

  return (
    <section className={`panel panel--stats ${stale ? 'panel--stale' : ''}`}>
      <header className="panel__header">
        <h1>HNSW vs. brute-force KNN</h1>
        <p>
          {points.length.toLocaleString()} points · {metrics.topLayer + 1} layers · M={M} · m_L=
          {mL.toFixed(3)}
        </p>
      </header>

      <div className="scoreboard">
        <Metric
          label="HNSW distances"
          value={metrics.hnswDistanceComputations.toLocaleString()}
          accent={palette.visited}
          active={mode === 'hnsw'}
        />
        <Metric
          label="KNN distances"
          value={metrics.knnDistanceComputations.toLocaleString()}
          accent={palette.knnScan}
          active={mode === 'knn'}
        />
        <Metric
          label="speedup"
          value={`${metrics.speedup.toFixed(1)}x`}
          accent={palette.result}
          active={false}
        />
        <Metric
          label={`recall@${k}`}
          value={`${Math.round(metrics.recall * 100)}%`}
          accent={metrics.recall >= 0.999 ? palette.result : palette.probing}
          active={false}
        />
      </div>

      <div className="progress-line">
        <div className="progress-line__label">
          <span>distance computations this run</span>
          <span>
            {soFar.toLocaleString()} / {activeTotal.toLocaleString()}
          </span>
        </div>
        <div className="progress-line__track">
          <div
            className="progress-line__fill"
            style={{
              width: `${activeTotal > 0 ? Math.min(100, (soFar / activeTotal) * 100) : 0}%`,
              background: mode === 'hnsw' ? palette.visited : palette.knnScan,
            }}
          />
        </div>
        <p className="progress-line__caption">
          {mode === 'hnsw'
            ? `Touches ${(fractionOfDataset * 100).toFixed(1)}% of the dataset per query.`
            : 'Touches 100% of the dataset per query, by definition.'}
        </p>
      </div>

      <LayerHistogram
        nodesPerLayer={metrics.nodesPerLayer.slice(0, metrics.topLayer + 1)}
        edgesPerLayer={metrics.edgesPerLayer.slice(0, metrics.topLayer + 1)}
      />

      <footer className="panel__footer">
        Index built in {metrics.buildMs.toFixed(0)} ms using{' '}
        {metrics.buildDistanceComputations.toLocaleString()} distance computations.
      </footer>
    </section>
  );
}

function Metric({
  label,
  value,
  accent,
  active,
}: {
  label: string;
  value: string;
  accent: string;
  active: boolean;
}) {
  return (
    <div className={`metric ${active ? 'metric--active' : ''}`} style={{ borderColor: active ? accent : undefined }}>
      <span className="metric__value" style={{ color: accent }}>
        {value}
      </span>
      <span className="metric__label">{label}</span>
    </div>
  );
}

/** Shows the exponential thinning of the hierarchy — the core of why HNSW is fast. */
function LayerHistogram({
  nodesPerLayer,
  edgesPerLayer,
}: {
  nodesPerLayer: readonly number[];
  edgesPerLayer: readonly number[];
}) {
  const max = Math.max(1, ...nodesPerLayer);

  return (
    <div className="histogram">
      <span className="histogram__title">layer occupancy</span>
      {nodesPerLayer
        .map((count, layer) => ({ count, layer, edges: edgesPerLayer[layer] ?? 0 }))
        .reverse()
        .map(({ count, layer, edges }) => (
          <div className="histogram__row" key={layer}>
            <span className="histogram__name" style={{ color: layerColorCss(layer) }}>
              L{layer}
            </span>
            <div className="histogram__track">
              <div
                className="histogram__bar"
                style={{ width: `${(count / max) * 100}%`, background: layerColorCss(layer) }}
              />
            </div>
            <span className="histogram__value">
              {count} <em>/ {edges} edges</em>
            </span>
          </div>
        ))}
    </div>
  );
}
