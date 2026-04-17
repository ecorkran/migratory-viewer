import * as THREE from 'three/webgpu';
import config from '../config.ts';

// --- Types ---

export type CameraMode = 'ortho' | 'perspective';

export interface CameraRig {
  readonly mode: CameraMode;
  readonly activeCamera: THREE.Camera;
}

interface TransitionState {
  fromMode: CameraMode;
  elapsed: number;
  duration: number;
}

interface CameraRigState extends CameraRig {
  mode: CameraMode;
  activeCamera: THREE.Camera;
  orthoCamera: THREE.OrthographicCamera;
  perspCamera: THREE.PerspectiveCamera;
  orbitTarget: THREE.Vector3;
  pitch: number;
  yaw: number;
  dollyDistance: number;
  perspInitialized: boolean;
  currentZoom: number;
  panOrigin: { x: number; y: number } | null;
  orbitOrigin: { x: number; y: number } | null;
  activeWorldWidth: number;
  activeWorldHeight: number;
  transition: TransitionState | null;
}

// --- Helpers ---

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeZoomFit(): number {
  return 1;
}

function clampCameraToWorld(camera: THREE.OrthographicCamera, worldWidth: number, worldHeight: number): void {
  if (config.allowOutOfBoundsView) return;

  const fw = camera.right - camera.left;
  const fh = camera.top - camera.bottom;

  if (fw >= worldWidth) {
    camera.position.x = worldWidth / 2;
  } else {
    camera.position.x = clamp(camera.position.x, fw / 2, worldWidth - fw / 2);
  }

  if (fh >= worldHeight) {
    camera.position.z = worldHeight / 2;
  } else {
    camera.position.z = clamp(camera.position.z, fh / 2, worldHeight - fh / 2);
  }
}

function applyPerspectiveCamera(rig: CameraRigState): void {
  const pitchRad = rig.pitch;
  const yawRad = rig.yaw;
  const d = rig.dollyDistance;

  const offsetX = d * Math.cos(pitchRad) * Math.sin(yawRad);
  const offsetY = d * Math.sin(pitchRad);
  const offsetZ = d * Math.cos(pitchRad) * Math.cos(yawRad);

  rig.perspCamera.position.set(
    rig.orbitTarget.x + offsetX,
    rig.orbitTarget.y + offsetY,
    rig.orbitTarget.z + offsetZ,
  );
  rig.perspCamera.lookAt(rig.orbitTarget);
  rig.perspCamera.updateProjectionMatrix();
}

function syncOrthoAboveTarget(rig: CameraRigState): void {
  const camY = Math.max(rig.activeWorldWidth, rig.activeWorldHeight);
  rig.orthoCamera.position.x = rig.orbitTarget.x;
  rig.orthoCamera.position.z = rig.orbitTarget.z;
  rig.orthoCamera.position.y = camY;
  rig.orthoCamera.lookAt(rig.orbitTarget.x, 0, rig.orbitTarget.z);
  clampCameraToWorld(rig.orthoCamera, rig.activeWorldWidth, rig.activeWorldHeight);
}

// --- Factory ---

export function createCameraRig(worldWidth: number, worldHeight: number): CameraRig {
  const aspect = window.innerWidth / window.innerHeight;
  const frustumHeight = worldHeight;
  const frustumWidth = frustumHeight * aspect;

  const cx = worldWidth / 2;
  const cz = worldHeight / 2;
  const camY = Math.max(worldWidth, worldHeight);

  const orthoCamera = new THREE.OrthographicCamera(
    -frustumWidth / 2,
    frustumWidth / 2,
    frustumHeight / 2,
    -frustumHeight / 2,
    0.1,
    camY * 4,
  );
  orthoCamera.position.set(cx, camY, cz);
  orthoCamera.lookAt(cx, 0, cz);

  const perspCamera = new THREE.PerspectiveCamera(
    config.perspectiveFov,
    window.innerWidth / window.innerHeight,
    0.1,
    camY * 4,
  );

  const rig: CameraRigState = {
    mode: 'ortho',
    activeCamera: orthoCamera,
    orthoCamera,
    perspCamera,
    orbitTarget: new THREE.Vector3(cx, 0, cz),
    pitch: toRad(config.defaultPitch),
    yaw: toRad(config.defaultYaw),
    dollyDistance: config.dollyDefaultRatio * Math.max(worldWidth, worldHeight),
    perspInitialized: false,
    currentZoom: 1,
    panOrigin: null,
    orbitOrigin: null,
    activeWorldWidth: worldWidth,
    activeWorldHeight: worldHeight,
    transition: null,
  };

  return rig;
}

