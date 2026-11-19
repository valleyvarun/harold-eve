import { Box3, Vector3 } from './vendor/three.module.min.js';

// Keep low vertices distributed across each sole, including both sides of
// the heel and toe. Vertex indices continue to follow the animated mesh.
export function makeSoleSupport(model, feet) {
  model.updateMatrixWorld(true);
  const point = new Vector3();
  const samples = feet.map(({ mesh, indices }) => {
    const bounds = new Box3();
    for (const index of indices) {
      mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld);
      bounds.expandByPoint(point);
    }
    const size = bounds.getSize(new Vector3());
    const bins = new Map();
    for (const index of indices) {
      mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld);
      const x = Math.min(2, Math.floor(3 * (point.x - bounds.min.x) / (size.x || 1)));
      const y = Math.min(4, Math.floor(5 * (point.y - bounds.min.y) / (size.y || 1)));
      const cell = 3 * y + x;
      if (!bins.has(cell) || point.z < bins.get(cell).z) bins.set(cell, { index, z: point.z });
    }
    return { mesh, indices: Array.from(bins.values(), cell => cell.index) };
  });
  return function supportHeight(heightAt) {
    model.updateMatrixWorld(true);
    const rootZ = model.matrixWorld.elements[14];
    let height = 0;
    for (const { mesh, indices } of samples) {
      for (const index of indices) {
        mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld);
        height = Math.max(height, heightAt(point.x, point.y) - (point.z - rootZ));
      }
    }
    return height;
  };
}
