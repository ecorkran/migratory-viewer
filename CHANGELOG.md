---
docType: changelog
scope: project-wide
---

# Changelog
All notable changes to migratory-viewer will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 20260406
### Added
- Vite + TypeScript project scaffold with pnpm
- Three.js WebGPURenderer with automatic WebGL 2 fallback (via `three/webgpu`)
- Orthographic top-down camera with mouse wheel zoom and right-click drag pan
- Flat ground plane terrain sized to world bounds (1000x1000)
- InstancedMesh rendering of 500 test entities (cones) with profile-based coloring
- Physically correct lighting (HemisphereLight + DirectionalLight)
- Render loop via `renderer.setAnimationLoop()` with `THREE.Timer`
- GPU device loss handling for both WebGPU and WebGL 2 fallback paths
- Centralized configuration module (`config.ts`) with typed defaults
- Console logging of active renderer backend (WebGPU vs WebGL 2)
