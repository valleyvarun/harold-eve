import * as THREE from './vendor/three.module.min.js';
import { makeSoleSupport } from './sole-support.js';

const runStride = 3.5; // meters from one left foot strike to the next

function makeRunClip(hip, duration) {
  // One leg, from touchdown through compression, toe-off, heel recovery and return.
  // Thigh, shin, foot, upper arm and forearm pitches, in degrees.
  const poses = [
    [-35, -13,  -6,  29,  -47],
    [-27,  12,   0,  13,  -70],
    [ -7,  25,   0, -12,  -97],
    [ 17,  39,  23, -36, -118],
    [ 32,  66,  52, -53, -129],
    [ 19, 120,  82, -60, -133],
    [ -9, 126,  81, -50, -124],
    [-43,  94,  49, -28, -108],
    [-68,  53,  20,  -2,  -88],
    [-72,   5,   0,  16,  -72],
    [-59, -27,  -8,  29,  -55],
    [-46, -25,  -8,  34,  -45]
  ];
  // Wrap the poses at both ends so the heel and arm arcs stay smooth across strides.
  const wrapped = [poses.at(-1), ...poses, poses[0], poses[1]];
  const curve = new THREE.CubicInterpolant(
    wrapped.map((_, i) => (i - 1) / poses.length), Float32Array.from(wrapped.flat()), 5
  );
  const phases = Array.from({ length: 61 }, (_, i) => i / 60);
  const times = phases.map(phase => phase * duration);
  const rotations = angles => angles.flatMap(angle => {
    const halfAngle = THREE.MathUtils.degToRad(angle) / 2;
    return [Math.sin(halfAngle), 0, 0, Math.cos(halfAngle)];
  });
  // The trunk tips forward under load and opens slightly on push-off.
  const lean = phase => 12 + 2.5 * Math.sin(4 * Math.PI * phase);
  const pitches = phases.map(lean);
  const origins = pitches.flatMap(pitch => {
    const angle = THREE.MathUtils.degToRad(pitch);
    return [0, 0, hip.z * (1 - Math.cos(angle)) - hip.y * Math.sin(angle)];
  });
  const tracks = [
    new THREE.QuaternionKeyframeTrack('Body.quaternion', times, rotations(pitches)),
    new THREE.VectorKeyframeTrack('Body.position', times, origins)
  ];
  for (const [side, offset] of [['L', 0], ['R', 0.5]]) {
    const keys = phases.map(phase => {
      const [thigh, shin, foot, arm, forearm] = curve.evaluate((phase + offset) % 1);
      return [thigh - lean(phase), shin - thigh, foot - shin, arm - lean(phase), forearm - arm];
    });
    for (const [joint, name] of ['Hip', 'Knee', 'Ankle', 'Shoulder', 'Elbow'].entries()) {
      tracks.push(new THREE.QuaternionKeyframeTrack(name + side + '.quaternion', times, rotations(keys.map(key => key[joint]))));
    }
  }
  return new THREE.AnimationClip('Run', duration, tracks);
}

