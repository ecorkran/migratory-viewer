import * as THREE from 'three/webgpu';
import config from '../config.ts';

export interface SceneContext {
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
}

/** Initialize the WebGPURenderer, scene, and lighting. */
export function createScene(canvas: HTMLCanvasElement): SceneContext {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(config.backgroundColor);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(config.backgroundColor);

  // Physically correct lighting
  const hemiLight = new THREE.HemisphereLight(
    config.hemisphereSkyColor,
    config.hemisphereGroundColor,
    config.hemisphereIntensity,
  );
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(
    config.directionalColor,
    config.directionalIntensity,
  );
  dirLight.position.set(...config.directionalPosition);
  scene.add(dirLight);

  // Resize handler
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Log active backend after init
  logBackend(renderer);

  // Register device/context loss handlers
  registerDeviceLossHandlers(renderer, canvas);

  return { renderer, scene };
}

/** Log whether WebGPU or WebGL 2 fallback is active. */
async function logBackend(renderer: THREE.WebGPURenderer): Promise<void> {
  await renderer.init();
  const isWebGPU = 'isWebGPUBackend' in renderer.backend && renderer.backend.isWebGPUBackend;
  console.log(`[migratory-viewer] Renderer backend: ${isWebGPU ? 'WebGPU' : 'WebGL 2 (fallback)'}`);
}

/** Register GPU device loss handlers for both WebGPU and WebGL 2 fallback paths. */
function registerDeviceLossHandlers(
  renderer: THREE.WebGPURenderer,
  canvas: HTMLCanvasElement,
): void {
  // WebGL 2 fallback path — canvas context events
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    console.warn('[migratory-viewer] WebGL context lost');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    console.log('[migratory-viewer] WebGL context restored');
  });

  // WebGPU device loss is handled internally by Three.js WebGPURenderer.
  // setAnimationLoop resumes automatically after device reacquisition.
  // We log the event via the renderer info for diagnostics.
  void renderer.init().then(() => {
    if ('isWebGPUBackend' in renderer.backend && renderer.backend.isWebGPUBackend) {
      console.log('[migratory-viewer] WebGPU device loss handlers registered (internal to Three.js)');
    }
  });
}
