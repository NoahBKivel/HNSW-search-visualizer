import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, type Mesh, type Group } from 'three';
import type { Timeline } from '../algorithms/playback';
import type { Point2D } from '../algorithms/types';
import { LAYER_SPACING, palette, toWorld } from './theme';

/** How many recent probe edges stay on screen behind the frontier. */
const PROBE_WINDOW = 26;

interface SearchOverlayProps {
  points: readonly Point2D[];
  timeline: Timeline;
  step: number;
  fraction: React.RefObject<number>;
  activeLayer: number;
  focusNode: number;
  searchStarted: boolean;
  finished: boolean;
}

/**
 * Everything that only exists while a search is running: the greedy path, the
 * distance probes fanning out from the frontier, and the travelling pulse.
 *
 * The path and probes persist after the run so the completed route stays readable,
 * but the pulse marks the *frontier* — once there is no frontier it must go, or it
 * strands itself wherever the last event left it.
 */
export function SearchOverlay(props: SearchOverlayProps) {
  if (!props.searchStarted) return null;

  return (
    <group>
      <ProbeFan {...props} />
      <HopTrail {...props} />
      <DescentTrail {...props} />
      {!props.finished && <TravellingPulse {...props} />}
    </group>
  );
}

/**
 * The spine of the HNSW walk: every greedy hop taken so far.
 * Older hops are drawn dim; the most recent one is bright so the eye can follow
 * where the frontier just went.
 */
