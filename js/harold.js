import * as THREE from './vendor/three.module.min.js';
import { makeSoleSupport } from './sole-support.js';
import { makeCrayon } from './crayon.js';

// The supplied take is a combat sequence. Build a distance-driven walk from
// the mannequin's neutral bind pose so its feet follow its travel speed.
export function prepareHarold(gltf) {
  const figure = gltf.scene;
  const meshes = [];
  let skeleton;
  figure.traverse(part => {
    if (!part.isSkinnedMesh) return;
    meshes.push(part);
    skeleton = part.skeleton;
    part.castShadow = true;
    part.frustumCulled = false;
  });
  skeleton.pose();
  figure.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(figure, true);
  const joints = new Map(skeleton.bones.map(bone => [
    bone.name.replace(/^Bip001[ _]/, '').replace(/_\d+$/, '').replaceAll('_', ' '),
    bone
  ]));
  const xAxis = new THREE.Vector3(1, 0, 0);
  const zAxis = new THREE.Vector3(0, 0, 1);
  // Store each model-space hinge axis in its joint's local frame.
  function hinge(name, axis) {
    const bone = joints.get(name);
    const rest = bone.quaternion.clone();
    const localAxis = axis.clone().applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()).invert());
    const rotation = new THREE.Quaternion();
    return angle => bone.quaternion.copy(rest).multiply(rotation.setFromAxisAngle(localAxis, angle));
  }
  const inwardTilt = THREE.MathUtils.degToRad(1.5);
  const legs = ['L', 'R'].map((side, index) => {
    const sign = index === 0 ? 1 : -1;
    const foot = joints.get(side + ' Foot');
    const sole = new THREE.Object3D();
    foot.getWorldPosition(sole.position);
    sole.position.y = bounds.min.y;
    foot.worldToLocal(sole.position);
    foot.add(sole);
    // Bring each leg inward at the hip and keep the sole level at the ankle.
    hinge(side + ' Thigh', zAxis)(-sign * inwardTilt);
    hinge(side + ' Foot', zAxis)(sign * inwardTilt);
    const thigh = hinge(side + ' Thigh', xAxis);
    const knee = hinge(side + ' Calf', xAxis);
    const ankle = hinge(side + ' Foot', xAxis);
    // Relax the arms from the splayed bind pose before swinging them.
    hinge(side + ' UpperArm', zAxis)(-sign * 0.52);
    const shoulder = hinge(side + ' UpperArm', xAxis);
    const elbow = hinge(side + ' Forearm', xAxis);
    const wrist = hinge(side + ' Hand', xAxis);
    return { thigh, knee, ankle, shoulder, elbow, wrist, sole };
  });

  const drawingArm = joints.get('R UpperArm');
  const armSideAxis = zAxis.clone().applyQuaternion(drawingArm.getWorldQuaternion(new THREE.Quaternion()).invert());
  const model = new THREE.Group();
  const posture = new THREE.Group();
  figure.scale.setScalar(1.75 / (bounds.max.y - bounds.min.y));
  figure.rotation.set(Math.PI / 2, 0, Math.PI, 'ZXY');
  model.add(posture);
  posture.add(figure);
  const point = new THREE.Vector3();
  const hipHeight = joints.get('Pelvis').getWorldPosition(point).z;
  model.updateMatrixWorld(true);

  // The opening pitches the rig around its left-right axis. Keep the outline
  // vertices around each bone for checking floor contact in all those poses.
  const feet = [];
  const support = meshes.map(mesh => {
    const byBone = new Map();
    const footVertices = { L: [], R: [] };
    const footSide = mesh.skeleton.bones.map(bone => bone.name.match(/[ _]([LR])[ _](?:Foot|Toe)/)?.[1]);
    const vertices = mesh.geometry.attributes.position;
    const indices = mesh.geometry.attributes.skinIndex;
    const weights = mesh.geometry.attributes.skinWeight;
    const angles = Array.from({ length: 36 }, (_, i) => {
      const angle = i * Math.PI / 18;
      return [Math.sin(angle), Math.cos(angle)];
    });
    for (let i = 0; i < vertices.count; i++) {
      let primary = 0;
      for (let k = 1; k < 4; k++) {
        if (weights.getComponent(i, k) > weights.getComponent(i, primary)) primary = k;
      }
      const bone = indices.getComponent(i, primary);
      if (footSide[bone]) footVertices[footSide[bone]].push(i);
      if (!byBone.has(bone)) byBone.set(bone, angles.map(() => ({ value: -Infinity, index: 0 })));
      const outline = byBone.get(bone);
      mesh.localToWorld(mesh.getVertexPosition(i, point));
      for (let a = 0; a < angles.length; a++) {
        const value = point.y * angles[a][0] + point.z * angles[a][1];
        if (value > outline[a].value) { outline[a].value = value; outline[a].index = i; }
      }
    }
    for (const indices of Object.values(footVertices)) {
      if (indices.length) feet.push({ mesh, indices });
    }
    return { mesh, indices: [...new Set([...byBone.values()].flat().map(entry => entry.index))] };
  });
  const supportHeight = makeSoleSupport(model, feet);

  // Seconds, torso recline, hip, knee, shoulder, elbow and wrist (degrees).
  const opening = [
    [0,   18, -36, 73, -74, -25, 0],
    [.62, 50, -30, 52, -53, -25, 0],
    [.9,  84,   0,  8,  -6, -16, 0],
    [1.01,88,  -6, 14, -13, -20, 0],
    [1.12,86,  -2, 10,  -6, -13, 0],
    [1.9, 86,  -2, 10,  -6, -13, 0],
    [2.25,43, -52, 20, -60, -29, 0],
    [2.55, 7, -86, 16, -41, -26, 0],
    [2.95,11, -94, 27,  38, -29, 53],
    [3.23, 9,-114, 63,  20,  10, 29],
    [3.55,-30,-138,102, -18, -17, 38],
    [3.88,-24, -70, 80, -38, -32, 12],
    [4.35, -2,  -9, 18,  -6, -14, 0],
    [4.9,   0,   0,  0,   0,   0, 0]
  ];
  const values = new Float64Array(6);
  const local = new THREE.Matrix4();
  const meshToModel = new THREE.Matrix4();
  function poseIntro(time) {
    const end = opening.findIndex(key => key[0] >= time);
    const frame = end < 0 ? opening.length - 1 : Math.max(1, end);
    const a = opening[frame - 1], b = opening[frame];
    const blend = THREE.MathUtils.smoothstep(time, a[0], b[0]);
    for (let k = 0; k < values.length; k++) {
      values[k] = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(a[k + 1], b[k + 1], blend));
    }
    const [recline, hip, knee, shoulder, elbow, wrist] = values;
    const standBlend = THREE.MathUtils.smoothstep(time, 4.35, 4.9);
    figure.position.z = 0;
    posture.rotation.x = recline;
    posture.position.set(0, hipHeight * Math.sin(recline), 0);
    legs.forEach(leg => {
      const kneeAngle = knee + standBlend * 0.08;
      leg.thigh(hip);
      leg.knee(kneeAngle);
      leg.ankle((recline - hip - kneeAngle) * THREE.MathUtils.smoothstep(time, 2.65, 3.55));
      leg.shoulder(shoulder);
      leg.elbow(elbow - standBlend * 0.17);
      leg.wrist(wrist);
    });
    model.updateMatrixWorld(true);
    local.copy(model.matrixWorld).invert();
    let lowest = Infinity;
    for (const { mesh, indices } of support) {
      meshToModel.multiplyMatrices(local, mesh.matrixWorld);
      for (const i of indices) {
        mesh.getVertexPosition(i, point).applyMatrix4(meshToModel);
        lowest = Math.min(lowest, point.z);
      }
    }
    posture.position.z = -lowest;
  }
  function animate(distanceTravelled) {
    posture.rotation.x = 0;
    posture.position.set(0, 0, 0);
    const phase = distanceTravelled * Math.PI * 2 / 1.13;
    const amplitude = THREE.MathUtils.smoothstep(distanceTravelled, 0, 0.25);
    legs.forEach((leg, index) => {
      const step = phase + index * Math.PI;
      const swing = Math.sin(step) * amplitude;
      const thighAngle = -0.35 * swing;
      const kneeAngle = 0.08 + amplitude * 0.55 * Math.max(0, Math.cos(step));
      leg.thigh(thighAngle);
      leg.knee(kneeAngle);
      leg.ankle(-thighAngle - kneeAngle);
      leg.shoulder(0.31 * swing);
      leg.elbow(-0.17 + 0.08 * swing);
      leg.wrist(0);
    });
    let lowest = Infinity;
    for (const { sole } of legs) {
      sole.getWorldPosition(point);
      lowest = Math.min(lowest, model.worldToLocal(point).z);
    }
    figure.position.z -= lowest;
  }
  animate(0);
  const hand = joints.get('R Hand');
  // Curl the fingers around the barrel, keeping the thumb opposite the grip.
  for (const finger of [1, 2, 3, 4]) {
    joints.get('R Finger' + finger).rotateZ(0.55);
    joints.get('R Finger' + finger + '1').rotateZ(0.95);
    joints.get('R Finger' + finger + '2').rotateZ(0.75);
  }
  const draw = makeCrayon(hand, (lift, bend, sideways, tilt) => {
    const arm = legs[1];
    arm.shoulder(lift);
    drawingArm.rotateOnAxis(armSideAxis, sideways);
    arm.elbow(bend);
    arm.wrist(tilt);
  });
  return { model, animate, poseIntro, supportHeight, draw };
}
