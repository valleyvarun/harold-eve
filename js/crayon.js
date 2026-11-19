import * as THREE from './vendor/three.module.min.js';

// The crayon is modeled in meters and attached across the right palm.
function attachCrayon(hand) {
  const crayon = new THREE.Group();
  crayon.name = 'Purple crayon';
  const wax = new THREE.MeshStandardMaterial({ color: 0x6825b0, roughness: 0.82 });
  const paper = new THREE.MeshStandardMaterial({ color: 0xb08bdd, roughness: 0.94 });
  function addPart(bottom, top, length, center, material) {
    const part = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, length, 14), material);
    part.position.y = center;
    crayon.add(part);
  }
  addPart(0.014, 0.014, 0.163, 0, wax);
  addPart(0.0146, 0.0146, 0.122, -0.004, paper);
  for (const band of [-0.055, 0.048]) addPart(0.015, 0.015, 0.005, band, wax);
  addPart(0.014, 0.0014, 0.035, 0.099, wax);
  const tip = new THREE.Object3D();
  tip.name = 'Crayon tip';
  tip.position.y = 0.1165;
  crayon.add(tip);

  hand.add(crayon);
  crayon.scale.setScalar(1 / hand.getWorldScale(new THREE.Vector3()).x);
  crayon.position.set(12.1, 3.2, 0);
  crayon.rotation.x = Math.PI / 2;
  return tip;
}

export function makeCrayon(hand, poseArm) {
  const tip = attachCrayon(hand);
  // Reuse short wax-colored segments as a ring buffer during long sessions.
  const capacity = 4096;
  const marks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.006, 0.006, 1, 6),
    new THREE.MeshBasicMaterial({ color: 0x7b2fc0 }),
    capacity
  );
  marks.name = 'Purple crayon strokes';
  marks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  marks.count = 0;
  marks.frustumCulled = false;
  const up = new THREE.Vector3(0, 1, 0);
  const previous = new THREE.Vector3(), current = new THREE.Vector3();
  const delta = new THREE.Vector3(), segment = new THREE.Object3D();
  let slot = 0, hasPrevious = false;
  let inkDown = false, remaining = 0;
  let phase = 0, sweep = 0, speed = 0, sweepSpeed = 0, elapsed = 0;

  return function draw(dt, scene) {
    if (!marks.parent) scene.add(marks);
    remaining -= dt;
    elapsed += dt;
    if (remaining <= 0) {
      inkDown = !inkDown;
      remaining = inkDown ? THREE.MathUtils.randFloat(0.65, 1.9) : THREE.MathUtils.randFloat(0.24, 0.65);
      speed = THREE.MathUtils.randFloat(2.5, 6.8);
      sweepSpeed = THREE.MathUtils.randFloat(2.0, 4.8);
      hasPrevious = false;
    }
    phase += speed * dt;
    sweep += sweepSpeed * dt;
    const blend = THREE.MathUtils.smoothstep(elapsed, 0, 0.42);
    poseArm(blend * (-0.85 + 0.46 * Math.sin(phase)), blend * (-0.65 + 0.24 * Math.cos(sweep)),
      blend * (0.28 + 0.28 * Math.sin(sweep)), blend * 0.18 * Math.cos(phase));
    if (!inkDown) return;
    tip.getWorldPosition(current);
    if (!hasPrevious) {
      previous.copy(current);
      hasPrevious = true;
      return;
    }
    delta.subVectors(current, previous);
    const length = delta.length();
    if (length < 0.014) return;
    segment.position.copy(previous).lerp(current, 0.5);
    segment.quaternion.setFromUnitVectors(up, delta.divideScalar(length));
    segment.scale.y = length + 0.001;
    segment.updateMatrix();
    marks.setMatrixAt(slot, segment.matrix);
    marks.instanceMatrix.addUpdateRange(slot * 16, 16);
    marks.instanceMatrix.needsUpdate = true;
    slot = (slot + 1) % capacity;
    marks.count = Math.min(marks.count + 1, capacity);
    previous.copy(current);
  };
}
