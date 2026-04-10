import './style.css';
import * as THREE from 'three/webgpu';
import { createScene } from './rendering/scene.ts';
import { createCamera, updateCamera, handleResize as handleCameraResize, resizeCameraToWorld } from './rendering/camera.ts';
import { createTerrain, resizeTerrain } from './rendering/terrain.ts';
import { createEntities, updateEntities, rebuildEntityGeometry } from './rendering/entities.ts';
import { viewerState } from './state.ts';
import { createConnection } from './net/connection.ts';
import { initCameraInput } from './input/camera-input.ts';
import { createHud, updateHud } from './ui/hud.ts';
import config from './config.ts';

const canvas = document.getElementById('three-canvas') as HTMLCanvasElement;
const { renderer, scene } = createScene(canvas);

const camera = createCamera(config.worldWidth, config.worldHeight);
initCameraInput(canvas);
const terrainMesh = createTerrain(scene, config.worldWidth, config.worldHeight);
const entityMesh = createEntities(scene);

// Track the world bounds currently reflected in terrain/camera/entity geometry.
// When a snapshot arrives with different bounds, rebuild all three so the
// viewer adapts to whatever world scale the server announces.
let lastWorldWidth = config.worldWidth;
let lastWorldHeight = config.worldHeight;

// Camera resize handler
window.addEventListener('resize', () => {
  handleCameraResize(camera);
});

// Live data: connect to migratory server and consume snapshots / state updates.
const connection = createConnection(viewerState);
connection.connect(config.serverUrl);

const hud = createHud();

// Render loop — setAnimationLoop defers first frame until GPU init is complete
const timer = new THREE.Timer();

renderer.setAnimationLoop(() => {
  timer.update();
  const delta = timer.getDelta();

  // Update HUD before the early return so connection status is visible
  // while waiting for the first snapshot.
  updateHud(hud, viewerState, delta);

  // Don't render until the first snapshot provides real world bounds.
  // Rendering with placeholder geometry before the server announces the
  // actual world size causes the WebGPU backend to allocate GPU buffers
  // for the InstancedMesh; replacing mesh.geometry after that corrupts
  // the internal buffer state intermittently.
  if (viewerState.worldWidth === 0) return;

  if (
    viewerState.worldWidth !== lastWorldWidth || viewerState.worldHeight !== lastWorldHeight
  ) {
    lastWorldWidth = viewerState.worldWidth;
    lastWorldHeight = viewerState.worldHeight;
    resizeTerrain(terrainMesh, lastWorldWidth, lastWorldHeight);
    resizeCameraToWorld(camera, lastWorldWidth, lastWorldHeight);
    rebuildEntityGeometry(entityMesh, lastWorldWidth);
  }
  updateCamera();
  updateEntities(entityMesh, viewerState);
  renderer.render(scene, camera);
});
