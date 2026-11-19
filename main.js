import * as THREE from './js/vendor/three.module.min.js';
import { addWalkers } from './js/walkers.js';
import { loadTerrain } from './js/terrain.js';
import { createFollowCamera } from './js/follow-camera.js';
import { createDayNightCycle } from './js/day-night.js';
import { createInteractionOutline } from './js/interaction-outline.js';

const canvas = document.querySelector('#scene');
try {
  startScene(new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true }));
} catch (error) {
  document.querySelector('#error').hidden = false;
  console.error(error);
}

function startScene(renderer) {
  const scene = new THREE.Scene();
  const outline = createInteractionOutline(renderer);
  scene.background = new THREE.Color(0xffffff);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.localClippingEnabled = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 350);
  camera.up.set(0, 0, 1);
  const direction = new THREE.Vector3();
  const right = new THREE.Vector3();
  const motion = new THREE.Vector3();
  const lookPoint = new THREE.Vector3();
  let yaw = Math.PI * 0.66;
  let pitch = -Math.PI * 0.155;

  function updateLook() {
    direction.set(Math.cos(yaw) * Math.cos(pitch), Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch));
    camera.lookAt(lookPoint.copy(camera.position).add(direction));
  }
  const grid = new THREE.GridHelper(240, 240, 0xdbdce3, 0xdbdce3);
  grid.rotation.x = Math.PI / 2;
  grid.material.transparent = true;
  grid.material.opacity = 0.66;
  scene.add(grid);
  scene.fog = new THREE.Fog(0xffffff, 45, 170);

  function axis(end, color) {
    const geometry = new THREE.BufferGeometry().setFromPoints([end.clone().negate(), end]);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true }));
    line.position.z = 0.012;
    scene.add(line);
    return line.material;
  }
  const xAxis = axis(new THREE.Vector3(120, 0, 0), 0xd88c90);
  const yAxis = axis(new THREE.Vector3(0, 120, 0), 0x81bb9d);
  const updateDayNight = createDayNightCycle(scene);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.ShadowMaterial({ color: 0x494355, opacity: 0.13 }));
  floor.position.z = 0.006;
  floor.receiveShadow = true;
  scene.add(floor);

  let surface;
  const terrainReady = loadTerrain(scene).then(terrain => {
    surface = terrain;
    return terrain;
  }).catch(error => {
    console.error('Could not load terrain', error);
    const message = document.querySelector('#error');
    message.textContent = 'The terrain could not be loaded. Please reload the scene.';
    message.hidden = false;
  });
  const walkers = addWalkers(scene, [], terrainReady);

  const walkKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
  const controlKeys = new Set([...walkKeys, 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight']);
  const pressed = new Set();
  let lookPointer = null;
  let followingEve = false;
  let jumpPressed = false;
  let sitPressed = false;
  let movementPressed = false;

  function stopLooking() {
    if (lookPointer !== null && canvas.hasPointerCapture(lookPointer)) {
      canvas.releasePointerCapture(lookPointer);
    }
    lookPointer = null;
  }

  function clearInput() {
    pressed.clear();
    jumpPressed = false;
    sitPressed = false;
    movementPressed = false;
    stopLooking();
    clearHover();
  }

  window.addEventListener('keydown', event => {
    if (!controlKeys.has(event.code) || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.code !== 'ShiftLeft' && event.code !== 'ShiftRight') event.preventDefault();
    if (followingEve && !pressed.has(event.code) && !event.repeat) {
      if (event.code === 'KeyE') jumpPressed = true;
      if (event.code === 'KeyQ') {
        sitPressed = true;
        movementPressed = false;
      }
      if (walkKeys.has(event.code)) movementPressed = true;
    }
    pressed.add(event.code);
  });
  window.addEventListener('keyup', event => pressed.delete(event.code));
  window.addEventListener('blur', clearInput);
  document.addEventListener('visibilitychange', clearInput);

  const pointer = new THREE.Vector2();
  const picker = new THREE.Raycaster();
  let hovering = false;
  let nextHoverCheck = 0;

  function rememberPointer(event) {
    const bounds = canvas.getBoundingClientRect();
    pointer.set(2 * (event.clientX - bounds.left) / bounds.width - 1,
      1 - 2 * (event.clientY - bounds.top) / bounds.height);
  }
  function trackHover(event) {
    if (event.pointerType === 'touch' || !Number.isFinite(event.clientX)) return;
    rememberPointer(event);
    if (Math.abs(pointer.x) > 1 || Math.abs(pointer.y) > 1) {
      clearHover();
      return;
    }
    hovering = true;
    nextHoverCheck = 0;
  }
  function interactionAtPointer(eve) {
    camera.updateMatrixWorld();
    picker.setFromCamera(pointer, camera);
    const hit = surface?.pickInteraction(picker, eve.position);
    if (!hit || walkers.blocksPointer(picker, hit.distance)) return null;
    return hit.seat && !walkers.canSitOn(hit.seat) ? null : hit;
  }
  function clearHover() {
    hovering = false;
    outline.setTarget(null);
    canvas.style.cursor = '';
  }

  canvas.addEventListener('click', event => {
    const eve = walkers.getPlayer();
    if (event.button !== 0 || lookPointer !== null || !eve || !surface) return;
    rememberPointer(event);
    const hit = interactionAtPointer(eve);
    if (!hit) return;
    if (hit.toggle) hit.toggle();
    else if (walkers.sitOn(hit.seat)) {
      // Input that preceded the click must not immediately cancel the walk to the seat.
      movementPressed = sitPressed = jumpPressed = false;
    }
    nextHoverCheck = 0;
    canvas.focus({ preventScroll: true });
  });
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  canvas.addEventListener('pointerleave', clearHover);
  canvas.addEventListener('pointerenter', event => { if (lookPointer === null) trackHover(event); });
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 2 || lookPointer !== null) return;
    event.preventDefault();
    clearHover();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    lookPointer = event.pointerId;
  });
  canvas.addEventListener('pointermove', event => {
    if (lookPointer === null) {
      trackHover(event);
      return;
    }
    if (event.pointerId !== lookPointer) return;
    if (!(event.buttons & 2)) {
      stopLooking();
      return;
    }
    const turn = -event.movementX * 0.004;
    const tilt = -event.movementY * 0.004;
    const limit = Math.PI / 2 - 0.01;
    yaw += turn;
    pitch = THREE.MathUtils.clamp(pitch + tilt, -limit, limit);
    if (walkers.usingSeat()) {
      // A click can freeze the chase camera partway through a turn.
      camera.rotateOnWorldAxis(camera.up, turn);
      camera.getWorldDirection(direction);
      const elevation = Math.atan2(direction.z, Math.hypot(direction.x, direction.y));
      right.crossVectors(direction, camera.up).normalize();
      camera.rotateOnWorldAxis(right, THREE.MathUtils.clamp(elevation + tilt, -limit, limit) - elevation);
    } else if (!followingEve) updateLook();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, event => {
      if (event.pointerId !== lookPointer) return;
      stopLooking();
      if (type === 'pointerup') trackHover(event);
    });
  }

  function resize() {
    const { clientWidth: width, clientHeight: height } = canvas;
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }
  resize();
  const distance = Math.max(12.7, 10.8 / (2 * Math.tan(THREE.MathUtils.degToRad(17)) * camera.aspect));
  updateLook();
  camera.position.set(0, 0, 0.85).addScaledVector(direction, -distance);
  let cameraClearance = camera.position.z;
  new ResizeObserver(resize).observe(canvas);

  const followEve = createFollowCamera(camera);

  let lastFrame = performance.now();
  document.addEventListener('visibilitychange', () => { lastFrame = performance.now(); });
  renderer.setAnimationLoop(now => {
    const elapsed = Math.max(0, (now - lastFrame) / 1000);
    lastFrame = now;
    const forward = Number(pressed.has('KeyW')) - Number(pressed.has('KeyS'));
    const strafe = Number(pressed.has('KeyD')) - Number(pressed.has('KeyA'));
    const run = forward > 0 && (pressed.has('ShiftLeft') || pressed.has('ShiftRight'));
    walkers.update(elapsed, { forward, strafe, yaw, run, movementPressed, jump: jumpPressed, sit: sitPressed });
    jumpPressed = false;
    sitPressed = false;
    movementPressed = false;
    const eve = walkers.getPlayer();
    if (eve) {
      if (!followingEve) {
        followingEve = true;
        yaw = eve.rotation.z + Math.PI / 2;
        pitch = 0;
      }
      followEve(eve, yaw, pitch, elapsed, surface, walkers.usingSeat());
    } else {
      if (pressed.size) {
        motion.set(Math.cos(yaw), Math.sin(yaw), 0);
        right.crossVectors(motion, camera.up);
        motion.multiplyScalar(forward).addScaledVector(right, strafe);
        motion.z = Number(pressed.has('KeyE')) - Number(pressed.has('KeyQ'));
        motion.normalize().multiplyScalar(Math.min(elapsed, 0.05) * 4.5);
        camera.position.x += motion.x;
        camera.position.y += motion.y;
        cameraClearance = Math.max(0.15, cameraClearance + motion.z);
      }
      camera.position.z = (surface?.heightAt(camera.position.x, camera.position.y) ?? 0) + cameraClearance;
    }
    const brightness = updateDayNight(elapsed, camera.position, eve && surface?.getHouse() ? eve.position : null);
    grid.material.opacity = 0.08 + 0.58 * brightness;
    xAxis.opacity = yAxis.opacity = 0.18 + 0.82 * brightness;
    if (hovering && eve && now >= nextHoverCheck) {
      const target = interactionAtPointer(eve);
      outline.setTarget(target?.object ?? null);
      canvas.style.cursor = target ? 'pointer' : '';
      nextHoverCheck = now + 100;
    }
    renderer.render(scene, camera);
    outline.render(camera);
  });
}
