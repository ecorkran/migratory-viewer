// This module owns all DOM event binding for the camera.

import type { CameraRig } from '../rendering/camera.ts';
import { panStart, panMove, panEnd, zoomBy, orbitStart, orbitMove, orbitEnd } from '../rendering/camera.ts';

export function initCameraInput(canvas: HTMLCanvasElement, rig: CameraRig): void {
  canvas.addEventListener('mousedown', (event: MouseEvent) => {
    if (event.button === 0) {
      panStart(rig, event.clientX, event.clientY);
      event.preventDefault();
    } else if (event.button === 2) {
      orbitStart(rig, event.clientX, event.clientY);
      event.preventDefault();
    }
  });

  window.addEventListener('mousemove', (event: MouseEvent) => {
    panMove(rig, event.clientX, event.clientY);
    orbitMove(rig, event.clientX, event.clientY);
  });

  window.addEventListener('mouseup', (event: MouseEvent) => {
    if (event.button === 0) {
      panEnd(rig);
    } else if (event.button === 2) {
      orbitEnd(rig);
    }
  });

  canvas.addEventListener('wheel', (event: WheelEvent) => {
    event.preventDefault();
    zoomBy(rig, event.deltaY > 0 ? 0.9 : 1.1);
  }, { passive: false });

  canvas.addEventListener('contextmenu', (event: Event) => {
    event.preventDefault();
  });
}
