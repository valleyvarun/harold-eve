import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { prepareHarold } from './harold.js';
import { prepareEve } from './eve.js';
import { controlEve } from './player.js';
import { createOutdoorPatrol } from './house-patrol.js';

const loader = new GLTFLoader();
const bodyRadius = 0.32;
const turnRate = 3.2;
const fallDuration = 0.9;
const introDuration = 4.9;
const riseDuration = 5;
const dropHeight = 4.2;

// Treat each prop's footprint as a circle and check the whole route to a waypoint.
function pathClears(start, end, center, clearance) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const t = THREE.MathUtils.clamp(
    ((center.x - start.x) * dx + (center.y - start.y) * dy) / (dx * dx + dy * dy || 1),
    0, 1
  );
  return Math.hypot(start.x + t * dx - center.x, start.y + t * dy - center.y) >= clearance;
}

export function addWalkers(scene, obstacles, terrainReady) {
  const walkers = [];
  const goal = new THREE.Vector2();

  const patrol = createOutdoorPatrol();

  async function loadCharacter(name, path, prepare, x, y, facing, speed) {
    try {
      const gltf = await loader.loadAsync(new URL(path, import.meta.url).href);
      const character = prepare(gltf);
      const { model, poseIntro } = character;
      model.name = name;
      model.position.set(x, y, dropHeight);
      model.rotation.z = facing;
      model.traverse(part => { if (part.isMesh) part.castShadow = true; });
      poseIntro(0);
      return { ...character, speed, distance: 0, wait: 0, destination: new THREE.Vector2(x, y) };
    } catch (error) {
      console.error('Could not load ' + name, error);
      const message = document.querySelector('#error');
      message.textContent = 'A character could not be loaded. Please reload the scene.';
      message.hidden = false;
    }
  }

  // Start the sequence only when all three models are ready.
  let introTime = 0;
  let riseTime = 0;
  let terrain;
  let harold, eve, movePlayer;
  const heightAt = (x, y) => terrain ? terrain.heightAt(x, y) : 0;
  const getHouse = () => terrain?.getHouse?.() ?? null;
  function canMoveDoor(leaf) {
    const house = getHouse();
    return walkers.every(({ model }) => !house.doorIntersectsBody(leaf, model.position));
  }
  function clearsCharacter(start, end, feetZ, other) {
    const body = other.model.position;
    if (feetZ >= body.z + 1.75 || body.z >= feetZ + 1.75) return true;
    // Characters already touching can always move apart.
    const separation = Math.hypot(start.x - body.x, start.y - body.y);
    if (separation < bodyRadius * 2 && Math.hypot(end.x - body.x, end.y - body.y) > separation) return true;
    return pathClears(start, end, body, bodyRadius * 2);
  }
  function canPlayerStep(x, y, feetZ = eve.model.position.z) {
    goal.set(x, y);
    const start = eve.model.position;
    if (harold && !clearsCharacter(start, goal, feetZ, harold)) return false;
    // At full height the landscape covers some of the original props.
    return obstacles.every(({ center, radius }) => start.z >= 2 * center.z ||
      pathClears(start, goal, center, radius + bodyRadius));
  }
  Promise.all([
    terrainReady,
    loadCharacter('Harold', '../characters/harold/animation.glb', prepareHarold, -1.65, -2.85, -2.0, 0.96),
    loadCharacter('Eve', '../characters/eve/walking.glb', prepareEve, 1.65, -2.2, 1.77, 1.65)
  ]).then(([surface, first, second]) => {
    terrain = surface;
    harold = first;
    eve = second;
    if (eve) movePlayer = controlEve(eve, canPlayerStep, heightAt, getHouse);
    for (const walker of [harold, eve].filter(Boolean)) {
      walkers.push(walker);
      scene.add(walker.model);
    }
  });

  function advanceWalker(walker, dt) {
    if (walker.wait > 0) {
      walker.wait -= dt;
      return;
    }
    const { model, destination } = walker;
    const start = model.position;
    const dx = destination.x - start.x;
    const dy = destination.y - start.y;
    const remaining = Math.hypot(dx, dy);
    if (remaining < 0.02) {
      destination.copy(patrol.next());
      return;
    }

    const heading = Math.atan2(-dx, dy);
    const difference = heading - model.rotation.z;
    const turn = Math.atan2(Math.sin(difference), Math.cos(difference));
    model.rotation.z += THREE.MathUtils.clamp(turn, -turnRate * dt, turnRate * dt);
    if (Math.abs(turn) > 0.12) return;

    const step = Math.min(walker.speed * dt, remaining);
    goal.set(start.x + step * dx / remaining, start.y + step * dy / remaining);
    const feetZ = heightAt(start.x, start.y);
    const house = getHouse();
    if ((house && !house.canMove(start.x, start.y, goal.x, goal.y, feetZ)) ||
      obstacles.some(({ center, radius }) => !pathClears(start, goal, center, radius + bodyRadius)) ||
      walkers.some(other => other !== walker && !clearsCharacter(start, goal, feetZ, other))) {
      destination.copy(patrol.next(true));
      walker.wait = 0.25;
      return;
    }
    start.x = goal.x;
    start.y = goal.y;
    walker.distance += step;
    walker.animate(walker.distance);
  }

  function update(elapsed, input) {
    if (walkers.length === 0) return;
    if (introTime < introDuration) {
      introTime = Math.min(introTime + elapsed, introDuration);
      const fallProgress = Math.min(introTime / fallDuration, 1);
      for (const walker of walkers) {
        walker.model.position.z = dropHeight * (1 - fallProgress * fallProgress);
        walker.poseIntro(introTime);
        if (introTime === introDuration) {
          walker.animate(0);
        }
      }
      return;
    }
    if (terrain && riseTime < riseDuration) {
      riseTime = Math.min(riseTime + elapsed, riseDuration);
      terrain.setRise(THREE.MathUtils.smootherstep(riseTime, 0, riseDuration));
      for (const walker of walkers) {
        walker.model.position.z = walker.supportHeight(terrain.heightAt);
      }
      return;
    }
    terrain?.updateScenery(elapsed, canMoveDoor);
    const dt = Math.min(elapsed, 0.05);
    if (movePlayer && input) movePlayer(dt, input);
    if (harold) {
      advanceWalker(harold, dt);
      harold.model.position.z = harold.supportHeight(heightAt);
      harold.draw(dt, scene);
    }
  }

  function getPlayer() {
    const ready = introTime >= introDuration && (!terrain || riseTime >= riseDuration);
    return ready && eve ? eve.model : null;
  }
  return {
    update, getPlayer,
    blocksPointer: (raycaster, distance) => walkers.some(({ model }) =>
      model.visible && raycaster.intersectObject(model, true)[0]?.distance < distance),
    sitOn: seat => Boolean(getPlayer() && movePlayer.sitOn(seat)),
    canSitOn: seat => Boolean(getPlayer() && movePlayer.canSitOn(seat)),
    usingSeat: () => movePlayer?.usingSeat() ?? false
  };
}
