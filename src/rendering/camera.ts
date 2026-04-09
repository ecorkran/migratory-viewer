import * as THREE from 'three/webgpu';
import config from '../config.ts';

let currentZoom = 1;
let panOrigin: { x: number; y: number } | null = null;
let cameraRef: THREE.OrthographicCamera | null = null;
// Live world bounds, updated by `resizeCameraToWorld`. The camera frustum and
// zoom math read from these rather than `config.*`, so the viewer adapts to
// whatever world size the server announces in its snapshot.
let activeWorldHeight = 0;
let activeWorldWidth = 0;

/**
 * Compute the minimum zoom at which the frustum fits within the world on both axes.
 * Derived from:
 *   frustumHeight = activeWorldHeight / currentZoom
 *   frustumWidth  = frustumHeight * aspect
 *   need: frustumHeight <= activeWorldHeight  =>  currentZoom >= 1
 *   need: frustumWidth  <= activeWorldWidth   =>  currentZoom >= (activeWorldHeight * aspect) / activeWorldWidth
 *   zoomFit = max(1, (activeWorldHeight * aspect) / activeWorldWidth)
 */
function computeZoomFit(): number {
  if (activeWorldWidth === 0 || activeWorldHeight === 0) return 1;
  const aspect = window.innerWidth / window.innerHeight;
  return Math.max(1, (activeWorldHeight * aspect) / activeWorldWidth);
}

/**
 * Clamp camera position so the frustum never shows area outside world bounds.
 * No-op when `config.allowOutOfBoundsView` is true.
 */
function clampCameraToWorld(camera: THREE.OrthographicCamera): void {
  if (config.allowOutOfBoundsView) return;

  const fw = camera.right - camera.left;   // frustum width in world units
  const fh = camera.top - camera.bottom;   // frustum height in world units

  if (fw >= activeWorldWidth) {
    camera.position.x = activeWorldWidth / 2;
  } else {
    camera.position.x = Math.max(fw / 2, Math.min(activeWorldWidth - fw / 2, camera.position.x));
  }

  if (fh >= activeWorldHeight) {
    camera.position.z = activeWorldHeight / 2;
  } else {
    camera.position.z = Math.max(fh / 2, Math.min(activeWorldHeight - fh / 2, camera.position.z));
  }

  camera.lookAt(camera.position.x, 0, camera.position.z);
}

/** Create an orthographic camera sized to show the full world bounds. */
export function createCamera(worldWidth: number, worldHeight: number): THREE.OrthographicCamera {
  activeWorldHeight = worldHeight;
  activeWorldWidth = worldWidth;

  const aspect = window.innerWidth / window.innerHeight;
  const frustumHeight = worldHeight;
  const frustumWidth = frustumHeight * aspect;

  const cx = worldWidth / 2;
  const cz = worldHeight / 2;

  // Far plane scales with world size so very large worlds don't get clipped.
  const camY = Math.max(worldWidth, worldHeight);
  const camera = new THREE.OrthographicCamera(
    -frustumWidth / 2,
    frustumWidth / 2,
    frustumHeight / 2,
    -frustumHeight / 2,
    0.1,
    camY * 4,
  );

  camera.position.set(cx, camY, cz);
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

  // Snap zoom up to world-fit if the resize makes world-fit higher than current zoom.
  if (!config.allowOutOfBoundsView) {
    const fit = computeZoomFit();
    if (currentZoom < fit) currentZoom = fit;
  }

  const frustumHeight = activeWorldHeight / currentZoom;
  const frustumWidth = frustumHeight * aspect;

  camera.left = -frustumWidth / 2;
  camera.right = frustumWidth / 2;
  camera.top = frustumHeight / 2;
  camera.bottom = -frustumHeight / 2;
  camera.updateProjectionMatrix();
  clampCameraToWorld(camera);
}

/**
 * Recenter and resize the camera to new world bounds. Called when a snapshot
 * arrives whose world dimensions differ from the previous ones. Resets zoom so
 * the new world fills the view.
 */
