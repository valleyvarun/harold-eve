import { MathUtils, Vector2 } from './vendor/three.module.min.js';
import { pathToSeat } from './seat-navigation.js';

const walkSpeed = 1.65; // meters per second
const runSpeed = 5.5;
const gravity = 9.81;
const jumpSpeed = 3.9;
const stepHeight = 0.32;
const bodyHeight = 1.75;
const bodyRadius = 0.22;

export function controlEve(eve, canStep, heightAt, getHouse) {
  const position = eve.model.position;
  const step = new Vector2();
  let house;
  let feetZ;
  let sitting = false;
  let sitAmount = 0;
  let jumpTime = -1;
  let verticalSpeed = 0;
  let walkDistance = 0;
  let runWeight = 0;
  let furniture = null;

  // Keep the collision body's feet independent of the running bounce and foot poses.
  function support(x, y, reach) {
    return house ? house.support(x, y, feetZ, reach) : heightAt(x, y);
  }
  const soleSurface = (x, y) => support(x, y, stepHeight);

  function placeOnGround(dt, surface = soleSurface) {
    const target = Math.max(feetZ, eve.supportHeight(surface));
    // Ease a single riser's height change over a few frames.
    position.z += MathUtils.clamp(target - position.z, -5 * dt, 5 * dt);
  }

  function tryMove(dx, dy) {
    if (dx === 0 && dy === 0) return 0;
    const x = position.x + dx;
    const y = position.y + dy;
    if (!canStep(x, y, feetZ)) return 0;
    if (house && !house.canMove(position.x, position.y, x, y, feetZ, bodyHeight, bodyRadius,
      jumpTime < 0 ? stepHeight : 0)) return 0;
    position.x = x;
    position.y = y;
    return Math.hypot(dx, dy);
  }

  function move(dx, dy) {
    const distance = tryMove(dx, dy);
    if (distance || !dx || !dy) return distance;
    // Preserve the unobstructed component when pressing diagonally into a wall.
    if (Math.abs(dx) >= Math.abs(dy)) return tryMove(dx, 0) || tryMove(0, dy);
    return tryMove(0, dy) || tryMove(dx, 0);
  }

  function updateHeight(dt) {
    const floor = support(position.x, position.y, jumpTime < 0 ? stepHeight : 0);
    if (jumpTime < 0) {
      if (feetZ - floor <= stepHeight) {
        feetZ = floor;
        return;
      }
      jumpTime = 0;
      verticalSpeed = 0;
    }
    jumpTime += dt;
    let nextZ = feetZ + verticalSpeed * dt - 0.5 * gravity * dt * dt;
    verticalSpeed -= gravity * dt;
    if (house && nextZ > feetZ) {
      const ceiling = house.ceiling(position.x, position.y, feetZ + bodyHeight - 0.001, bodyRadius);
      if (nextZ + bodyHeight >= ceiling) {
        nextZ = Math.max(feetZ, ceiling - bodyHeight - 0.001);
        verticalSpeed = 0;
      }
    }
    if (verticalSpeed <= 0 && nextZ <= floor) {
      jumpTime = -1;
      verticalSpeed = 0;
      feetZ = floor;
    } else {
      feetZ = nextZ;
    }
  }

  function turnToward(angle, dt) {
    const delta = angle - eve.model.rotation.z;
    const turn = Math.atan2(Math.sin(delta), Math.cos(delta));
    eve.model.rotation.z += MathUtils.clamp(turn, -5.2 * dt, 5.2 * dt);
    return Math.abs(turn);
  }

  // Reuse routes from the same aisle position until a door moves.
  const seatRoutes = new Map();
  function availableSeat(seat) {
    house = getHouse?.();
    if (!house || !seat || jumpTime >= 0) return null;
    const leavingSeat = furniture && furniture.phase !== 'approach';
    const start = leavingSeat ? furniture.aisle : { x: position.x, y: position.y, z: feetZ ?? position.z };
    for (const target of [seat, ...(seat.alternatives ?? [])]) {
      if (furniture?.seat.position === target.position) return null;
      let route = seatRoutes.get(target.position);
      if (!route || route.house !== house || route.doorRevision !== house.doorRevision ||
          route.x !== start.x || route.y !== start.y || route.z !== start.z) {
        const path = pathToSeat(start, target, house, bodyHeight, bodyRadius);
        route = { x: start.x, y: start.y, z: start.z, house, doorRevision: house.doorRevision, path };
        seatRoutes.set(target.position, route);
      }
      if (route.path) return { seat: target, path: route.path };
    }
    return null;
  }

  function sitOn(seat) {
    const route = availableSeat(seat);
    if (!route) return false;
    const next = { seat: route.seat, path: route.path.slice(), aisle: route.path.at(-1),
      phase: 'approach', progress: 0, blockedTime: 0 };
    sitting = false;
    if (furniture && furniture.phase !== 'approach') {
      furniture.phase = 'rising';
      furniture.next = next;
    } else {
      furniture = next;
    }
    return true;
  }

  function advanceFurniture(dt, input) {
    const action = furniture;
    const { seat, aisle } = action;
    // These aisles are level. A swinging foot beside the bed or sofa must
    // sample the floor below it even if it passes over a low furniture rail.
    const aisleFloor = (x, y) => house.support(x, y, aisle.z, 0.07);
    if (input.movementPressed || input.sit || input.jump) {
      if (action.phase === 'approach') {
        furniture = null;
        return !input.movementPressed;
      }
      action.phase = 'rising';
      action.next = null;
    }
    if (sitAmount > 0) {
      sitAmount = Math.max(0, sitAmount - dt / 0.9);
      eve.poseSit(sitAmount);
      placeOnGround(dt, aisleFloor);
      return true;
    }
    if (action.phase === 'approach') {
      const target = action.path[0];
      const dx = target.x - position.x, dy = target.y - position.y;
      const remaining = Math.hypot(dx, dy);
      if (remaining > 0.001) {
        if (turnToward(Math.atan2(-dx, dy), dt) > 0.5) {
          eve.animate(0);
          walkDistance = 0;
          return true;
        }
        const fraction = Math.min(1, walkSpeed * dt / remaining);
        const travelled = tryMove(dx * fraction, dy * fraction);
        if (!travelled) {
          eve.animate(0);
          const previous = action.blockedTime;
          action.blockedTime += dt;
          // Harold can cross the aisle while Eve is walking. Re-route around
          // him or give him enough time to finish turning and pass.
          if (previous < 0.7 && action.blockedTime >= 0.7) {
            const start = { x: position.x, y: position.y, z: feetZ };
            const path = pathToSeat(start, seat, house, bodyHeight, bodyRadius, canStep);
            if (path) {
              action.path = path;
              action.aisle = path.at(-1);
            }
          }
          if (action.blockedTime >= 2.8) furniture = null;
          return true;
        }
        action.blockedTime = 0;
        updateHeight(dt);
        walkDistance += travelled;
        eve.animate(walkDistance);
        placeOnGround(dt, aisleFloor);
        return true;
      }
      action.path.shift();
      if (action.path.length) return true;
      action.phase = 'turn';
      walkDistance = 0;
      runWeight = 0;
      eve.animate(0);
    }
    // At the bed, first sit facing the aisle and then swing the legs toward the footboard.
    const bedSide = seat.edgeOffset ? Math.sign(aisle.x - seat.position.x) : 0;
    const entryFacing = bedSide ? -bedSide * Math.PI / 2 : seat.facing;
    if (action.phase === 'turn') {
      if (turnToward(entryFacing, dt) > 0.07) return true;
      eve.model.rotation.z = entryFacing;
      action.phase = 'lowering';
    }
    if (action.phase === 'seated') return true;
    const direction = action.phase === 'rising' ? -1 : 1;
    const passageTime = aisle.passage ? aisle.passage.getLength() / 0.85 : 0;
    const settleTime = bedSide ? 2.8 : 0.95;
    const duration = passageTime + settleTime;
    const progress = MathUtils.clamp(action.progress + direction * dt, 0, duration);
    const pose = MathUtils.clamp((progress - passageTime) / settleTime, 0, 1);
    const blend = MathUtils.smootherstep(pose, 0, bedSide ? 0.33 : 1);
    // Follow the same narrow passage in reverse before returning control to the player.
    if (aisle.passage) aisle.passage.getPoint(Math.min(progress / passageTime, 1), step);
    else step.set(aisle.x, aisle.y);
    let restX = seat.position.x;
    if (bedSide) {
      const pivot = MathUtils.smootherstep(pose, 0.47, 0.82);
      restX += bedSide * seat.edgeOffset * (1 - pivot);
      eve.model.rotation.z = entryFacing - bedSide * Math.PI / 2 * pivot;
    }
    const x = MathUtils.lerp(step.x, restX, blend);
    const y = MathUtils.lerp(step.y, seat.position.y, blend);
    if (!canStep(x, y, aisle.z)) {
      if (action.phase === 'lowering') action.phase = 'rising';
      return true;
    }
    // The final weight transfer intentionally enters the selected cushion's footprint.
    // Keep the root at floor level while the articulated pelvis settles onto the seat.
    action.progress = progress;
    position.set(x, y, position.z + MathUtils.clamp(aisle.z - position.z, -1.8 * dt, 1.8 * dt));
    feetZ = aisle.z;
    if (bedSide) eve.poseOnBed(pose, seat.position.z - aisle.z);
    else eve.poseOnSeat(pose, seat.position.z - aisle.z);
    if (progress === duration) action.phase = 'seated';
    if (progress === 0) {
      furniture = action.next ?? null;
      eve.animate(0);
    }
    return true;
  }

  function update(dt, input) {
    house = getHouse?.();
    feetZ ??= position.z;
    if (furniture && advanceFurniture(dt, input)) return;
    eve.model.rotation.z = input.yaw - Math.PI / 2;
    if (jumpTime < 0 && input.sit) sitting = !sitting;
    if (input.movementPressed) sitting = false;
    if (sitting || sitAmount > 0) {
      sitAmount = MathUtils.clamp(sitAmount + (sitting ? dt : -dt) / 0.9, 0, 1);
      eve.poseSit(sitAmount);
      placeOnGround(dt);
      walkDistance = 0;
      runWeight = 0;
      if (sitAmount > 0) return;
    }

    const cos = Math.cos(input.yaw), sin = Math.sin(input.yaw);
    step.set(cos * input.forward + sin * input.strafe, sin * input.forward - cos * input.strafe);
    const running = input.run && input.forward > 0;
    runWeight = MathUtils.clamp(runWeight + (running ? dt : -dt) / 0.22, 0, 1);
    step.normalize().multiplyScalar(MathUtils.lerp(walkSpeed, runSpeed, runWeight) * dt);

    if (input.jump && jumpTime < 0) {
      jumpTime = 0;
      verticalSpeed = jumpSpeed;
      walkDistance = 0;
    }
    // Resolve each tread and ledge even when running at a low frame rate.
    const slices = Math.max(1, Math.ceil(step.length() / 0.09));
    let travelled = 0;
    for (let i = 0; i < slices; i++) {
      travelled += move(step.x / slices, step.y / slices);
      updateHeight(dt / slices);
    }
    if (jumpTime >= 0) {
      eve.poseJump(Math.min(1, jumpTime * gravity / (2 * jumpSpeed)));
      position.z = feetZ;
      return;
    }
    if (travelled > 0) {
      walkDistance += travelled;
      eve.animate(walkDistance, runWeight);
    } else {
      walkDistance = 0;
      runWeight = 0;
      eve.animate(0);
    }
    placeOnGround(dt);
  }
  update.sitOn = sitOn;
  update.canSitOn = seat => Boolean(availableSeat(seat));
  update.usingSeat = () => Boolean(furniture);
  return update;
}
