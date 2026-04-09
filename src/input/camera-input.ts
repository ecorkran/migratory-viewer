// This module owns all DOM event binding for the camera.

import { panStart, panMove, panEnd, zoomBy } from '../rendering/camera.ts';

export function initCameraInput(canvas: HTMLCanvasElement): void {
  canvas.addEventListener('mousedown', (event: MouseEvent) => {
    if (event.button !== 0) return;
    panStart(event.clientX, event.clientY);
    event.preventDefault();
  });

  window.addEventListener('mousemove', (event: MouseEvent) => {
    panMove(event.clientX, event.clientY);
  });

  window.addEventListener('mouseup', (event: MouseEvent) => {
    if (event.button !== 0) return;
    panEnd();
  });

  canvas.addEventListener('wheel', (event: WheelEvent) => {
    event.preventDefault();
    zoomBy(event.deltaY > 0 ? 0.9 : 1.1);
  }, { passive: false });
}