export function resizeCameraToWorld(
  camera: THREE.OrthographicCamera,
  worldWidth: number,
  worldHeight: number,
): void {
  activeWorldHeight = worldHeight;
  activeWorldWidth = worldWidth;
  currentZoom = 1;

  const aspect = window.innerWidth / window.innerHeight;
  const frustumHeight = worldHeight;
  const frustumWidth = frustumHeight * aspect;

  camera.left = -frustumWidth / 2;
  camera.right = frustumWidth / 2;
  camera.top = frustumHeight / 2;
  camera.bottom = -frustumHeight / 2;

  const camY = Math.max(worldWidth, worldHeight);
  camera.near = 0.1;
  camera.far = camY * 4;
  camera.position.set(worldWidth / 2, camY, worldHeight / 2);
  camera.lookAt(worldWidth / 2, 0, worldHeight / 2);
  camera.updateProjectionMatrix();
  clampCameraToWorld(camera);
}

// --- Action API (called by camera-input.ts) ---

/** Begin a pan gesture at the given screen coordinates. */
export function panStart(screenX: number, screenY: number): void {
  panOrigin = { x: screenX, y: screenY };
}

/** Continue a pan gesture to the given screen coordinates. */
export function panMove(screenX: number, screenY: number): void {
  if (panOrigin === null || cameraRef === null) return;

  const dx = screenX - panOrigin.x;
  const dy = screenY - panOrigin.y;

  // Convert screen pixels to world units
  const frustumWidth = cameraRef.right - cameraRef.left;
  const worldPerPixelX = frustumWidth / window.innerWidth;
  const frustumHeight = cameraRef.top - cameraRef.bottom;
  const worldPerPixelY = frustumHeight / window.innerHeight;

  // Pan camera position (X maps to world X, Y maps to world Z in top-down view)
  cameraRef.position.x -= dx * worldPerPixelX;
  cameraRef.position.z -= dy * worldPerPixelY;

  panOrigin = { x: screenX, y: screenY };
  clampCameraToWorld(cameraRef);
}

/** End a pan gesture. */
export function panEnd(): void {
  panOrigin = null;
}

/**
 * Zoom by a multiplicative factor (> 1 zooms in, < 1 zooms out).
 * Zoom-fit lower bound is enforced unless `config.allowOutOfBoundsView` is true.
 */
export function zoomBy(factor: number): void {
  if (cameraRef === null) return;

  currentZoom = currentZoom * factor;

  // Upper bound always applied
  currentZoom = Math.min(config.zoomMax, currentZoom);

  // Lower bound: zoom-fit (gated by allowOutOfBoundsView flag)
  if (!config.allowOutOfBoundsView) {
    currentZoom = Math.max(computeZoomFit(), currentZoom);
  }

  const aspect = window.innerWidth / window.innerHeight;
  const frustumHeight = activeWorldHeight / currentZoom;
  const frustumWidth = frustumHeight * aspect;

  cameraRef.left = -frustumWidth / 2;
  cameraRef.right = frustumWidth / 2;
  cameraRef.top = frustumHeight / 2;
  cameraRef.bottom = -frustumHeight / 2;
  cameraRef.updateProjectionMatrix();
  clampCameraToWorld(cameraRef);
}

// --- Legacy DOM handlers (removed in task 4 after camera-input.ts is wired in) ---

function onWheel(event: WheelEvent): void {
  event.preventDefault();
  zoomBy(event.deltaY > 0 ? 0.9 : 1.1);
}

function onMouseDown(event: MouseEvent): void {
  // Middle-click (button 1) or right-click (button 2) for panning
  if (event.button === 1 || event.button === 2) {
    panStart(event.clientX, event.clientY);
    event.preventDefault();
  }
}

function onMouseMove(event: MouseEvent): void {
  panMove(event.clientX, event.clientY);
}

function onMouseUp(event: MouseEvent): void {
  if (event.button === 1 || event.button === 2) {
    panEnd();
  }
}
