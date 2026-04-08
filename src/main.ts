import './style.css';
import * as THREE from 'three/webgpu';
import { createScene } from './rendering/scene.ts';
import { createCamera, updateCamera, handleResize as handleCameraResize, resizeCameraToWorld } from './rendering/camera.ts';
import { createTerrain, resizeTerrain } from './rendering/terrain.ts';
import { createEntities, updateEntities, rebuildEntityGeometry } from './rendering/entities.ts';
import { viewerState } from './state.ts';
import { createConnection } from './net/connection.ts';
import config from './config.ts';

const canvas = document.getElementById('three-canvas') as HTMLCanvasElement;
const { renderer, scene } = createScene(canvas);

const camera = createCamera(config.worldWidth, config.worldHeight);
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

// Render loop — setAnimationLoop defers first frame until GPU init is complete
const timer = new THREE.Timer();

renderer.setAnimationLoop(() => {
  timer.update();
  if (
    viewerState.worldWidth > 0 &&
    (viewerState.worldWidth !== lastWorldWidth || viewerState.worldHeight !== lastWorldHeight)
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
