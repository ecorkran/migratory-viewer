import './style.css';
import * as THREE from 'three/webgpu';
import { createScene } from './rendering/scene.ts';
import { createCamera, updateCamera, handleResize as handleCameraResize } from './rendering/camera.ts';
import { createTerrain } from './rendering/terrain.ts';
import { createEntities } from './rendering/entities.ts';
import config from './config.ts';

const canvas = document.getElementById('three-canvas') as HTMLCanvasElement;
const { renderer, scene } = createScene(canvas);

const camera = createCamera(config.worldWidth, config.worldHeight);
createTerrain(scene, config.worldWidth, config.worldHeight);
createEntities(scene);

// Camera resize handler
window.addEventListener('resize', () => {
  handleCameraResize(camera);
});

// Render loop — setAnimationLoop defers first frame until GPU init is complete
const timer = new THREE.Timer();

renderer.setAnimationLoop(() => {
  timer.update();
  updateCamera();
  renderer.render(scene, camera);
});