export function prepareEve(gltf) {
  const figure = gltf.scene;
  figure.rotation.order = 'ZXY';
  figure.rotation.set(Math.PI / 2, 0, Math.PI);
  figure.scale.setScalar(1.08);
  figure.traverse(part => {
    if (part.isMesh) part.castShadow = true;
  });

  const model = new THREE.Group();
  model.name = 'Eve';
  model.add(figure);
  const mixer = new THREE.AnimationMixer(figure);
  const walk = THREE.AnimationClip.findByName(gltf.animations, 'Walk').clone();
  // Tilt the shoulders forward in the rig's frame throughout the arm swing.
  const shoulderTilt = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(-10)
  );
  const pose = new THREE.Quaternion();
  for (const track of walk.tracks) {
    if (track.name !== 'ShoulderL.quaternion' && track.name !== 'ShoulderR.quaternion') continue;
    for (let i = 0; i < track.values.length; i += 4) {
      pose.fromArray(track.values, i).premultiply(shoulderTilt).toArray(track.values, i);
    }
  }
  const { poseIntro, groundFeet, parts, limbs } = prepareRecovery(figure);
  // The mixer blends the first step from this planted standing position.
  poseIntro(4.9);
  const walkAction = mixer.clipAction(walk).play();
  const stride = figure.userData.walkCycleDistance;
  const runAction = mixer.clipAction(makeRunClip(limbs[0][0].position, walk.duration)).play();
  let previousDistance = 0;
  let cycle = 0;
  let suspension = 0;
  const body = parts[0];
  // Eve's head is part of the rigid Body mesh. This is the eye line in its local coordinates.
  const eyePosition = new THREE.Object3D();
  eyePosition.name = 'Eve eye position';
  eyePosition.position.set(0, 1.51, 0.081);
  body.add(eyePosition);
  const walkOrigin = new THREE.Vector3();
  const walkPose = parts.map(() => new THREE.Quaternion());
  let action = 'walk';

  // Keep the mixer's last pose so a hand-posed action can return to the same stride.
  function saveWalkPose(nextAction) {
    if (action === 'walk') {
      walkOrigin.copy(body.position);
      parts.forEach((part, index) => walkPose[index].copy(part.quaternion));
    }
    action = nextAction;
  }
  function restoreWalkPose() {
    body.position.copy(walkOrigin);
    parts.forEach((part, index) => part.quaternion.copy(walkPose[index]));
  }

  // Advance the clip by ground distance so the planted foot stays in place.
  function animate(distanceTravelled, runWeight = 0) {
    if (action !== 'walk') {
      restoreWalkPose();
      action = 'walk';
    }
    const weight = THREE.MathUtils.smoothstep(distanceTravelled, 0, 0.25);
    if (distanceTravelled < previousDistance) {
      previousDistance = 0;
      cycle = 0;
    }
    const delta = distanceTravelled - previousDistance;
    cycle = (cycle + delta / THREE.MathUtils.lerp(stride, runStride, runWeight)) % 1;
    previousDistance = distanceTravelled;
    walkAction.setEffectiveWeight(weight * (1 - runWeight));
    runAction.setEffectiveWeight(weight * runWeight);
    mixer.setTime(cycle * walk.duration);
    if (weight < 1 || runWeight > 0) groundFeet();
    // A run has a short aerial phase between toe-off and the next foot strike.
    const flightPhase = THREE.MathUtils.clamp(((cycle * 2) % 1 - 0.6) / 0.4, 0, 1);
    suspension = 0.11 * 4 * flightPhase * (1 - flightPhase) * weight * runWeight;
  }
  animate(0);
  function vertices(mesh) {
    const indices = Array.from({ length: mesh.geometry.attributes.position.count }, (_, i) => i);
    return { mesh, indices };
  }
  const footHeight = makeSoleSupport(model, limbs.map(side => vertices(side[2])));
  poseIntro(2.55);
  const seatedHeight = makeSoleSupport(model, parts.map(vertices));
  poseIntro(4.9);

  let sitProgress = 0;
  let previousSit = 0;
  function poseSit(amount) {
    if (action !== 'sit') {
      previousSit = 0;
      sitProgress = 0;
    }
    saveWalkPose('sit');
    // Reverse the hand-assisted stand to lower her seat to the ground.
    poseIntro(THREE.MathUtils.lerp(4.9, 2.55, THREE.MathUtils.clamp(amount, 0, 1)));
    sitProgress += Math.abs(amount - previousSit);
    previousSit = amount;
    // Settle the stride she entered from before bending down.
    if (sitProgress < 0.2) {
      const fromWalk = 1 - THREE.MathUtils.smoothstep(sitProgress, 0, 0.2);
      parts.forEach((part, index) => part.quaternion.slerp(walkPose[index], fromWalk));
      body.position.lerp(walkOrigin, fromWalk);
      groundFeet();
    }
  }

  // Bend at the hips and knees while keeping both soles on the floor.
  // The final thigh angle puts the underside of the pelvis on this cushion.
  body.geometry.computeBoundingBox();
  const [hip, knee, ankle] = limbs[0];
  ankle.geometry.computeBoundingBox();
  const pelvisHeight = body.geometry.boundingBox.min.y;
  const ankleToSole = ankle.geometry.boundingBox.min.y;
  function poseOnSeat(amount, cushionHeight) {
    saveWalkPose('chair');
    const t = THREE.MathUtils.smootherstep(amount, 0, 1);
    const thighLength = Math.hypot(knee.position.y, knee.position.z);
    const kneeDrop = pelvisHeight - hip.position.y - ankle.position.y - ankleToSole - cushionHeight / figure.scale.y;
    const seatedThigh = -Math.acos(THREE.MathUtils.clamp(-kneeDrop / thighLength, -1, 1)) -
      Math.atan2(-knee.position.z, -knee.position.y);
    const thigh = seatedThigh * t;
    const lean = 0.32 * Math.sin(t * Math.PI);
    body.position.set(0, 0, hip.position.z - hip.position.y * Math.sin(lean) - hip.position.z * Math.cos(lean));
    body.rotation.x = lean;
    for (const [upper, lower, foot, shoulder, elbow] of limbs) {
      upper.rotation.x = thigh - lean;
      lower.rotation.x = -thigh;
      foot.rotation.x = 0;
      shoulder.rotation.x = -0.16 - lean;
      elbow.rotation.x = -1.10 * t;
    }
    groundFeet();
  }

  function poseOnBed(amount, mattressHeight) {
    // Plant both feet while sitting on the edge. This same path plays backward on exit.
    poseOnSeat(Math.min(1, amount / 0.33), mattressHeight);
    if (amount <= 0.33) return;
    const lift = THREE.MathUtils.smootherstep(amount, 0.33, 0.58);
    const settle = THREE.MathUtils.smootherstep(amount, 0.66, 1);
    const thigh = THREE.MathUtils.lerp(limbs[0][0].rotation.x, -1.98, lift) + 0.32 * settle;
    const shin = -1.50 * lift;
    const torso = -1.54 * settle;
    const hipHeight = THREE.MathUtils.lerp(body.position.y + hip.position.y,
      mattressHeight / figure.scale.y + 0.103, settle);
    body.position.set(0, hipHeight - hip.position.y * Math.cos(torso) + hip.position.z * Math.sin(torso),
      hip.position.z - hip.position.y * Math.sin(torso) - hip.position.z * Math.cos(torso));
    body.rotation.x = torso;
    for (const [upper, lower, foot, shoulder, elbow] of limbs) {
      upper.rotation.x = thigh - torso;
      lower.rotation.x = shin - thigh;
      foot.rotation.x = -1.35 * lift - shin;
      shoulder.rotation.x = -0.16 - 0.13 * settle;
      elbow.rotation.x = -1.10 + 0.80 * settle;
    }
  }

  function poseJump(phase) {
    saveWalkPose('jump');
    restoreWalkPose();
    const tuck = Math.sin(Math.PI * THREE.MathUtils.clamp(phase, 0, 1)) ** 2;
    for (const [thigh, knee, ankle, shoulder, elbow] of limbs) {
      thigh.rotation.x -= 0.58 * tuck;
      knee.rotation.x += 0.94 * tuck;
      ankle.rotation.x -= 0.36 * tuck;
      shoulder.rotation.x -= 0.7 * tuck;
      elbow.rotation.x -= 0.35 * tuck;
    }
    groundFeet();
  }
  function supportHeight(heightAt) {
    if (action === 'sit') return seatedHeight(heightAt);
    return footHeight(heightAt) + (action === 'walk' ? suspension : 0);
  }
  return { model, animate, poseIntro, poseSit, poseOnSeat, poseOnBed, poseJump, supportHeight };
}

