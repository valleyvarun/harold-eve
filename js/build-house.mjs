// Run with Node after replacing the modular Rhino exports in assets/.
// Batch static surfaces by assembly and material so the house can render in real time.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';

const folder = new URL('../assets/', import.meta.url);
const lights = [];
const result = {
  asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }],
  nodes: [], meshes: [], materials: [], buffers: [], bufferViews: [], accessors: [],
  extensionsUsed: ['KHR_lights_punctual'], extensions: { KHR_lights_punctual: { lights } }
};
const materialIds = new Map();
const batches = new Map();
const chunks = [];
let byteLength = 0;

function materialIndex(material) {
  const { name, ...properties } = material;
  // Owner-specific emission and all PBR values are part of the material identity.
  const key = JSON.stringify(properties);
  if (!materialIds.has(key)) materialIds.set(key, result.materials.push(material) - 1);
  return materialIds.get(key);
}

function packAsset(file) {
  const doc = JSON.parse(readFileSync(new URL(file, folder), 'utf8'));
  assert(!doc.textures?.length && !doc.animations?.length && !doc.skins?.length, file);
  const buffers = doc.buffers.map(buffer => {
    const [header, data] = buffer.uri.split(',');
    assert(header.startsWith('data:') && header.endsWith(';base64'), file);
    return Buffer.from(data, 'base64');
  });
  function read(index) {
    const accessor = doc.accessors[index];
    const view = doc.bufferViews[accessor.bufferView];
    const bytes = buffers[view.buffer];
    const Type = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array }[accessor.componentType];
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3 }[accessor.type];
    assert(Type && width && !view.byteStride && !accessor.sparse);
    return new Type(bytes.buffer, bytes.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0),
      accessor.count * width);
  }
  const retained = new Map();
  function visit(index, parent) {
    const source = doc.nodes[index];
    const { children, mesh, extensions, ...node } = source;
    const role = node.extras?.interactionRole ?? '';
    const isRoot = parent === undefined;
    const light = extensions?.KHR_lights_punctual;
    if (isRoot || light || role.startsWith('door') || role.startsWith('switch') ||
        node.matrix || node.rotation || node.scale || node.translation) {
      if (isRoot) node.name = file.slice(0, -5);
      const id = result.nodes.push(node) - 1;
      const siblings = isRoot ? result.scenes[0].nodes : (result.nodes[parent].children ??= []);
      siblings.push(id);
      retained.set(index, id);
      parent = id;
      if (light) {
        const lightId = lights.push(doc.extensions.KHR_lights_punctual.lights[light.light]) - 1;
        node.extensions = { KHR_lights_punctual: { light: lightId } };
      }
    }
    for (const primitive of doc.meshes?.[mesh]?.primitives ?? []) {
      assert((primitive.mode ?? 4) === 4 && !primitive.targets);
      const material = doc.materials[primitive.material];
      const mat = materialIndex(material);
      const hasUV = primitive.attributes.TEXCOORD_0 !== undefined;
      // Separate transparent objects so Three can still sort them by depth.
      const key = [parent, mat, hasUV, material.alphaMode === 'BLEND' ? index : ''].join('/');
      if (!batches.has(key)) batches.set(key, { parent, mat, positions: [], normals: [], uvs: [], indices: [] });
      const group = batches.get(key);
      const vertexOffset = group.positions.length / 3;
      for (const i of read(primitive.indices)) group.indices.push(vertexOffset + i);
      for (const value of read(primitive.attributes.POSITION)) group.positions.push(value);
      for (const value of read(primitive.attributes.NORMAL)) group.normals.push(value);
      if (hasUV) for (const value of read(primitive.attributes.TEXCOORD_0)) group.uvs.push(value);
    }
    for (const child of children ?? []) visit(child, parent);
  }
  const roots = doc.scenes[doc.scene ?? 0].nodes;
  assert.equal(roots.length, 1, file);
  visit(roots[0]);
  const root = result.nodes[retained.get(roots[0])];
  // Node indices in the source door bindings are local to the individual file.
  if (doc.extras?.doorBinding) {
    const binding = { ...doc.extras.doorBinding };
    for (const [key, value] of Object.entries(binding)) {
      if (key.endsWith('NodeIndex')) binding[key] = retained.get(value);
      if (key.endsWith('NodeIndices')) binding[key] = value.map(id => retained.get(id));
    }
    root.extras.doorBinding = binding;
    for (const key of ['doorHingeNodeIndex', 'doorSlidingNodeIndex']) {
      if (key in root.extras) root.extras[key] = retained.get(root.extras[key]);
    }
  }
}

function writeAccessor(values, Type, componentType, type, width, target) {
  const bytes = Buffer.from(Type.from(values).buffer);
  const view = result.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, target }) - 1;
  chunks.push(bytes);
  const padding = (4 - bytes.length % 4) % 4;
  if (padding) chunks.push(Buffer.alloc(padding));
  byteLength += bytes.length + padding;
  const accessor = { bufferView: view, componentType, type, count: values.length / width };
  if (type === 'VEC3') {
    accessor.min = Array(width).fill(Infinity);
    accessor.max = Array(width).fill(-Infinity);
    for (let i = 0; i < values.length; i++) {
      const axis = i % width;
      accessor.min[axis] = Math.min(accessor.min[axis], values[i]);
      accessor.max[axis] = Math.max(accessor.max[axis], values[i]);
    }
  }
  return result.accessors.push(accessor) - 1;
}

// Build from individual assemblies. Leave the bedroom plant and its round table out of the scene.
const excluded = new Set(['treehouse-complete.gltf', 'bedroom-planter.gltf', 'bedroom-reading-side-table.gltf']);
const files = readdirSync(folder).filter(name => name.endsWith('.gltf') && !excluded.has(name));
assert(files.includes('treehouse-structure.gltf'));
for (const file of files.sort()) packAsset(file);
for (const { parent, mat, positions, normals, uvs, indices } of batches.values()) {
  const attributes = {
    POSITION: writeAccessor(positions, Float32Array, 5126, 'VEC3', 3, 34962),
    NORMAL: writeAccessor(normals, Float32Array, 5126, 'VEC3', 3, 34962)
  };
  if (uvs.length) attributes.TEXCOORD_0 = writeAccessor(uvs, Float32Array, 5126, 'VEC2', 2, 34962);
  const short = positions.length / 3 <= 65535;
  const index = writeAccessor(indices, short ? Uint16Array : Uint32Array, short ? 5123 : 5125, 'SCALAR', 1, 34963);
  const mesh = result.meshes.push({ primitives: [{ attributes, material: mat, indices: index }] }) - 1;
  const node = result.nodes.push({ name: result.materials[mat].name, mesh }) - 1;
  (result.nodes[parent].children ??= []).push(node);
}
result.buffers.push({ byteLength });
const json = Buffer.from(JSON.stringify(result));
const jsonSize = Math.ceil(json.length / 4) * 4;
const header = Buffer.alloc(20);
header.write('glTF');
header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + jsonSize + byteLength, 8);
header.writeUInt32LE(jsonSize, 12);
header.write('JSON', 16);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(byteLength);
binHeader.write('BIN', 4);
const temporary = new URL('treehouse-complete.glb.building', folder);
writeFileSync(temporary, Buffer.concat([header, json, Buffer.alloc(jsonSize - json.length, 32), binHeader, ...chunks]));
renameSync(temporary, new URL('treehouse-complete.glb', folder));
console.log(`Packed ${files.length} assemblies, ${result.meshes.length} mesh batches, and ${lights.length} light sources.`);
