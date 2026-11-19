import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { createHousePhysics } from './house-physics.js';
import { createSeats } from './seats.js';
import { configureHouseLights } from './interior-light.js';
import { createSwitchboards } from './switchboards.js';
import { createDoors } from './doors.js';

// Consecutive triangles in each tree mesh describe nearby branches or leaves.
// Bound small batches once so a camera probe only tests nearby geometry.
function indexTreeSightlines(root) {
  root.updateWorldMatrix(true, true);
  const meshes = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    const positions = mesh.geometry.attributes.position;
    const world = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) {
      a.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).toArray(world, i * 3);
    }
    const indices = mesh.geometry.index?.array;
    const vertex = (i, out) => out.fromArray(world, (indices ? indices[i] : i) * 3);
    const count = indices?.length ?? positions.count;
    const batches = [], bounds = new THREE.Box3();
    for (let start = 0; start < count; start += 192) {
      const end = Math.min(start + 192, count);
      const box = new THREE.Box3();
      for (let i = start; i < end; i++) box.expandByPoint(vertex(i, a));
      batches.push({ start, end, box });
      bounds.union(box);
    }
    meshes.push({ batches, bounds, vertex });
  });
  const segment = new THREE.Box3(), hit = new THREE.Vector3(), ray = new THREE.Ray();
  return (from, to) => {
    ray.origin.copy(from);
    ray.direction.subVectors(to, from);
    const lengthSq = ray.direction.lengthSq();
    if (!lengthSq) return false;
    ray.direction.normalize();
    segment.set(from, from).expandByPoint(to);
    for (const { bounds, batches, vertex } of meshes) {
      if (!segment.intersectsBox(bounds) || !ray.intersectsBox(bounds)) continue;
      for (const { start, end, box } of batches) {
        if (!segment.intersectsBox(box) || !ray.intersectsBox(box)) continue;
        for (let i = start; i < end; i += 3) {
          if (ray.intersectTriangle(vertex(i, a), vertex(i + 1, b), vertex(i + 2, c), false, hit) &&
              hit.distanceToSquared(from) <= lengthSq) return true;
        }
      }
    }
    return false;
  };
}

// Index the transformed triangles once. The terrain only translates vertically
// during its rise, so their XY footprints stay in the same cells.
function indexSurface(root, bounds) {
  const count = 32;
  const cells = Array.from({ length: count * count }, () => []);
  const column = x => THREE.MathUtils.clamp(Math.floor((x - bounds.min.x) * count / (bounds.max.x - bounds.min.x)), 0, count - 1);
  const row = y => THREE.MathUtils.clamp(Math.floor((y - bounds.min.y) * count / (bounds.max.y - bounds.min.y)), 0, count - 1);

  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    const positions = mesh.geometry.getAttribute('position');
    const vertices = Array.from({ length: positions.count }, (_, i) =>
      new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld)
    );
    const index = mesh.geometry.index;
    const vertex = i => vertices[index ? index.getX(i) : i];
    const length = index ? index.count : vertices.length;
    for (let i = 0; i < length; i += 3) {
      const a = vertex(i), b = vertex(i + 1), c = vertex(i + 2);
      const ab = b.clone().sub(a), ac = c.clone().sub(a);
      const determinant = ab.x * ac.y - ab.y * ac.x;
      if (Math.abs(determinant) < 1e-10) continue;
      const triangle = { a, ab, ac, determinant };
      const x0 = column(Math.min(a.x, b.x, c.x)), x1 = column(Math.max(a.x, b.x, c.x));
      const y0 = row(Math.min(a.y, b.y, c.y)), y1 = row(Math.max(a.y, b.y, c.y));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) cells[y * count + x].push(triangle);
      }
    }
  });

  return function heightAt(x, y) {
    if (!root.visible || x < bounds.min.x || x > bounds.max.x || y < bounds.min.y || y > bounds.max.y) return 0;
    let highest = 0;
    for (const { a, ab, ac, determinant } of cells[row(y) * count + column(x)]) {
      const dx = x - a.x, dy = y - a.y;
      const u = (dx * ac.y - dy * ac.x) / determinant;
      const v = (ab.x * dy - ab.y * dx) / determinant;
      if (u >= -1e-7 && v >= -1e-7 && u + v <= 1 + 1e-7) {
        highest = Math.max(highest, a.z + u * ab.z + v * ac.z + root.position.z);
      }
    }
    return highest;
  };
}