// Torso, thigh, shin, foot, upper arm and forearm pitches in the rig's
// sagittal plane. Absolute pitches let the torso sit up over resting legs.
const recoveryKeys = [
  [0,    -22,  -36,   7,   7, -133, -159],
  [0.55, -55,  -77, -24, -31, -119, -146],
  [0.9,  -84, -107, -69, -69, -110, -117],
  [1.12, -87,  -98, -82, -81, -111,  -98],
  [1.9,  -87,  -98, -82, -81, -111,  -98],
  [2.25, -45, -101, -79, -68, -104, -124],
  [2.55,   4, -118, -65, -58,  -61,  -85],
  [2.95,  15, -144, -28, -12,   13,  -28],
  [3.36,  45, -125,  29,   0,   24,  -12],
  [3.75,  33,  -76,  41,   0,   21,  -11],
  [4.15,  15,  -33,  18,   0,   -1,  -18],
  [4.35,   0,   -4,   3,   0,   -6,  -14],
  [4.9,    0,    0,   0,   0,  -10,  -20]
];

function prepareRecovery(figure) {
  const body = figure.getObjectByName('Body');
  const limbs = ['L', 'R'].map(side =>
    ['Hip', 'Knee', 'Ankle', 'Shoulder', 'Elbow'].map(name => figure.getObjectByName(name + side))
  );
  const parts = [body, ...limbs.flat()];
  const radians = THREE.MathUtils.degToRad;
  const ease = THREE.MathUtils.smootherstep;
  const pose = new Float64Array(6);
  const relative = new THREE.Matrix4();
  const inverse = new THREE.Matrix4();
  const point = new THREE.Vector3();
  const stanceFoot = limbs[0][2];
  const plantedDepth = figure.worldToLocal(stanceFoot.getWorldPosition(point)).z;

  // Retain the extremal vertices at a range of pitches. These small outlines
  // let the back, seat, heels or hands support the pose as Eve rolls upright.
  const outlines = parts.map(part => {
    const points = part.geometry.attributes.position;
    const support = new Set();
    for (let k = 0; k < 32; k++) {
      const angle = k * Math.PI / 16;
      const cy = Math.cos(angle), cz = Math.sin(angle);
      let minimum = Infinity, best = 0;
      for (let i = 0; i < points.count; i++) {
        const height = points.getY(i) * cy - points.getZ(i) * cz;
        if (height < minimum) { minimum = height; best = i; }
      }
      support.add(best);
    }
    return Array.from(support, index => new THREE.Vector3().fromBufferAttribute(points, index));
  });
  const handTips = limbs.map(side => {
    const outline = outlines[parts.indexOf(side[4])];
    return outline.reduce((a, b) => a.y < b.y ? a : b);
  });
  function ground(includeArms) {
    figure.updateWorldMatrix(true, true);
    inverse.copy(figure.matrixWorld).invert();
    let minimum = Infinity;
    parts.forEach((part, index) => {
      if (!includeArms && (part.name.startsWith('Shoulder') || part.name.startsWith('Elbow'))) return;
      relative.multiplyMatrices(inverse, part.matrixWorld);
      for (const vertex of outlines[index]) {
        minimum = Math.min(minimum, point.copy(vertex).applyMatrix4(relative).y);
      }
    });
    body.position.y -= minimum;
  }

  // Bend at both joints to keep each hand on its support point as the
  // shoulders rise. The fingertips are part of each rigid forearm mesh.
  function plantHand(side, tip, weight) {
    const shoulder = side[3], elbow = side[4];
    shoulder.updateWorldMatrix(true, false);
    point.setFromMatrixPosition(shoulder.matrixWorld).applyMatrix4(inverse);
    const dy = -point.y, dz = 0.005 - point.z;
    const upper = Math.hypot(elbow.position.y, elbow.position.z);
    const lower = Math.hypot(tip.y, tip.z);
    const bend = -Math.acos(THREE.MathUtils.clamp(
      (dy * dy + dz * dz - upper * upper - lower * lower) / (2 * upper * lower), -1, 1
    ));
    const upperAngle = Math.atan2(-dz, -dy) - Math.atan2(lower * Math.sin(bend), upper + lower * Math.cos(bend));
    const shoulderAngle = upperAngle - Math.atan2(-elbow.position.z, -elbow.position.y) - body.rotation.x;
    const elbowAngle = upperAngle + bend - Math.atan2(-tip.z, -tip.y) - shoulderAngle - body.rotation.x;
    shoulder.rotation.x = THREE.MathUtils.lerp(shoulder.rotation.x, shoulderAngle, weight);
    elbow.rotation.x = THREE.MathUtils.lerp(elbow.rotation.x, elbowAngle, weight);
  }

  function poseIntro(time) {
    const last = recoveryKeys.length - 1;
    let end = 1;
    while (end < last && time > recoveryKeys[end][0]) end++;
    const a = recoveryKeys[end - 1], b = recoveryKeys[end];
    const blend = ease(time, a[0], b[0]);
    for (let i = 0; i < pose.length; i++) {
      pose[i] = radians(THREE.MathUtils.lerp(a[i + 1], b[i + 1], blend));
    }
    const [torso, thigh, shin, foot, arm, forearm] = pose;
    body.rotation.x = torso;
    // Rotate the trunk about the hips, which sit above the mesh origin.
    const hip = limbs[0][0].position;
    body.position.set(0, 0, hip.z - hip.y * Math.sin(torso) - hip.z * Math.cos(torso));
    for (const [upperLeg, knee, ankle, shoulder, elbow] of limbs) {
      upperLeg.rotation.x = thigh - torso;
      knee.rotation.x = shin - thigh;
      ankle.rotation.x = foot - shin;
      shoulder.rotation.x = arm - torso;
      elbow.rotation.x = forearm - arm;
    }
    ground(false);
    const support = ease(time, 2.55, 2.95) * (1 - ease(time, 3.40, 3.75));
    if (support > 0) limbs.forEach((side, i) => plantHand(side, handTips[i], support));
    ground(true);
    // Carry the hips over the planted lead foot as Eve straightens up.
    const plant = ease(time, 3.38, 3.75);
    if (plant > 0) {
      const depth = stanceFoot.getWorldPosition(point).applyMatrix4(inverse).z;
      body.position.z += (plantedDepth - depth) * plant;
    }
  }
  return { poseIntro, groundFeet: () => ground(false), parts, limbs };
}
