import { Box3, Matrix4, Ray, Vector3 } from './vendor/three.module.min.js';

const cellSize = 0.6;
const epsilon = 0.001;
const seamRadius = 0.035;
const footprint = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];

function heightOnFace(face, x, y) {
  const { a, b, c, determinant } = face;
  const dx = x - a.x, dy = y - a.y;
  const u = (dx * (c.y - a.y) - dy * (c.x - a.x)) / determinant;
  const v = ((b.x - a.x) * dy - (b.y - a.y) * dx) / determinant;
  if (u < -1e-6 || v < -1e-6 || u + v > 1.000001) return undefined;
  return a.z + u * (b.z - a.z) + v * (c.z - a.z);
}

// Clip the face to the body's height first. Testing its full XY projection
// would turn a sloping stair stringer into a wall even above the stringer.
function clipAtHeight(input, count, output, z, keepAbove) {
  let written = 0;
  let a = input[count - 1];
  let aInside = keepAbove ? a.z >= z : a.z <= z;
  for (let i = 0; i < count; i++) {
    const b = input[i];
    const bInside = keepAbove ? b.z >= z : b.z <= z;
    if (aInside !== bInside) {
      output[written++].lerpVectors(a, b, (z - a.z) / (b.z - a.z));
    }
    if (bInside) output[written++].copy(b);
    a = b;
    aInside = bInside;
  }
  return written;
}

function touchesDisk(polygon, count, x, y, radius) {
  let inside = false;
  let a = polygon[count - 1];
  for (let i = 0; i < count; i++) {
    const b = polygon[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSq)) : 0;
    const rx = x - (a.x + t * dx), ry = y - (a.y + t * dy);
    if (rx * rx + ry * ry < radius * radius) return true;
    if ((a.y > y) !== (b.y > y) && x < a.x + (y - a.y) * dx / dy) inside = !inside;
    a = b;
  }
  return inside;
}

