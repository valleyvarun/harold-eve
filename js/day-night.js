import * as THREE from './vendor/three.module.min.js';
import { createInteriorLighting } from './interior-light.js';

const daySeconds = 20;
const nightSeconds = 20;
const cycleSeconds = daySeconds + nightSeconds;

function createSky(sunDirection, horizon, zenith) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      horizon: { value: horizon }, zenith: { value: zenith },
      sunDirection: { value: sunDirection }, sunColor: { value: new THREE.Color() }
    },
    vertexShader: `
      varying vec3 skyDirection;
      void main() {
        skyDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w;
      }
    `,
    fragmentShader: `
      uniform vec3 horizon, zenith, sunDirection, sunColor;
      varying vec3 skyDirection;
      void main() {
        vec3 view = normalize(skyDirection);
        vec3 color = mix(horizon, zenith, smoothstep(0.0, 0.85, view.z));
        float radius = length(view - sunDirection);
        float disc = 1.0 - smoothstep(0.009, 0.011, radius);
        float halo = 0.34 * (1.0 - smoothstep(0.009, 0.09, radius));
        float aboveHorizon = smoothstep(-0.002, 0.004, view.z);
        color = mix(color, sunColor, max(disc, halo) * aboveHorizon);
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }
    `
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
  sky.name = 'Sky';
  sky.frustumCulled = false;
  sky.renderOrder = 1;
  return sky;
}

export function createDayNightCycle(scene) {
  const sun = new THREE.DirectionalLight(0xfffaf3, 2.55);
  sun.name = 'Sun';
  sun.target.position.set(-1, 2, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // Center the shadow volume on the raised house as the light circles it.
  Object.assign(sun.shadow.camera, { left: -27, right: 27, bottom: -27, top: 27, near: 0.5, far: 80 });
  sun.shadow.camera.up.set(0, 0, 1);
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.normalBias = 0.02;
  const ambient = new THREE.HemisphereLight(0xfffcff, 0xd4d2e2, 2.05);
  ambient.position.set(0, 0, 1);
  const updateInteriorLight = createInteriorLighting(ambient);
  const sunrise = new THREE.Vector3(3, -2, 0).normalize();
  const noon = new THREE.Vector3(-2, -3, 5).normalize();
  const sunDirection = new THREE.Vector3();
  const zenith = new THREE.Color();
  const sky = createSky(sunDirection, scene.fog.color, zenith);
  scene.add(sun.target, sun, ambient, sky);

  const nightHorizon = new THREE.Color(0x1d2a40), twilightHorizon = new THREE.Color(0xe2ac89), dayHorizon = new THREE.Color(0xf6faff);
  const nightZenith = new THREE.Color(0x0c162a), twilightZenith = new THREE.Color(0x526886), dayZenith = new THREE.Color(0xc1ddf5);
  const lowSun = new THREE.Color(0xffa465), highSun = sun.color.clone();
  const nightSkyLight = new THREE.Color(0xb1c7ee), daySkyLight = ambient.color.clone();
  const nightGroundLight = new THREE.Color(0x919eb8), dayGroundLight = ambient.groundColor.clone();
  let time = 0;

  return function updateDayNight(elapsed, cameraPosition, playerPosition) {
    time = (time + elapsed) % cycleSeconds;
    const isDay = time < daySeconds;
    const angle = isDay ? Math.PI * time / daySeconds : Math.PI + Math.PI * (time - daySeconds) / nightSeconds;
    const height = Math.sin(angle);
    sunDirection.copy(sunrise).multiplyScalar(Math.cos(angle)).addScaledVector(noon, height);
    sun.position.copy(sun.target.position).addScaledVector(sunDirection, 48);
    const sunlight = THREE.MathUtils.smoothstep(height, 0, 0.64);
    sun.intensity = isDay ? 2.55 * sunlight : 0;
    sun.color.lerpColors(lowSun, highSun, sunlight);
    sun.shadow.autoUpdate = sun.intensity > 0;

    const twilight = THREE.MathUtils.smoothstep(height, -0.39, 0.04);
    const daylight = THREE.MathUtils.smoothstep(height, 0.0, 0.58);
    scene.fog.color.lerpColors(nightHorizon, twilightHorizon, twilight).lerp(dayHorizon, daylight);
    scene.background.copy(scene.fog.color);
    zenith.lerpColors(nightZenith, twilightZenith, twilight).lerp(dayZenith, daylight);
    sky.material.uniforms.sunColor.value.copy(sun.color);
    sky.position.copy(cameraPosition);

    const skyBrightness = THREE.MathUtils.smoothstep(height, -0.35, 0.65);
    ambient.color.lerpColors(nightSkyLight, daySkyLight, skyBrightness);
    ambient.groundColor.lerpColors(nightGroundLight, dayGroundLight, skyBrightness);
    updateInteriorLight(playerPosition, elapsed, THREE.MathUtils.lerp(0.50, 2.05, skyBrightness));
    return skyBrightness;
  };
}
