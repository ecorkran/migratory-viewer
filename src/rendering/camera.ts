import * as THREE from 'three/webgpu';
import config from '../config.ts';

let currentZoom = 1;
let isPanning = false;
let panStart = new THREE.Vector2();
let cameraRef: THREE.OrthographicCamera | null = null;

/** Create an orthographic camera sized to show the full world bounds. */
export function createCamera(worldWidth: number, worldHeight: number): THREE.OrthographicCamera {
  const aspect = window.innerWidth / window.innerHeight;
  const frustumHeight = worldHeight;
  const frustumWidth = frustumHeight * aspect;

  const cx = worldWidth / 2;
  const cz = worldHeight / 2;

  const camera = new THREE.OrthographicCamera(
    -frustumWidth / 2,
    frustumWidth / 2,
    frustumHeight / 2,
    -frustumHeight / 2,
    0.1,
    2000,
  );

  camera.position.set(cx, 1000, cz);
  camera.lookAt(cx, 0, cz);

  cameraRef = camera;

  // Register input handlers on the canvas
  const canvas = document.getElementById('three-canvas');
  if (canvas) {
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  return camera;
}

/** Update camera each frame (currently a no-op, interface for future animation). */
export function updateCamera(): void {
  // Reserved for future per-frame camera animation
}

/** Update camera frustum on window resize. */
export function handleResize(camera: THREE.OrthographicCamera): void {
  const aspect = window.innerWidth / window.innerHeight;
  const frustumHeight = config.worldHeight / currentZoom;
  const frustumWidth = frustumHeight * aspect;

  camera.left = -frustumWidth / 2;
  camera.right = frustumWidth / 2;
  camera.top = frustumHeight / 2;
  camera.bottom = -frustumHeight / 2;
  camera.updateProjectionMatrix();
}

function onWheel(event: WheelEvent): void {
  event.preventDefault();
  if (!cameraRef) return;

  const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
  currentZoom = Math.max(config.zoomMin, Math.min(config.zoomMax, currentZoom * zoomFactor));

  const aspect = window.innerWidth / window.innerHeight;
  const frustumHeight = config.worldHeight / currentZoom;
  const frustumWidth = frustumHeight * aspect;

  cameraRef.left = -frustumWidth / 2;
  cameraRef.right = frustumWidth / 2;
  cameraRef.top = frustumHeight / 2;
  cameraRef.bottom = -frustumHeight / 2;
  cameraRef.updateProjectionMatrix();
}

function onMouseDown(event: MouseEvent): void {
  // Middle-click (button 1) or right-click (button 2) for panning
  if (event.button === 1 || event.button === 2) {
    isPanning = true;
    panStart.set(event.clientX, event.clientY);
    event.preventDefault();
  }
}

function onMouseMove(event: MouseEvent): void {
  if (!isPanning || !cameraRef) return;

  const dx = event.clientX - panStart.x;
  const dy = event.clientY - panStart.y;

  // Convert screen pixels to world units
  const frustumWidth = cameraRef.right - cameraRef.left;
  const worldPerPixelX = frustumWidth / window.innerWidth;
  const frustumHeight = cameraRef.top - cameraRef.bottom;
  const worldPerPixelY = frustumHeight / window.innerHeight;

  // Pan camera position (X maps to world X, Y maps to world Z in top-down view)
  cameraRef.position.x -= dx * worldPerPixelX;
  cameraRef.position.z -= dy * worldPerPixelY;

  panStart.set(event.clientX, event.clientY);
}

function onMouseUp(event: MouseEvent): void {
  if (event.button === 1 || event.button === 2) {
    isPanning = false;
  }
}
