import { MathUtils, Quaternion, Vector3 } from './vendor/three.module.min.js';

export function createFollowCamera(camera) {
  const chaseFov = camera.fov;
  const focus = new Vector3(), fullChase = new Vector3(), nextChase = new Vector3();
  const eye = new Vector3(), center = new Vector3(), probe = new Vector3();
  const direction = new Vector3(), target = new Vector3();
  const previousView = new Quaternion();
  let eyeAnchor;
  let firstPerson = false;
  let clearTime = 0;

  function chaseBlocked(end, surface) {
    if (!surface) return false;
    if (surface.cameraBlocked(focus, end)) return true;
    for (let i = 1; i <= 12; i++) {
      probe.lerpVectors(focus, end, i / 12);
      if (probe.z <= surface.heightAt(probe.x, probe.y) + 0.15) return true;
    }
    return false;
  }

  function placeAtEyes(eve, surface) {
    camera.position.copy(eye);
    // Eve leans forward while sitting down. Keep the lens on her side of a wall.
    center.set(eve.position.x, eve.position.y, eye.z);
    direction.subVectors(eye, center);
    const reach = direction.length();
    if (!surface || reach < 0.001) return;
    direction.divideScalar(reach);
    const margin = camera.near * Math.hypot(1, Math.tan(MathUtils.degToRad(camera.fov / 2)) * Math.hypot(1, camera.aspect));
    const extent = reach + margin;
    probe.copy(center).addScaledVector(direction, extent);
    if (surface.cameraBlocked(center, probe)) {
      let low = 0, high = extent;
      for (let i = 0; i < 6; i++) {
        const mid = (low + high) / 2;
        probe.copy(center).addScaledVector(direction, mid);
        if (surface.cameraBlocked(center, probe)) high = mid;
        else low = mid;
      }
      camera.position.copy(center).addScaledVector(direction, Math.max(0, low - margin));
    }
  }

  return function follow(eve, yaw, pitch, elapsed, surface, watchingSeat) {
    eyeAnchor ??= eve.getObjectByName('Eve eye position');
    eyeAnchor.getWorldPosition(eye);
    if (watchingSeat) {
      // Right-drag controls the view from the fixed click position. Reveal
      // Eve as soon as she moves clear of a camera anchored at eye level.
      center.set(eve.position.x, eve.position.y, eve.position.z + 0.35);
      direction.subVectors(eye, center);
      const t = MathUtils.clamp(probe.subVectors(camera.position, center).dot(direction) /
        Math.max(direction.lengthSq(), 0.001), 0, 1);
      probe.copy(center).addScaledVector(direction, t);
      eve.visible = probe.distanceToSquared(camera.position) > 0.5 ** 2;
      return;
    }
    focus.copy(eve.position);
    focus.z += 0.98;
    fullChase.set(focus.x - 5.5 * Math.cos(yaw), focus.y - 5.5 * Math.sin(yaw), focus.z + 1.8);

    const blend = 1 - Math.exp(-5 * elapsed);
    nextChase.lerpVectors(camera.position, fullChase, blend);
    // A fast turn can send the interpolated position straight through Eve.
    if (firstPerson || Math.hypot(nextChase.x - focus.x, nextChase.y - focus.y) < 3.6) {
      nextChase.copy(fullChase);
    }
    const ceiling = surface?.getHouse()?.ceiling(eye.x, eye.y, eye.z);
    const blocked = ceiling < eve.position.z + 3.8 || chaseBlocked(fullChase, surface) ||
      (nextChase.distanceToSquared(fullChase) > 0.0001 && chaseBlocked(nextChase, surface));
    const wasFirstPerson = firstPerson;
    if (blocked) {
      firstPerson = true;
      clearTime = 0;
    } else if (firstPerson) {
      clearTime += Math.min(elapsed, 0.1);
      firstPerson = clearTime < 0.55;
    }
    eve.visible = !firstPerson;
    if (firstPerson !== wasFirstPerson) {
      camera.fov = firstPerson ? 65 : chaseFov;
      camera.updateProjectionMatrix();
    }
    if (firstPerson) {
      placeAtEyes(eve, surface);
      direction.set(Math.cos(yaw) * Math.cos(pitch), Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch));
      camera.lookAt(target.copy(camera.position).add(direction));
      return;
    }

    camera.position.copy(nextChase);
    direction.subVectors(focus, nextChase);
    const lookYaw = Math.atan2(direction.y, direction.x);
    const elevation = Math.atan2(direction.z, Math.hypot(direction.x, direction.y));
    const lookPitch = MathUtils.clamp(elevation + pitch, -1.55, 1.55);
    direction.set(Math.cos(lookYaw) * Math.cos(lookPitch), Math.sin(lookYaw) * Math.cos(lookPitch), Math.sin(lookPitch));
    previousView.copy(camera.quaternion);
    camera.lookAt(target.copy(camera.position).add(direction));
    if (!wasFirstPerson) camera.quaternion.copy(previousView.slerp(camera.quaternion, blend));
  };
}
