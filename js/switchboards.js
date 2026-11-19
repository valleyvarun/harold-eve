import { Box3, Group, MathUtils, Quaternion, Vector3 } from './vendor/three.module.min.js';
import { createLightCircuits } from './light-circuits.js';

// The export stores the rocker and its LED as separate nodes with a shared asset origin.
// Hinge them together at the rocker center. The raised LED marks the outward face.
function assembleRocker(rocker, indicator) {
  const bounds = new Box3();
  const center = bounds.setFromObject(rocker).getCenter(new Vector3());
  const axis = bounds.setFromObject(indicator).getCenter(new Vector3())
    .sub(center).cross(new Vector3(0, 0, 1)).normalize();
  const parent = rocker.parent;
  axis.applyQuaternion(parent.getWorldQuaternion(new Quaternion()).invert());
  const pivot = new Group();
  pivot.name = rocker.userData.switchId;
  pivot.position.copy(parent.worldToLocal(center));
  parent.add(pivot);
  pivot.attach(rocker);
  pivot.attach(indicator);
  return { pivot, axis };
}

export function createSwitchboards(house) {
  const lights = createLightCircuits(house);
  const rockers = [];
  const indicators = new Map();
  house.traverse(part => {
    const { interactionRole, switchId } = part.userData;
    if (interactionRole === 'switchRocker') rockers.push(part);
    if (interactionRole === 'switchIndicator') indicators.set(switchId, part);
  });

  const controls = new Map();
  for (const rocker of rockers) {
    const { switchId, circuitId } = rocker.userData;
    const { pivot, axis } = assembleRocker(rocker, indicators.get(switchId));
    lights.bind(circuitId, on => {
      pivot.setRotationFromAxisAngle(axis, on ? 0 : MathUtils.degToRad(6));
      pivot.updateWorldMatrix(true, true);
    });
    const control = { object: pivot, toggle: () => lights.toggle(circuitId) };
    pivot.traverse(part => { if (part.isMesh) controls.set(part, control); });
  }
  return { parts: [...controls.keys()], pick: hit => controls.get(hit.object) };
}