/** Thin wrapper so existing callers continue to compile during migration. */
export function createCamera(worldWidth: number, worldHeight: number): THREE.OrthographicCamera {
  const rig = createCameraRig(worldWidth, worldHeight) as CameraRigState;
  return rig.orthoCamera;
}

// --- Lifecycle ---

export function resizeRigToWorld(rig: CameraRig, worldWidth: number, worldHeight: number): void {
  const state = rig as CameraRigState;
  state.activeWorldWidth = worldWidth;
  state.activeWorldHeight = worldHeight;
  state.currentZoom = 1;

  const maxWH = Math.max(worldWidth, worldHeight);

  // Update ortho frustum
  const aspect = window.innerWidth / window.innerHeight;
  const frustumHeight = worldHeight;
  const frustumWidth = frustumHeight * aspect;
  state.orthoCamera.left = -frustumWidth / 2;
  state.orthoCamera.right = frustumWidth / 2;
  state.orthoCamera.top = frustumHeight / 2;
  state.orthoCamera.bottom = -frustumHeight / 2;

  const camY = maxWH;
  state.orthoCamera.near = 0.1;
  state.orthoCamera.far = camY * 4;
  state.perspCamera.far = camY * 4;
  state.perspCamera.updateProjectionMatrix();

  // Snap orbit target to new world center
  state.orbitTarget.set(worldWidth / 2, 0, worldHeight / 2);

  // Re-center ortho camera above orbit target
  state.orthoCamera.position.set(worldWidth / 2, camY, worldHeight / 2);
  state.orthoCamera.lookAt(worldWidth / 2, 0, worldHeight / 2);
  state.orthoCamera.updateProjectionMatrix();
  clampCameraToWorld(state.orthoCamera, worldWidth, worldHeight);

  // Clamp dolly into new valid range
  state.dollyDistance = clamp(
    state.dollyDistance,
    config.dollyMinRatio * maxWH,
    config.dollyMaxRatio * maxWH,
  );

  if (state.perspInitialized) {
    applyPerspectiveCamera(state);
  }
}

/** Thin wrapper — keeps pre-refactor callers compiling. */
export function resizeCameraToWorld(
  camera: THREE.OrthographicCamera,
  worldWidth: number,
  worldHeight: number,
): void {
  // This wrapper is only used if old callers haven't been migrated yet.
  // It operates directly on the ortho camera, matching old behaviour.
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
}

export function handleRigResize(rig: CameraRig): void {
  const state = rig as CameraRigState;
  const aspect = window.innerWidth / window.innerHeight;

  if (!config.allowOutOfBoundsView) {
    const fit = computeZoomFit();
    if (state.currentZoom < fit) state.currentZoom = fit;
  }

  const frustumHeight = state.activeWorldHeight / state.currentZoom;
  const frustumWidth = frustumHeight * aspect;

  state.orthoCamera.left = -frustumWidth / 2;
  state.orthoCamera.right = frustumWidth / 2;
  state.orthoCamera.top = frustumHeight / 2;
  state.orthoCamera.bottom = -frustumHeight / 2;
  state.orthoCamera.updateProjectionMatrix();
  clampCameraToWorld(state.orthoCamera, state.activeWorldWidth, state.activeWorldHeight);

  state.perspCamera.aspect = aspect;
  state.perspCamera.updateProjectionMatrix();
}