function indexSurfaces(root, excludedMeshes) {
  root.updateWorldMatrix(true, true);
  const bounds = new Box3().setFromObject(root);
  const column = x => Math.floor((x - bounds.min.x) / cellSize);
  const row = y => Math.floor((y - bounds.min.y) / cellSize);
  const width = column(bounds.max.x) + 1, depth = row(bounds.max.y) + 1;
  const cells = Array.from({ length: width * depth }, () => ({ faces: [], floors: [], ceilings: [] }));
  const ab = new Vector3(), ac = new Vector3(), normal = new Vector3();

  root.traverse(mesh => {
    if (!mesh.isMesh || excludedMeshes?.has(mesh)) return;
    const positions = mesh.geometry.getAttribute('position');
    const vertices = Array.from({ length: positions.count }, (_, i) =>
      new Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld));
    const indices = mesh.geometry.index;
    const vertex = i => vertices[indices ? indices.getX(i) : i];
    const count = indices ? indices.count : positions.count;
    for (let i = 0; i < count; i += 3) {
      const a = vertex(i), b = vertex(i + 1), c = vertex(i + 2);
      normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
      const magnitude = normal.length();
      if (magnitude < 1e-10) continue;
      const face = {
        a, b, c, vertices: [a, b, c], determinant: normal.z, seen: 0,
        minX: Math.min(a.x, b.x, c.x), maxX: Math.max(a.x, b.x, c.x),
        minY: Math.min(a.y, b.y, c.y), maxY: Math.max(a.y, b.y, c.y),
        minZ: Math.min(a.z, b.z, c.z), maxZ: Math.max(a.z, b.z, c.z),
      };
      const x0 = column(face.minX), x1 = column(face.maxX);
      const y0 = row(face.minY), y1 = row(face.maxY);
      for (let v = y0; v <= y1; v++) {
        for (let u = x0; u <= x1; u++) {
          const cell = cells[v * width + u];
          cell.faces.push(face);
          if (normal.z > magnitude * 0.65) cell.floors.push(face);
          if (normal.z < -magnitude * 0.03) cell.ceilings.push(face);
        }
      }
    }
  });

  function cellAt(x, y) {
    const u = column(x), v = row(y);
    if (u >= 0 && u < width && v >= 0 && v < depth) return cells[v * width + u];
  }

  function support(x, y, feetZ, stepUp, best, offsets = footprint) {
    const limit = feetZ + stepUp + epsilon;
    for (const [dx, dy] of offsets) {
      const px = x + dx * seamRadius, py = y + dy * seamRadius;
      const cell = cellAt(px, py);
      if (!cell) continue;
      for (const face of cell.floors) {
        if (face.minZ > limit || face.maxZ <= best) continue;
        const z = heightOnFace(face, px, py);
        if (z > best && z <= limit) best = z;
      }
    }
    return best;
  }

  function ceiling(x, y, headZ, radius, offsets = footprint) {
    let best = Infinity;
    for (const [dx, dy] of offsets) {
      const px = x + dx * radius, py = y + dy * radius;
      const cell = cellAt(px, py);
      if (!cell) continue;
      for (const face of cell.ceilings) {
        if (face.maxZ < headZ - epsilon || face.minZ >= best) continue;
        const z = heightOnFace(face, px, py);
        if (z >= headZ - epsilon && z < best) best = z;
      }
    }
    return best;
  }

  let queryId = 0;
  const lower = Array.from({ length: 5 }, () => new Vector3());
  const upper = Array.from({ length: 6 }, () => new Vector3());
  function bodyBlocked(x, y, bottom, top, radius) {
    if (bottom > bounds.max.z || top < bounds.min.z) return false;
    const x0 = Math.max(0, column(x - radius)), x1 = Math.min(width - 1, column(x + radius));
    const y0 = Math.max(0, row(y - radius)), y1 = Math.min(depth - 1, row(y + radius));
    queryId++;
    for (let v = y0; v <= y1; v++) {
      for (let u = x0; u <= x1; u++) {
        for (const face of cells[v * width + u].faces) {
          if (face.seen === queryId) continue;
          face.seen = queryId;
          if (face.maxZ < bottom || face.minZ > top ||
              face.maxX < x - radius || face.minX > x + radius ||
              face.maxY < y - radius || face.minY > y + radius) continue;
          let polygon = face.vertices, count = 3;
          if (face.minZ < bottom) {
            count = clipAtHeight(polygon, count, lower, bottom, true);
            polygon = lower;
          }
          if (count && face.maxZ > top) {
            count = clipAtHeight(polygon, count, upper, top, false);
            polygon = upper;
          }
          if (count && touchesDisk(polygon, count, x, y, radius)) return true;
        }
      }
    }
    return false;
  }

  const ray = new Ray(), hit = new Vector3();
  function cameraDistance(focus, eye) {
    ray.origin.copy(focus);
    ray.direction.subVectors(eye, focus);
    const length = ray.direction.length();
    if (length < epsilon) return Infinity;
    ray.direction.divideScalar(length);
    const x0 = Math.max(0, column(Math.min(focus.x, eye.x)));
    const x1 = Math.min(width - 1, column(Math.max(focus.x, eye.x)));
    const y0 = Math.max(0, row(Math.min(focus.y, eye.y)));
    const y1 = Math.min(depth - 1, row(Math.max(focus.y, eye.y)));
    const minZ = Math.min(focus.z, eye.z), maxZ = Math.max(focus.z, eye.z);
    let nearest = Infinity;
    queryId++;
    for (let v = y0; v <= y1; v++) {
      for (let u = x0; u <= x1; u++) {
        for (const face of cells[v * width + u].faces) {
          if (face.seen === queryId) continue;
          face.seen = queryId;
          if (face.maxZ < minZ || face.minZ > maxZ) continue;
          if (!ray.intersectTriangle(face.a, face.b, face.c, false, hit)) continue;
          const t = focus.distanceTo(hit);
          if (t < nearest && t <= length) nearest = t;
        }
      }
    }
    return nearest;
  }

  return { bounds, support, ceiling, bodyBlocked, cameraDistance };
}

