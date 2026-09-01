import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, type InstancedMesh, Object3D } from 'three';
import type { Timeline } from '../algorithms/playback';
import type { Point2D } from '../algorithms/types';
import { NODE_PULSE_EVENTS, setNodeColor, toWorld } from './theme';

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
  const targetColor = useMemo(() => new Color(), []);

  const finished = timeline.length > 0 && step >= timeline.length - 1;

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
      const heat = touched ? Math.max(0, 1 - (step - touchedAt) / NODE_PULSE_EVENTS) : 0;

      let scale = 0.2 + instance.layer * 0.03;

      setNodeColor(targetColor, {
        nodeId: instance.nodeId,
        layer: instance.layer,
        activeLayer,
        step,
        firstTouch,
        searchStarted,
        finished,
        focusNode,
        entryPointId,
        topLayer,
        flatten,
        resultIds: resultSet,
      });

      if (touched) scale = 0.24 + heat * 0.08;
      if (resultSet.has(instance.nodeId) && instance.layer === 0 && finished) scale = 0.32;
      if (searchStarted && instance.nodeId === focusNode && onActiveLayer) scale = 0.36;
      if (!searchStarted && instance.nodeId === entryPointId && instance.layer === topLayer) scale = 0.28;
      if (!flatten && !onActiveLayer && searchStarted) scale *= 0.75;
      if (hiddenByFlatten) scale = 0;

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