/** Thin wrapper for pre-migration callers. */
export function handleResize(camera: THREE.OrthographicCamera): void {
  const aspect = window.innerWidth / window.innerHeight;
  const frustumHeight = (camera.top - camera.bottom);
  const frustumWidth = frustumHeight * aspect;
  camera.left = -frustumWidth / 2;
  camera.right = frustumWidth / 2;
  camera.top = frustumHeight / 2;
  camera.bottom = -frustumHeight / 2;
  camera.updateProjectionMatrix();
}

export function updateRig(rig: CameraRig, deltaSeconds: number): void {
  const state = rig as CameraRigState;
  if (state.transition === null) return;

  state.transition.elapsed += deltaSeconds;
  const t = clamp(state.transition.elapsed / state.transition.duration, 0, 1);
  const fromMode = state.transition.fromMode;

  if (fromMode === 'ortho') {
    // Animate perspective camera pitch from 90° (top-down) toward target pitch
    const animPitch = THREE.MathUtils.lerp(Math.PI / 2, state.pitch, t);
    const saved = state.pitch;
    state.pitch = animPitch;
    applyPerspectiveCamera(state);
    state.pitch = saved;
  } else {
    // Animate perspective camera pitch back toward 90° (top-down)
    const animPitch = THREE.MathUtils.lerp(state.pitch, Math.PI / 2, t);
    const saved = state.pitch;
    state.pitch = animPitch;
    applyPerspectiveCamera(state);
    state.pitch = saved;

    // Switch to ortho halfway through
    if (t >= 0.5 && state.activeCamera !== state.orthoCamera) {
      state.activeCamera = state.orthoCamera;
    }
  }

  if (t >= 1.0) {
    state.transition = null;
    if (fromMode === 'ortho') {
      state.activeCamera = state.perspCamera;
      applyPerspectiveCamera(state);
    } else {
      state.mode = 'ortho';
      state.activeCamera = state.orthoCamera;
    }
  }
}

/** Kept for backward compat — remove after main.ts migrates. */
export function updateCamera(): void {
  // no-op placeholder
}

// --- Camera mode ---

export function getCameraMode(rig: CameraRig): CameraMode {
  return rig.mode;
}

export function resetPerspective(rig: CameraRig): void {
  const state = rig as CameraRigState;
  const maxWH = Math.max(state.activeWorldWidth, state.activeWorldHeight);
  state.pitch = toRad(config.defaultPitch);
  state.yaw = toRad(config.defaultYaw);
  state.dollyDistance = config.dollyDefaultRatio * maxWH;
  state.orbitTarget.set(state.activeWorldWidth / 2, 0, state.activeWorldHeight / 2);
  state.perspInitialized = true;
  // Cancel any in-flight transition and force perspective mode immediately
  state.transition = null;
  state.mode = 'perspective';
  state.activeCamera = state.perspCamera;
  applyPerspectiveCamera(state);
}

export function toggleCameraMode(rig: CameraRig): void {
  const state = rig as CameraRigState;
  if (state.transition !== null) return; // block during animation

  const fromMode = state.mode;

  if (fromMode === 'ortho') {
    if (!state.perspInitialized) {
      resetPerspective(state);
    }
    state.mode = 'perspective';
    // Start with perspCamera as active for the animation
    state.activeCamera = state.perspCamera;
    applyPerspectiveCamera(state);
    state.transition = {
      fromMode: 'ortho',
      elapsed: 0,
      duration: config.modeTransitionSeconds,
    };
  } else {
    state.mode = 'ortho';
    syncOrthoAboveTarget(state);
    state.transition = {
      fromMode: 'perspective',
      elapsed: 0,
      duration: config.modeTransitionSeconds,
    };
  }
}

// --- Pan ---

export function panStart(rig: CameraRig, screenX: number, screenY: number): void {
  (rig as CameraRigState).panOrigin = { x: screenX, y: screenY };
}