// The hinges turn about world Z and the slider travels horizontally. Transform a
// query into the original world-space pose so the door's triangle grid stays valid.
function indexDoor(leaf) {
  const surfaces = indexSurfaces(leaf);
  const rest = leaf.matrixWorld.clone();
  const previous = rest.clone();
  const toRest = new Matrix4(), toWorld = new Matrix4();
  const bounds = surfaces.bounds.clone();
  const offsets = footprint.map(pair => pair.slice());
  function sync() {
    if (previous.equals(leaf.matrixWorld)) return;
    previous.copy(leaf.matrixWorld);
    toRest.copy(leaf.matrixWorld).invert().premultiply(rest);
    toWorld.copy(toRest).invert();
    bounds.copy(surfaces.bounds).applyMatrix4(toWorld);
    // Floor and head probes remain aligned to the character's world-space footprint.
    const m = toRest.elements;
    for (let i = 0; i < footprint.length; i++) {
      const [dx, dy] = footprint[i];
      offsets[i][0] = m[0] * dx + m[4] * dy;
      offsets[i][1] = m[1] * dx + m[5] * dy;
    }
  }
  return { surfaces, toRest, bounds, offsets, sync };
}

export function createHousePhysics(houseRoot, terrainHeightAt, leaves = []) {
  const movingMeshes = new Set();
  const doors = new Map();
  for (const leaf of leaves) {
    leaf.traverse(part => { if (part.isMesh) movingMeshes.add(part); });
    doors.set(leaf, indexDoor(leaf));
  }
  const house = indexSurfaces(houseRoot, movingMeshes);
  const point = new Vector3(), end = new Vector3(), segment = new Box3();

  function nearDoor(door, x, y, radius) {
    door.sync();
    const { min, max } = door.bounds;
    return x + radius >= min.x && x - radius <= max.x && y + radius >= min.y && y - radius <= max.y;
  }

  function support(x, y, feetZ, stepUp = 0.32) {
    let best = house.support(x, y, feetZ, stepUp, terrainHeightAt(x, y));
    for (const door of doors.values()) {
      if (!nearDoor(door, x, y, seamRadius)) continue;
      point.set(x, y, feetZ).applyMatrix4(door.toRest);
      best = door.surfaces.support(point.x, point.y, feetZ, stepUp, best, door.offsets);
    }
    return best;
  }

  function ceiling(x, y, headZ, radius = 0.20) {
    let nearest = house.ceiling(x, y, headZ, radius);
    for (const door of doors.values()) {
      if (!nearDoor(door, x, y, radius)) continue;
      point.set(x, y, headZ).applyMatrix4(door.toRest);
      nearest = Math.min(nearest, door.surfaces.ceiling(point.x, point.y, headZ, radius, door.offsets));
    }
    return nearest;
  }

  function doorBlocks(door, x, y, bottom, top, radius) {
    if (!nearDoor(door, x, y, radius)) return false;
    point.set(x, y, bottom).applyMatrix4(door.toRest);
    return door.surfaces.bodyBlocked(point.x, point.y, bottom, top, radius);
  }

  function doorIntersectsBody(leaf, feet, radius = 0.22, height = 1.75) {
    return doorBlocks(doors.get(leaf), feet.x, feet.y, feet.z + epsilon, feet.z + height - epsilon, radius);
  }

  function canMove(fromX, fromY, toX, toY, feetZ, height = 1.74, radius = 0.22, stepUp = 0.32) {
    const dx = toX - fromX, dy = toY - fromY;
    const samples = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.08));
    let z = feetZ;
    for (let i = 1; i <= samples; i++) {
      const x = fromX + dx * i / samples, y = fromY + dy * i / samples;
      const floor = support(x, y, z, stepUp);
      if (floor > z + stepUp + epsilon) return false;
      if (floor >= z - stepUp - epsilon) z = floor;
      const bottom = z + stepUp + epsilon, top = z + height - epsilon;
      if (house.bodyBlocked(x, y, bottom, top, radius)) return false;
      for (const door of doors.values()) {
        if (doorBlocks(door, x, y, bottom, top, radius)) return false;
      }
    }
    return true;
  }

  function cameraDistance(from, to) {
    let nearest = house.cameraDistance(from, to);
    segment.set(from, from).expandByPoint(to);
    for (const door of doors.values()) {
      door.sync();
      if (!segment.intersectsBox(door.bounds)) continue;
      point.copy(from).applyMatrix4(door.toRest);
      end.copy(to).applyMatrix4(door.toRest);
      nearest = Math.min(nearest, door.surfaces.cameraDistance(point, end));
    }
    return nearest;
  }
  return { support, ceiling, canMove, cameraDistance, doorIntersectsBody };
}
