import { Canvas } from '@react-three/fiber';
import type { TimelineFrame } from '../algorithms/playback';
import type { SimulationResult } from '../hooks/useSimulation';
import type { PlaybackControls } from '../hooks/usePlayback';
import { GraphEdges } from './GraphEdges';
import { LayerPlanes } from './LayerPlanes';
import { NodeCloud } from './NodeCloud';
import { QueryMarker, ResultHalos, ScanSpokes, ScanWavefront, SearchOverlay } from './SearchOverlay';
import { SceneControls } from './SceneControls';
import { LAYER_SPACING, palette } from './theme';

export type SearchMode = 'hnsw' | 'knn';

interface SceneProps {
  simulation: SimulationResult;
  playback: PlaybackControls;
  frame: TimelineFrame | undefined;
  mode: SearchMode;
  showEdges: boolean;
  autoRotate: boolean;
  reducedView: boolean;
}

/**
 * Composition root for the 3D view. It owns no algorithm state — it only reads the
 * simulation output and the current playback frame and hands slices of them to the
 * individual visual layers.
 */
export function Scene({ simulation, playback, frame, mode, showEdges, autoRotate, reducedView }: SceneProps) {
  const { points, index, query, intraLayerEdges, interLayerEdges, metrics } = simulation;
  const timeline = mode === 'hnsw' ? simulation.hnswTimeline : simulation.knnTimeline;

  const flatten = mode === 'knn';
  const activeLayer = flatten ? 0 : (frame?.layer ?? metrics.topLayer);
  const searchStarted = playback.step > 0 || playback.playing;
  const finished = playback.step >= timeline.length - 1 && timeline.length > 0;

  // Once the search has finished the frontier no longer exists, and its white
  // highlight would otherwise sit on top of the best result and mask it.
  const focusNode = finished ? -1 : (frame?.focus ?? -1);

  // Frame the whole stack: look at the middle of the hierarchy, not the floor.
  const orbitHeight = ((flatten ? 0 : metrics.topLayer) * LAYER_SPACING) / 2;

  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ position: [30, -32, 24], fov: 42, near: 0.1, far: 500, up: [0, 0, 1] }}
    >
      <color attach="background" args={[palette.background]} />
      <fog attach="fog" args={[palette.fog, 70, 190]} />

      {/* Node state is communicated entirely through instance colour, so total light
          intensity is kept near 1: any brighter and the palette clips to white. */}
      <ambientLight intensity={0.62} />
      <directionalLight position={[24, -24, 48]} intensity={0.75} />
      <pointLight position={[-30, 30, 20]} intensity={45} color="#5b8dff" distance={150} />

      <LayerPlanes
        topLayer={metrics.topLayer}
        activeLayer={activeLayer}
        nodesPerLayer={metrics.nodesPerLayer}
        flatten={flatten}
      />

      <GraphEdges
        points={points}
        intraLayerEdges={intraLayerEdges}
        interLayerEdges={interLayerEdges}
        topLayer={metrics.topLayer}
        activeLayer={activeLayer}
        flatten={flatten}
        showEdges={showEdges}
      />

      <NodeCloud
        points={points}
        levels={index.levels}
        timeline={timeline}
        step={playback.step}
        activeLayer={activeLayer}
        focusNode={focusNode}
        entryPointId={index.entryPointId}
        topLayer={metrics.topLayer}
        resultIds={timeline.neighbors}
        flatten={flatten}
        searchStarted={searchStarted}
        reducedView={reducedView}
      />

      {mode === 'hnsw' && (
        <SearchOverlay
          points={points}
          timeline={timeline}
          step={playback.step}
          fraction={playback.fraction}
          activeLayer={activeLayer}
          focusNode={focusNode}
          searchStarted={searchStarted}
          finished={finished}
          reducedView={reducedView}
        />
      )}

      {mode === 'knn' && !reducedView && (
        <>
          <ScanWavefront query={query} radius={frame?.radius ?? 0} visible={searchStarted} />
          <ScanSpokes
            points={points}
            query={query}
            timeline={timeline}
            step={playback.step}
            visible={searchStarted && !finished}
          />
        </>
      )}

      <QueryMarker
        query={query}
        topLayer={metrics.topLayer}
        flatten={flatten}
        reducedView={reducedView}
      />

      {!reducedView && (
        <ResultHalos points={points} resultIds={timeline.neighbors} visible={finished} />
      )}

      <SceneControls orbitHeight={orbitHeight} autoRotate={autoRotate} />
    </Canvas>
  );
}
