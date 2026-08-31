import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, type InstancedMesh, Object3D } from 'three';
import type { Timeline } from '../algorithms/playback';
import type { Point2D } from '../algorithms/types';
import { layerColor, palette, toWorld } from './theme';

/** How many events a node stays "hot" for after being evaluated. */
const PULSE_EVENTS = 14;

interface NodeCloudProps {
  points: readonly Point2D[];
  levels: readonly number[];
  timeline: Timeline;
  step: number;
  activeLayer: number;
  focusNode: number;
  entryPointId: number;
  topLayer: number;
  resultIds: readonly number[];
  /** KNN mode: collapse the hierarchy so only the flat base layer is visible. */
  flatten: boolean;
  searchStarted: boolean;
  reducedView: boolean;
}

/**
 * Every node, at every layer it is resident on, drawn as one instanced sphere.
 *
 * All per-frame state (colour, size, the highlight pulse) is written straight into
 * the instanced buffers from `useFrame`. React is never re-rendered for animation —
 * only when the graph itself changes — which keeps thousands of nodes smooth.
 */
export function NodeCloud({
  points,
  levels,
  timeline,
  step,
  activeLayer,
  focusNode,
  entryPointId,
  topLayer,
  resultIds,
  flatten,
  searchStarted,
  reducedView,
}: NodeCloudProps) {
  const meshRef = useRef<InstancedMesh>(null);

  // One instance per (node, layer) pair the node is resident on.
  const instances = useMemo(() => {
    const list: { nodeId: number; layer: number; x: number; y: number; z: number; key: number }[] = [];
    for (const point of points) {
      const level = Math.min(levels[point.id] ?? 0, topLayer);
      for (let layer = 0; layer <= level; layer++) {
        const [x, y, z] = toWorld(point, layer);
        list.push({ nodeId: point.id, layer, x, y, z, key: point.id * 64 + layer });
      }
    }
    return list;
  }, [points, levels, topLayer]);

  // Current (eased) scale of every instance. Instances that already existed keep
  // their size across a rebuild, so changing M re-links the graph without the whole
  // cloud popping; genuinely new nodes grow in from zero.
  const scales = useRef(new Float32Array(0));
  const previousScales = useRef(new Map<number, number>());

  useEffect(() => {
    const next = new Float32Array(instances.length);
    const carried = new Map<number, number>();
    for (let i = 0; i < instances.length; i++) {
      const key = instances[i]!.key;
      const previous = previousScales.current.get(key) ?? 0;
      next[i] = previous;
      carried.set(key, previous);
    }
    scales.current = next;
    previousScales.current = carried;
  }, [instances]);

  const resultSet = useMemo(() => new Set(resultIds), [resultIds]);

  const scratchObject = useMemo(() => new Object3D(), []);
  const scratchColor = useMemo(() => new Color(), []);
  const targetColor = useMemo(() => new Color(), []);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh || scales.current.length !== instances.length) return;

    const ease = Math.min(1, delta * 8);
    const { firstTouch } = timeline;

    for (let i = 0; i < instances.length; i++) {
      const instance = instances[i]!;
      const onActiveLayer = instance.layer === activeLayer;
      const hiddenByFlatten = flatten && instance.layer > 0;

      const touchedAt = firstTouch[instance.nodeId] ?? Number.POSITIVE_INFINITY;
      const touched = searchStarted && touchedAt <= step;

      let scale = 0.2 + instance.layer * 0.03;
      targetColor.set(reducedView ? palette.reducedNode : layerColor(instance.layer));

      if (reducedView) {
        if (touched) targetColor.set(palette.reducedSearched);
        if (hiddenByFlatten) scale = 0;
      } else {
        const heat = touched ? Math.max(0, 1 - (step - touchedAt) / PULSE_EVENTS) : 0;

        if (touched) {
          targetColor.set(palette.visited).lerp(scratchColor.set(palette.probing), heat);
          scale = 0.3 + heat * 0.22;
        }

        if (resultSet.has(instance.nodeId) && instance.layer === 0 && timeline.length - 1 <= step) {
          targetColor.set(palette.result);
          scale = 0.52;
        }

        if (searchStarted && instance.nodeId === focusNode && onActiveLayer) {
          targetColor.set(palette.focus);
          scale = 0.62;
        }

        if (!searchStarted && instance.nodeId === entryPointId && instance.layer === topLayer) {
          targetColor.set(palette.entry);
          scale = 0.5;
        }

        if (!flatten && !onActiveLayer && searchStarted) {
          targetColor.multiplyScalar(0.45);
          scale *= 0.75;
        }

        if (hiddenByFlatten) scale = 0;
      }

      scales.current[i]! += (scale - scales.current[i]!) * ease;
      const eased = scales.current[i]!;
      previousScales.current.set(instance.key, eased);

      scratchObject.position.set(instance.x, instance.y, instance.z);
      scratchObject.scale.setScalar(eased);
      scratchObject.updateMatrix();
      mesh.setMatrixAt(i, scratchObject.matrix);
      mesh.setColorAt(i, targetColor);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      // A changing instance count needs a fresh buffer, so remount on resize.
      key={instances.length}
      ref={meshRef}
      args={[undefined, undefined, Math.max(1, instances.length)]}
      frustumCulled={false}
    >
      <sphereGeometry args={[1, 12, 10]} />
      <meshStandardMaterial roughness={0.35} metalness={0.15} toneMapped={false} />
    </instancedMesh>
  );
}
