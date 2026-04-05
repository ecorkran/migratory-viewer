# Reference

This directory contains reference material for the migratory project — prototypes, research notes, and other non-production artifacts.

## Prototypes

Early proof-of-concept implementations built during initial project exploration. These are **not production code** — they exist to document what was learned and to inform the real architecture.

### 01-2d-boids.html
2D canvas-based boid simulation with predator/prey dynamics. Open directly in a browser.

**Demonstrates:**
- Classic Boids algorithm (separation, cohesion, alignment)
- Predator agent with hunt/rest cycle
- Panic radius with distance-scaled urgency
- Interactive parameter sliders
- O(n²) naive neighbor checking

**Key observations:**
- Three simple rules produce convincing herd behavior
- Panic radius is the most visually dramatic parameter
- Predator cooldown creates natural rhythm (hunt → catch → rest → hunt)

### 02-threejs-instanced-terrain.html
Three.js 3D version with instanced meshes, terrain, and orbit camera. Loads Three.js r128 from CDN — open directly in a browser.

**Demonstrates:**
- InstancedMesh for single-draw-call rendering of all agents
- Sine-wave terrain displacement with height lookup
- Agents riding on terrain surface
- Orbit camera (drag + scroll)
- 2000 agents at 120fps on modest hardware

**Key observations:**
- Instanced rendering makes agent count nearly free on the GPU side
- Simulation (CPU) is the bottleneck, not rendering
- Float32Array buffers are the natural data format for both simulation and GPU upload
- Subsampled neighbor checks (stride > 1 for large N) maintain behavior quality while reducing CPU cost
