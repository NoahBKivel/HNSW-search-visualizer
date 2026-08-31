import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { DoubleSide, type Mesh, type MeshBasicMaterial } from 'three';
import { WORLD_EXTENT } from '../algorithms/dataset';
import { LAYER_SPACING, layerColor, layerColorCss } from './theme';

const PLANE_SIZE = (WORLD_EXTENT + 2) * 2;

interface LayerPlanesProps {
  topLayer: number;
  activeLayer: number;
  nodesPerLayer: readonly number[];
  /** Hide the hierarchy entirely — the KNN baseline has no layers to show. */
  flatten: boolean;
  /** Master switch — reduced view turns the slabs off entirely. */
  visible?: boolean;
}

/**
 * The translucent slabs that give the Z axis meaning: one per occupied HNSW layer,
 * labelled with how many elements are resident there. The active layer brightens
 * as the search descends through the hierarchy.
 */
export function LayerPlanes({ topLayer, activeLayer, nodesPerLayer, flatten, visible = true }: LayerPlanesProps) {
  if (!visible) return null;

  const layers = Array.from({ length: topLayer + 1 }, (_, i) => i);

  return (
    <group>
      {layers.map((layer) => (
        <LayerPlane
          key={layer}
          layer={layer}
          active={!flatten && layer === activeLayer}
          visible={!flatten || layer === 0}
          residents={nodesPerLayer[layer] ?? 0}
        />
      ))}
    </group>
  );
}

interface LayerPlaneProps {
  layer: number;
  active: boolean;
  visible: boolean;
  residents: number;
}

function LayerPlane({ layer, active, visible, residents }: LayerPlaneProps) {
  const meshRef = useRef<Mesh>(null);
  const groupOpacity = useRef(0);

  // Opacity is eased in the render loop rather than swapped instantly, so layers
  // fade in and out as the search moves instead of blinking.
  useFrame((_, delta) => {
    const target = visible ? (active ? 0.14 : 0.04) : 0;
    groupOpacity.current += (target - groupOpacity.current) * Math.min(1, delta * 6);

    const material = meshRef.current?.material as MeshBasicMaterial | undefined;
    if (material) material.opacity = groupOpacity.current;
  });

  const color = layerColor(layer);
  const z = layer * LAYER_SPACING;

  return (
    <group position={[0, 0, z]}>
      <mesh ref={meshRef}>
        <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
        <meshBasicMaterial color={color} transparent opacity={0} depthWrite={false} side={DoubleSide} />
      </mesh>

      {/* gridHelper is authored in the XZ plane; the scene is Z-up, so rotate it flat. */}
      <gridHelper
        args={[PLANE_SIZE, 12, color, color]}
        rotation={[Math.PI / 2, 0, 0]}
        visible={visible}
      >
        <lineBasicMaterial attach="material" color={color} transparent opacity={active ? 0.14 : 0.05} />
      </gridHelper>

      {visible && (
        <Html
          position={[-PLANE_SIZE / 2, PLANE_SIZE / 2, 0]}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
          zIndexRange={[10, 0]}
        >
          <div className={`layer-label ${active ? 'layer-label--active' : ''}`}>
            <span className="layer-label__dot" style={{ background: layerColorCss(layer) }} />
            <strong>L{layer}</strong>
            <span className="layer-label__count">{residents} nodes</span>
          </div>
        </Html>
      )}
    </group>
  );
}
