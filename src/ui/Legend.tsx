import type { SearchMode } from '../viz/Scene';
import { palette } from '../viz/theme';

const FULL_NODE_KEYS = [
  { color: palette.query, label: 'query point', hnswOnly: false },
  { color: palette.entry, label: 'entry point (top layer)', hnswOnly: true },
  { color: palette.probing, label: 'distance just computed', hnswOnly: false },
  { color: palette.visited, label: 'already measured', hnswOnly: false },
  { color: palette.result, label: 'returned neighbour', hnswOnly: false },
];

const FULL_EDGE_KEYS = [
  { color: palette.intraEdge, label: 'intra-layer link (navigable)' },
  { color: palette.interEdge, label: 'inter-layer promotion' },
  { color: palette.hop, label: 'greedy hop taken' },
];

const REDUCED_KEYS = [
  { color: palette.reducedNode, label: 'node', swatch: 'dot' as const },
  { color: palette.reducedSearched, label: 'searched', swatch: 'dot' as const },
  { color: palette.reducedHop, label: 'hop taken', swatch: 'line' as const, hnswOnly: true },
];

interface LegendProps {
  mode: SearchMode;
  reducedView: boolean;
}

export function Legend({ mode, reducedView }: LegendProps) {
  if (reducedView) {
    return (
      <aside className="panel panel--legend panel--legend-reduced">
        <ul>
          {REDUCED_KEYS.filter((item) => mode === 'hnsw' || !item.hnswOnly).map((item) => (
            <li key={item.label}>
              {item.swatch === 'dot' ? (
                <span className="legend__swatch" style={{ background: item.color }} />
              ) : (
                <span className="legend__line" style={{ background: item.color }} />
              )}
              {item.label}
            </li>
          ))}
        </ul>
      </aside>
    );
  }

  return (
    <aside className="panel panel--legend">
      <span className="legend__title">legend</span>
      <ul>
        {FULL_NODE_KEYS.filter((item) => mode === 'hnsw' || !item.hnswOnly).map((item) => (
          <li key={item.label}>
            <span className="legend__swatch" style={{ background: item.color }} />
            {item.label}
          </li>
        ))}
        {mode === 'hnsw' &&
          FULL_EDGE_KEYS.map((item) => (
            <li key={item.label}>
              <span className="legend__line" style={{ background: item.color }} />
              {item.label}
            </li>
          ))}
      </ul>
      <p className="legend__hint">
        drag to orbit · middle-drag / arrows to pan · scroll to zoom · space to play
      </p>
    </aside>
  );
}