export function panMove(rig: CameraRig, screenX: number, screenY: number): void {
  const state = rig as CameraRigState;
  if (state.panOrigin === null) return;

  const dx = screenX - state.panOrigin.x;
  const dy = screenY - state.panOrigin.y;
  state.panOrigin = { x: screenX, y: screenY };

  if (state.mode === 'ortho') {
    const cam = state.orthoCamera;
    const frustumWidth = cam.right - cam.left;
    const worldPerPixelX = frustumWidth / window.innerWidth;
    const frustumHeight = cam.top - cam.bottom;
    const worldPerPixelY = frustumHeight / window.innerHeight;

    cam.position.x -= dx * worldPerPixelX;
    cam.position.z -= dy * worldPerPixelY;
    clampCameraToWorld(cam, state.activeWorldWidth, state.activeWorldHeight);

    // Keep orbit target in sync with ortho camera position for smooth transition
    state.orbitTarget.x = cam.position.x;
    state.orbitTarget.z = cam.position.z;
  } else {
    const fovRad = toRad(config.perspectiveFov);
    const worldPerPixel = (2 * state.dollyDistance * Math.tan(fovRad / 2)) / window.innerHeight;
    const yaw = state.yaw;
    const pitch = state.pitch;

    // Drag right moves world right (camera left): subtract from target
    state.orbitTarget.x -= dx * worldPerPixel * Math.cos(yaw) + dy * worldPerPixel * Math.sin(yaw) * Math.sin(pitch);
    state.orbitTarget.z += dx * worldPerPixel * Math.sin(yaw) - dy * worldPerPixel * Math.cos(yaw) * Math.sin(pitch);

    applyPerspectiveCamera(state);
  }
}

export function panEnd(rig: CameraRig): void {
  (rig as CameraRigState).panOrigin = null;
}

// --- Orbit ---

export function orbitStart(rig: CameraRig, screenX: number, screenY: number): void {
  (rig as CameraRigState).orbitOrigin = { x: screenX, y: screenY };
}

export function orbitMove(rig: CameraRig, screenX: number, screenY: number): void {
  const state = rig as CameraRigState;
  if (state.orbitOrigin === null || state.mode !== 'perspective') return;

  const dx = screenX - state.orbitOrigin.x;
  const dy = screenY - state.orbitOrigin.y;
  state.orbitOrigin = { x: screenX, y: screenY };

  const sensitivity = Math.PI / (2 * window.innerHeight);
  state.yaw -= dx * sensitivity;
  state.pitch = clamp(
    state.pitch - dy * sensitivity,
    toRad(config.pitchMin),
    toRad(config.pitchMax),
  );

  applyPerspectiveCamera(state);
}

export function orbitEnd(rig: CameraRig): void {
  (rig as CameraRigState).orbitOrigin = null;
}

// --- Zoom / Dolly ---

export function zoomBy(rig: CameraRig, factor: number): void {
  const state = rig as CameraRigState;

  if (state.mode === 'ortho') {
    state.currentZoom = state.currentZoom * factor;
    state.currentZoom = Math.min(config.zoomMax, state.currentZoom);

    const fit = computeZoomFit();
    if (!config.allowOutOfBoundsView) {
      state.currentZoom = Math.max(fit, state.currentZoom);
    }
    if (Math.abs(state.currentZoom - fit) < 0.001) state.currentZoom = fit;

    const aspect = window.innerWidth / window.innerHeight;
    const frustumHeight = state.activeWorldHeight / state.currentZoom;
    const frustumWidth = frustumHeight * aspect;

    state.orthoCamera.left = -frustumWidth / 2;
    state.orthoCamera.right = frustumWidth / 2;
    state.orthoCamera.top = frustumHeight / 2;
    state.orthoCamera.bottom = -frustumHeight / 2;
    state.orthoCamera.updateProjectionMatrix();
    clampCameraToWorld(state.orthoCamera, state.activeWorldWidth, state.activeWorldHeight);
  } else {
    const maxWH = Math.max(state.activeWorldWidth, state.activeWorldHeight);
    state.dollyDistance = clamp(
      state.dollyDistance / factor,
      config.dollyMinRatio * maxWH,
      config.dollyMaxRatio * maxWH,
    );
    applyPerspectiveCamera(state);
  }
}
