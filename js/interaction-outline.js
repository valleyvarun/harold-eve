import * as THREE from './vendor/three.module.min.js';

const radiusPixels = 2.5;
const directions = 8;

export function createInteractionOutline(renderer) {
  const overlay = new THREE.Scene();
  // The proxies read the world matrices updated by the normal scene render.
  overlay.matrixWorldAutoUpdate = false;
  const mask = new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide,
    colorWrite: false, depthWrite: false, depthTest: false,
    stencilWrite: true, stencilRef: 1, stencilZPass: THREE.ReplaceStencilOp
  });
  const offset = new THREE.Vector2();
  const border = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, depthWrite: false,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc,
    uniforms: { offset: { value: offset } },
    vertexShader: `
      uniform vec2 offset;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.xy += instanceMatrix[3].xy * offset * gl_Position.w;
      }`,
    fragmentShader: `
      void main() {
        gl_FragColor = vec4(1.0, 0.84, 0.0, 1.0);
        #include <colorspace_fragment>
      }`
  });
  const translation = new THREE.Matrix4();
  const size = new THREE.Vector2();
  const proxies = new WeakMap();
  let selected = null;

  function createProxies(root) {
    const group = new THREE.Group();
    root.traverseVisible(part => {
      if (!part.isMesh) return;
      const silhouette = new THREE.Mesh(part.geometry, mask);
      const rim = new THREE.InstancedMesh(part.geometry, border, directions);
      for (let i = 0; i < directions; ++i) {
        const angle = i * Math.PI * 2 / directions;
        rim.setMatrixAt(i, translation.makeTranslation(Math.cos(angle), Math.sin(angle), 0));
      }
      // Mask the whole piece of furniture before drawing any of its offset copies.
      rim.renderOrder = 1;
      silhouette.frustumCulled = rim.frustumCulled = false;
      silhouette.matrixWorld = rim.matrixWorld = part.matrixWorld;
      group.add(silhouette, rim);
    });
    return group;
  }

  function setTarget(target) {
    if (target === selected) return;
    overlay.clear();
    selected = target;
    if (!target) return;
    if (!proxies.has(target)) proxies.set(target, createProxies(target));
    overlay.add(proxies.get(target));
  }

  function render(camera) {
    if (!selected) return;
    renderer.getSize(size);
    offset.set(2 * radiusPixels / size.x, 2 * radiusPixels / size.y);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(overlay, camera);
    renderer.autoClear = autoClear;
  }

  return { setTarget, render };
}
