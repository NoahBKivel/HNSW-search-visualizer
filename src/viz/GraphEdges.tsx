import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { AdditiveBlending, BufferAttribute, BufferGeometry, type LineBasicMaterial } from 'three';
import type { LayerEdge } from '../algorithms/hnsw';
import type { Point2D } from '../algorithms/types';
import { LAYER_SPACING, layerColor, palette, toWorld } from './theme';

interface GraphEdgesProps {
  points: readonly Point2D[];
  intraLayerEdges: readonly LayerEdge[];
  interLayerEdges: readonly LayerEdge[];
  topLayer: number;
  activeLayer: number;
  /** Collapse to the base layer only — the KNN baseline sees no graph structure. */
  flatten: boolean;
  showEdges: boolean;
}

/**
 * The static graph. Two visual languages, matching the two kinds of link HNSW creates:
 *
 *   - Intra-layer edges lie flat inside a slab and are tinted with that layer's hue.
 *     These are the "navigable small world" proximity links a greedy walk follows.
 *   - Inter-layer edges run vertically and are drawn in a single contrasting violet.
 *     They are not graph edges the search traverses; they mark that one element is
 *     resident on several layers at once — the "hierarchical" part of the name.
 *
 * Intra-layer edges are grouped into one draw call per layer so each layer's opacity
 * can be animated independently as the search descends.
 */
export function GraphEdges({
  points,
  intraLayerEdges,
  interLayerEdges,
  topLayer,
  activeLayer,
  flatten,
  showEdges,
}: GraphEdgesProps) {
  const byLayer = useMemo(() => {
    const buckets: LayerEdge[][] = Array.from({ length: topLayer + 1 }, () => []);
    for (const edge of intraLayerEdges) {
      if (edge.layer <= topLayer) buckets[edge.layer]!.push(edge);
    }
    return buckets;
  }, [intraLayerEdges, topLayer]);

  return (
    <group>
      {byLayer.map((edges, layer) => (
        <IntraLayerEdges
          key={layer}
          layer={layer}
          edges={edges}
          points={points}
          // Brute force has no graph to walk, so the hierarchy is hidden entirely in
          // that mode rather than merely dimmed — the absence is the point.
          targetOpacity={!showEdges || flatten ? 0 : layer === activeLayer ? 0.50 : 0.22}
        />
      ))}
      <InterLayerEdges
        points={points}
        edges={interLayerEdges}
        targetOpacity={showEdges && !flatten ? 0.35 : 0}
      />
    </group>
  );
}

/** Eases a line material's opacity toward a target so layer emphasis never snaps. */
function useOpacityEasing(target: number) {
  const materialRef = useRef<LineBasicMaterial>(null);
  const current = useRef(0);

  useFrame((_, delta) => {
    current.current += (target - current.current) * Math.min(1, delta * 5);
    if (materialRef.current) {
      materialRef.current.opacity = current.current;
      materialRef.current.visible = current.current > 0.005;
    }
  });

  return materialRef;
}

interface IntraLayerEdgesProps {
  layer: number;
  edges: readonly LayerEdge[];
  points: readonly Point2D[];
  targetOpacity: number;
}

function IntraLayerEdges({ layer, edges, points, targetOpacity }: IntraLayerEdgesProps) {
  const geometry = useMemo(() => buildSegments(edges, points, layer, layer), [edges, points, layer]);
  const materialRef = useOpacityEasing(targetOpacity);

  useLayoutEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <lineSegments geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial
        ref={materialRef}
        color={layerColor(layer)}
        transparent
        opacity={0}
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </lineSegments>
  );
}

interface InterLayerEdgesProps {
  edges: readonly LayerEdge[];
  points: readonly Point2D[];
  targetOpacity: number;
}

function InterLayerEdges({ edges, points, targetOpacity }: InterLayerEdgesProps) {
  const geometry = useMemo(() => {
    // Each entry connects a node's copy on `layer` to its copy on `layer + 1`.
    const positions = new Float32Array(edges.length * 6);
    edges.forEach((edge, i) => {
      const point = points[edge.a];
      if (!point) return;
      const z = edge.layer * LAYER_SPACING;
      positions.set([point.x, point.y, z, point.x, point.y, z + LAYER_SPACING], i * 6);
    });

    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(positions, 3));
    return geom;
  }, [edges, points]);

  const materialRef = useOpacityEasing(targetOpacity);

  useLayoutEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <lineSegments geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial
        ref={materialRef}
        color={palette.interEdge}
        transparent
        opacity={0}
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </lineSegments>
  );
}

/** Packs a list of edges into a flat position buffer for a single `LineSegments` draw. */
function buildSegments(
  edges: readonly LayerEdge[],
  points: readonly Point2D[],
  layerA: number,
  layerB: number,
): BufferGeometry {
  const positions = new Float32Array(edges.length * 6);

  edges.forEach((edge, i) => {
    const a = points[edge.a];
    const b = points[edge.b];
    if (!a || !b) return;
    const [ax, ay, az] = toWorld(a, layerA);
    const [bx, by, bz] = toWorld(b, layerB);
    positions.set([ax, ay, az, bx, by, bz], i * 6);
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  return geometry;
}
