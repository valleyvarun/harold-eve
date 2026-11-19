import { MathUtils, Quaternion, Vector3 } from './vendor/three.module.min.js';

const travelSeconds = 0.8;
// The entry and bathroom leaves first meet the building at 115° and 114° respectively.
const hingeTravel = MathUtils.degToRad(110);

export function createDoors(house) {
  const doors = [];
  const controls = new Map();
  const fixedGlass = new Map();

  house.traverse(assembly => {
    const binding = assembly.userData.doorBinding;
    if (!binding) return;
    const sliding = binding.motionType === 'sliding';
    const role = sliding ? 'doorSlidingPanel' : 'doorLeafPivot';
    const leaf = assembly.children.find(node => node.userData.interactionRole === role);
    if (!leaf) return;

    // Keep all interpolation in the exported pivot's local coordinates.
    let pose;
    if (sliding) {
      const closed = new Vector3().fromArray(binding.closedTranslation);
      const open = new Vector3().fromArray(binding.openTranslation);
      pose = amount => leaf.position.lerpVectors(closed, open, amount);
    } else {
      const rest = leaf.quaternion;
      const closed = rest.clone().multiply(new Quaternion().fromArray(binding.closedQuaternionRelativeToExportRest));
      const open = rest.clone().multiply(new Quaternion().fromArray(binding.openQuaternionRelativeToExportRest));
      // Extend the modeled open pose toward the stop, in the authored swing direction.
      const extra = Math.max(0, hingeTravel - closed.angleTo(open));
      const axis = new Vector3().fromArray(binding.axis).normalize();
      open.multiply(new Quaternion().setFromAxisAngle(axis, Math.sign(binding.authoredOpenAngleDegrees) * extra));
      pose = amount => leaf.quaternion.slerpQuaternions(closed, open, amount);
    }
    // The two hinged doors are modeled open and the slider is modeled closed.
    const progress = sliding ? 0 : 1;
    const door = { leaf, pose, progress, target: progress };
    apply(door, progress);
    doors.push(door);
    const control = { object: leaf, toggle: () => { door.target = 1 - door.target; } };
    leaf.traverse(part => { if (part.isMesh) controls.set(part, control); });
    if (sliding) {
      const fixed = assembly.children.find(node => node.userData.interactionRole === 'doorFixedAssembly');
      fixed?.traverse(part => {
        if (part.isMesh && part.material.transparent) fixedGlass.set(part, control);
      });
    }
  });

  // The open balcony panel parks behind its fixed window. It is still visible
  // through that glass, but the opaque rails and anything in between block it.
  function visibleHit(hits) {
    const first = hits[0];
    const slider = first && fixedGlass.get(first.object);
    if (!slider) return first;
    const behind = hits.find(hit => fixedGlass.get(hit.object) !== slider);
    return behind && controls.get(behind.object) === slider ? behind : first;
  }

  function apply(door, progress) {
    door.pose(MathUtils.smoothstep(progress, 0, 1));
    door.leaf.updateWorldMatrix(true, true);
  }

  function update(elapsed, canMoveDoor) {
    let moved = false;
    for (const door of doors) {
      const start = door.progress;
      const end = MathUtils.clamp(door.target, start - elapsed / travelSeconds, start + elapsed / travelSeconds);
      // Limit each swept step even if a long frame crosses an entire doorway.
      const steps = Math.ceil(Math.abs(end - start) * 32);
      for (let i = 1; i <= steps; i++) {
        const next = i === steps ? end : MathUtils.lerp(start, end, i / steps);
        apply(door, next);
        if (canMoveDoor && !canMoveDoor(door.leaf)) {
          apply(door, door.progress);
          break;
        }
        door.progress = next;
        moved = true;
      }
    }
    return moved;
  }

  return {
    leaves: doors.map(door => door.leaf), parts: [...controls.keys()],
    pick: hit => controls.get(hit.object), visibleHit, update
  };
}
