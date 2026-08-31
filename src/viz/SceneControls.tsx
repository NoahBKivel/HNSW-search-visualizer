import { OrbitControls } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { MOUSE, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

interface SceneControlsProps {
  /** Default orbit target — centre of the layer stack. */
  orbitHeight: number;
  autoRotate: boolean;
}

const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * Camera rig: orbit on left-drag, pan on middle-drag or arrow keys, zoom on
 * scroll / right-drag. When auto-orbit is on, the pan target drifts back to the
 * grid centre whenever the user is not actively moving the view.
 */
export function SceneControls({ orbitHeight, autoRotate }: SceneControlsProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const dragging = useRef(false);
  const keyboardPanning = useRef(false);
  const center = useMemo(() => new Vector3(0, 0, orbitHeight), [orbitHeight]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    controls.mouseButtons = {
      LEFT: MOUSE.ROTATE,
      MIDDLE: MOUSE.PAN,
      RIGHT: MOUSE.DOLLY,
    };
    controls.enablePan = true;
    controls.listenToKeyEvents(document.body);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      if (ARROW_KEYS.has(event.key)) keyboardPanning.current = true;
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (ARROW_KEYS.has(event.key)) keyboardPanning.current = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => {
      keyboardPanning.current = false;
    });

    return () => {
      controls.stopListenToKeyEvents();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Keep the default target height in sync when the hierarchy collapses (KNN mode).
  useEffect(() => {
    center.set(0, 0, orbitHeight);
    const controls = controlsRef.current;
    if (!controls || dragging.current || keyboardPanning.current) return;
    if (!autoRotate) {
      controls.target.z = orbitHeight;
      controls.update();
    }
  }, [orbitHeight, autoRotate, center]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls || !autoRotate || dragging.current || keyboardPanning.current) return;

    if (controls.target.distanceTo(center) < 0.05) {
      controls.target.copy(center);
      return;
    }

    controls.target.lerp(center, 1 - Math.exp(-2.5 * delta));
    controls.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      target={[0, 0, orbitHeight]}
      enablePan
      enableDamping
      dampingFactor={0.08}
      autoRotate={autoRotate}
      autoRotateSpeed={0.4}
      maxDistance={220}
      minDistance={8}
      onStart={() => {
        dragging.current = true;
      }}
      onEnd={() => {
        dragging.current = false;
      }}
    />
  );
}