export async function loadTerrain(scene) {
  const loader = new GLTFLoader();
  const load = path => loader.loadAsync(new URL(path, import.meta.url).href);
  const terrainReady = load('../landscape/terrain-2.gltf');
  const vegetation = new THREE.Group();
  vegetation.name = 'Vegetation';
  vegetation.rotation.x = Math.PI / 2;
  vegetation.visible = false;
  scene.add(vegetation);

  // All three exports share the terrain's authored coordinates.
  async function loadLayer(name, path, parent) {
    try {
      const { scene: layer } = await load(path);
      layer.name = name;
      layer.traverse(mesh => {
        if (!mesh.isMesh) return;
        mesh.receiveShadow = true;
        mesh.castShadow = name !== 'Grass' && !mesh.material.transparent;
      });
      parent.add(layer);
      return layer;
    } catch (error) {
      console.error('Could not load ' + path, error);
      const message = document.querySelector('#error');
      message.textContent = name + ' could not be loaded. Please reload the scene.';
      message.hidden = false;
    }
  }
  loadLayer('Grass', '../landscape/grass.glb', vegetation);
  let treesReady = false;
  let treeBlocksView;
  loadLayer('Trees', '../landscape/trees-taller.glb', vegetation).then(layer => {
    if (layer) treeBlocksView = indexTreeSightlines(layer);
    treesReady = true;
  });

  const house = new THREE.Group();
  house.rotation.x = Math.PI / 2;
  house.visible = false;
  scene.add(house);
  const houseReady = loadLayer('Furnished treehouse', '../assets/treehouse-complete.glb', house);
  let secondsSinceTrees = 0;
  function updateScenery(elapsed, canMoveDoor) {
    if (!house.visible && vegetation.visible && treesReady) {
      secondsSinceTrees += elapsed;
      house.visible = secondsSinceTrees >= 0.4;
    }
    if (house.visible && doors?.update(elapsed, canMoveDoor)) housePhysics.doorRevision++;
  }

  const { scene: terrain } = await terrainReady;
  terrain.name = 'Terrain';
  // The asset uses meters. Rotate Y-up into the scene's Z-up coordinates.
  terrain.rotation.x = Math.PI / 2;
  const ground = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  terrain.traverse(mesh => {
    if (!mesh.isMesh) return;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.material.clippingPlanes = [ground];
    mesh.material.clipShadows = true;
    mesh.material.metalness = 0;
  });
  terrain.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(terrain, true);
  const heightAt = indexSurface(terrain, bounds);
  let housePhysics = null;
  let seats;
  let switches;
  let doors;
  let interactionParts = [];
  houseReady.then(layer => {
    if (!layer) return;
    configureHouseLights(layer);
    house.updateMatrixWorld(true);
    doors = createDoors(layer);
    housePhysics = createHousePhysics(layer, heightAt, doors.leaves);
    housePhysics.doorRevision = 0;
    seats = createSeats(layer);
    switches = createSwitchboards(layer);
    interactionParts = [...switches.parts, ...seats.parts, ...doors.parts];
  });
  const buried = -bounds.max.z - 0.02;
  function setRise(progress) {
    terrain.visible = progress > 0;
    vegetation.visible = progress >= 1;
    terrain.position.z = THREE.MathUtils.lerp(buried, 0, THREE.MathUtils.clamp(progress, 0, 1));
    terrain.updateMatrixWorld(true);
  }
  setRise(0);
  scene.add(terrain);
  const getHouse = () => house.visible ? housePhysics : null;
  function cameraBlocked(from, to) {
    return Number.isFinite(getHouse()?.cameraDistance(from, to)) ||
      Boolean(vegetation.visible && treeBlocksView?.(from, to));
  }
  function pickInteraction(raycaster, feet) {
    if (!house.visible || !raycaster.intersectObjects(interactionParts, false).length) return null;
    // Resolve the frontmost house surface so a wall, table or another chair can block the pick.
    const hit = doors.visibleHit(raycaster.intersectObject(house, true));
    if (!hit) return null;
    const target = doors.pick(hit) ?? switches.pick(hit) ?? seats.pick(hit, feet);
    if (!target || treeBlocksView?.(raycaster.ray.origin, hit.point)) return null;
    const ground = raycaster.intersectObject(terrain, true)[0];
    return ground && ground.distance < hit.distance ? null : { ...target, distance: hit.distance };
  }
  return { setRise, heightAt, updateScenery, getHouse, cameraBlocked, pickInteraction };
}