function HopTrail({ points, timeline, step }: SearchOverlayProps) {
  const segments = useMemo(() => {
    const taken = timeline.hops.filter((hop) => hop.at <= step);
    return taken
      .map((hop) => {
        const from = points[hop.from];
        const to = points[hop.to];
        if (!from || !to) return null;
        return [toWorld(from, hop.layer), toWorld(to, hop.layer)] as [
          [number, number, number],
          [number, number, number],
        ];
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .flat();
  }, [points, timeline, step]);

  if (segments.length < 2) return null;

  const past = segments.slice(0, -2);
  const latest = segments.slice(-2);

  return (
    <>
      {past.length >= 2 && (
        <Line points={past} segments color={palette.hop} lineWidth={2} transparent opacity={0.45} />
      )}
      {latest.length >= 2 && (
        <Line points={latest} segments color={palette.focus} lineWidth={3.5} transparent opacity={0.95} />
      )}
    </>
  );
}

/**
 * Vertical drops between layers: one segment per descend event, spanning only
 * the two layers involved — not the full height of the stack.
 */
function DescentTrail({ points, timeline, step }: SearchOverlayProps) {
  const segments = useMemo(() => {
    const taken = timeline.descents.filter((descent) => descent.at <= step);
    return taken
      .map((descent) => {
        const point = points[descent.node];
        if (!point) return null;
        return [toWorld(point, descent.fromLayer), toWorld(point, descent.toLayer)] as [
          [number, number, number],
          [number, number, number],
        ];
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .flat();
  }, [points, timeline, step]);

  if (segments.length < 2) return null;

  const past = segments.slice(0, -2);
  const latest = segments.slice(-2);

  return (
    <>
      {past.length >= 2 && (
        <Line points={past} segments color={palette.descent} lineWidth={2} transparent opacity={0.5} />
      )}
      {latest.length >= 2 && (
        <Line points={latest} segments color={palette.descent} lineWidth={3} transparent opacity={0.95} />
      )}
    </>
  );
}

/**
 * The distance computations themselves: a thin line from the node being expanded
 * to each neighbour whose distance was just evaluated. Only a trailing window is
 * kept so the scene does not silt up.
 */
function ProbeFan({ points, timeline, step }: SearchOverlayProps) {
  const geometry = useMemo(() => {
    const window = timeline.probes.filter((probe) => probe.at <= step && probe.at > step - PROBE_WINDOW);
    const positions = new Float32Array(window.length * 6);
    const colors = new Float32Array(window.length * 6);

    window.forEach((probe, i) => {
      const from = points[probe.from];
      const to = points[probe.to];
      if (!from || !to) return;
      const [ax, ay, az] = toWorld(from, probe.layer);
      const [bx, by, bz] = toWorld(to, probe.layer);
      positions.set([ax, ay, az, bx, by, bz], i * 6);

      // Fade with age so the newest probes read as the active frontier.
      const age = (step - probe.at) / PROBE_WINDOW;
      const intensity = Math.max(0.05, 1 - age);
      colors.set(
        [intensity, intensity * 0.85, intensity * 0.2, intensity, intensity * 0.85, intensity * 0.2],
        i * 6,
      );
    });

    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(positions, 3));
    geom.setAttribute('color', new BufferAttribute(colors, 3));
    return geom;
  }, [points, timeline, step]);

  return (
    <lineSegments geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial vertexColors transparent opacity={0.9} depthWrite={false} blending={AdditiveBlending} />
    </lineSegments>
  );
}

/**
 * A glowing marker riding the frontier. During a greedy hop it slides along the
 * edge using the sub-step fraction, which makes the discrete trace read as motion.
 */
function TravellingPulse({ points, timeline, step, fraction, activeLayer, focusNode }: SearchOverlayProps) {
  const groupRef = useRef<Group>(null);

  useFrame((state) => {
    const group = groupRef.current;
    if (!group) return;

    const frame = timeline.frames[step];
    let x = 0;
    let y = 0;
    let z = activeLayer * LAYER_SPACING;

    const hop = frame?.kind === 'move' ? timeline.hops.find((h) => h.at === step) : undefined;
    if (hop) {
      const from = points[hop.from];
      const to = points[hop.to];
      if (from && to) {
        const t = Math.min(1, fraction.current ?? 0);
        x = from.x + (to.x - from.x) * t;
        y = from.y + (to.y - from.y) * t;
        z = hop.layer * LAYER_SPACING;
      }
    } else {
      const node = points[focusNode];
      if (node) {
        x = node.x;
        y = node.y;
      }
    }

    group.position.set(x, y, z);
    const breathe = 1 + Math.sin(state.clock.elapsedTime * 6) * 0.12;
    group.scale.setScalar(breathe);
    group.quaternion.copy(state.camera.quaternion);
  });

  return (
    <group ref={groupRef}>
      <mesh>
        <ringGeometry args={[0.62, 0.82, 32]} />
        <meshBasicMaterial
          color={palette.focus}
          transparent
          opacity={0.85}
          side={DoubleSide}
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

interface ScanWavefrontProps {
  query: Point2D;
  radius: number;
  visible: boolean;
}

/**
 * The KNN baseline's signature: a ring expanding from the query.
 * There is no graph to walk, so the only thing to show is the scan sweeping
 * outward until it has touched every single point.
 */
export function ScanWavefront({ query, radius, visible }: ScanWavefrontProps) {
  const meshRef = useRef<Mesh>(null);
  const eased = useRef(0);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const target = visible ? Math.max(0.001, radius) : 0;
    eased.current += (target - eased.current) * Math.min(1, delta * 9);
    mesh.scale.set(eased.current, eased.current, 1);
    mesh.visible = eased.current > 0.01;
  });

  return (
    <mesh ref={meshRef} position={[query.x, query.y, 0.02]}>
      {/* Unit ring, scaled at runtime — avoids rebuilding geometry every frame. */}
      <ringGeometry args={[0.985, 1, 128]} />
      <meshBasicMaterial
        color={palette.knnScan}
        transparent
        opacity={0.55}
        side={DoubleSide}
        depthWrite={false}
        blending={AdditiveBlending}
        toneMapped={false}
      />
    </mesh>
  );
}

interface ScanSpokesProps {
  points: readonly Point2D[];
  query: Point2D;
  timeline: Timeline;
  step: number;
  visible: boolean;
}

/**
 * The brute-force scan made literal: a spoke from the query to each point whose
 * distance was just computed. Only a trailing window is drawn — with every point
 * connected at once the picture would be a solid disc, which is arguably the honest
 * summary but not a legible animation.
 */
export function ScanSpokes({ points, query, timeline, step, visible }: ScanSpokesProps) {
  const geometry = useMemo(() => {
    const from = Math.max(0, step - PROBE_WINDOW);
    const window = visible ? timeline.trace.events.slice(from, step + 1) : [];

    const positions: number[] = [];
    const colors: number[] = [];

    window.forEach((event, i) => {
      if (event.kind !== 'scan') return;
      const point = points[event.node];
      if (!point) return;

      const intensity = Math.max(0.08, (i + 1) / window.length);
      positions.push(query.x, query.y, 0.05, point.x, point.y, 0.05);
      colors.push(
        intensity * 0.2, intensity * 0.75, intensity,
        intensity * 0.2, intensity * 0.75, intensity,
      );
    });

    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geom.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
    return geom;
  }, [points, query, timeline, step, visible]);

  return (
    <lineSegments geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial vertexColors transparent opacity={0.7} depthWrite={false} blending={AdditiveBlending} />
    </lineSegments>
  );
}

interface QueryMarkerProps {
  query: Point2D;
  topLayer: number;
  flatten: boolean;
}

/**
 * The query itself: one orange octahedron on every layer, stacked at the same
 * (x, y). Same colour on each copy so it reads as one query, not a per-layer node.
 */
export function QueryMarker({ query, topLayer, flatten }: QueryMarkerProps) {
  const markersRef = useRef<Group>(null);
  const layers = flatten ? [0] : Array.from({ length: topLayer + 1 }, (_, i) => i);
  const size = 0.65;
  const columnTop = flatten ? 0.5 : (topLayer + 0.2) * LAYER_SPACING;

  useFrame((state) => {
    const group = markersRef.current;
    if (!group) return;
    const spin = state.clock.elapsedTime * 0.8;
    for (const child of group.children) child.rotation.z = spin;
  });

  return (
    <group>
      <group ref={markersRef}>
        {layers.map((layer) => {
          const [x, y, z] = toWorld(query, layer);
          return (
            <mesh key={layer} position={[x, y, z + 0.4]}>
              <octahedronGeometry args={[size, 0]} />
              <meshStandardMaterial
                color={palette.query}
                emissive={palette.query}
                emissiveIntensity={0.9}
                roughness={0.25}
                toneMapped={false}
              />
            </mesh>
          );
        })}
      </group>

      <Line
        points={[
          [query.x, query.y, 0],
          [query.x, query.y, columnTop],
        ]}
        color={palette.query}
        lineWidth={1}
        dashed
        dashSize={0.4}
        gapSize={0.35}
        transparent
        opacity={0.4}
      />
    </group>
  );
}

interface ResultHalosProps {
  points: readonly Point2D[];
  resultIds: readonly number[];
  visible: boolean;
}

/** Rings marking the returned neighbours once a search finishes. */
export function ResultHalos({ points, resultIds, visible }: ResultHalosProps) {
  const groupRef = useRef<Group>(null);
  const opacity = useRef(0);

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;
    opacity.current += ((visible ? 1 : 0) - opacity.current) * Math.min(1, delta * 5);
    group.visible = opacity.current > 0.02;
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 3) * 0.06;
    group.children.forEach((child) => {
      child.scale.setScalar(opacity.current * pulse);
      child.quaternion.copy(state.camera.quaternion);
    });
  });

  return (
    <group ref={groupRef}>
      {resultIds.map((id) => {
        const point = points[id];
        if (!point) return null;
        return (
          // Lifted off the base plane and drawn without depth testing: the halo sits
          // exactly where the layer-0 slab and grid are, and would otherwise z-fight
          // its way out of existence.
          <mesh key={id} position={[point.x, point.y, 0.15]} renderOrder={3}>
            <ringGeometry args={[0.52, 0.7, 40]} />
            <meshBasicMaterial
              color={palette.result}
              transparent
              opacity={0.95}
              side={DoubleSide}
              depthWrite={false}
              depthTest={false}
              blending={AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}
