import './style.css';
import * as THREE from 'three/webgpu';
import { createScene } from './rendering/scene.ts';
import { createCameraRig, handleRigResize, resizeRigToWorld, updateRig } from './rendering/camera.ts';
import { createTerrain, resizeTerrain } from './rendering/terrain.ts';
import { createEntities, updateEntities, rebuildEntityGeometry } from './rendering/entities.ts';
import { viewerState } from './state.ts';
import { createConnection } from './net/connection.ts';
import { initCameraInput } from './input/camera-input.ts';
import { createHud, updateHud } from './ui/hud.ts';
import config from './config.ts';

const canvas = document.getElementById('three-canvas') as HTMLCanvasElement;
const { renderer, scene } = createScene(canvas);

const rig = createCameraRig(config.worldWidth, config.worldHeight);
initCameraInput(canvas, rig);
const terrainMesh = createTerrain(scene, config.worldWidth, config.worldHeight);
const entityMesh = createEntities(scene);

let lastWorldWidth = config.worldWidth;
let lastWorldHeight = config.worldHeight;

window.addEventListener('resize', () => {
  handleRigResize(rig);
});

const connection = createConnection(viewerState);
connection.connect(config.serverUrl);

const hud = createHud(rig);

const timer = new THREE.Timer();

renderer.setAnimationLoop(() => {
  timer.update();
  const delta = timer.getDelta();

  updateHud(hud, viewerState, delta, rig);

  if (viewerState.worldWidth === 0) return;

  if (
    viewerState.worldWidth !== lastWorldWidth || viewerState.worldHeight !== lastWorldHeight
  ) {
    lastWorldWidth = viewerState.worldWidth;
    lastWorldHeight = viewerState.worldHeight;
    resizeTerrain(terrainMesh, lastWorldWidth, lastWorldHeight);
    resizeRigToWorld(rig, lastWorldWidth, lastWorldHeight);
    rebuildEntityGeometry(entityMesh, lastWorldWidth, lastWorldHeight);
  }

  updateRig(rig, delta);
  updateEntities(entityMesh, viewerState);
  renderer.render(scene, rig.activeCamera);
});
