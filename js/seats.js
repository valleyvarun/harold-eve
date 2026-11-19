import { Path, Vector3 } from './vendor/three.module.min.js';

const floorHeight = 12.913;
const reach = 2.25;

// Cushion tops and clear standing places from the furnished house, in world meters.
// The dining table sits in front of the chairs, so Eve enters those from the side.
function seat(x, y, z, facing, approaches) {
  return {
    position: new Vector3(x, y, z),
    facing,
    approaches: approaches.map(([ax, ay, turns]) => {
      const stand = new Vector3(ax, ay, floorHeight);
      if (turns) {
        stand.passage = new Path();
        stand.passage.moveTo(ax, ay);
        for (const [x, y] of turns) stand.passage.lineTo(x, y);
      }
      return stand;
    })
  };
}

const right = -Math.PI / 2;
const left = Math.PI / 2;
// Eve mounts from a clear aisle, then rests lengthwise between the accent cushions.
const bed = seat(-5.0, 8.03, 13.603, Math.PI, [[-3.80, 7.82], [-6.20, 7.82]]);
bed.edgeOffset = 0.75;
const seats = new Map([
  ['bedroom-queen-bed', bed],
  // Reach the southwest chair by sidestepping behind its neighbor and around its back.
  ['dining-chair-01', seat(-5.30, 1.173, 13.438, right, [
    [-5.80, 2.46, [[-5.81, 1.62], [-5.74, 1.16], [-5.72, 0.77], [-5.61, 0.67], [-5.43, 0.67]]]
  ])],
  ['dining-chair-02', seat(-4.115, 1.255, 13.438, left, [[-3.87, 0.72]])],
  ['dining-chair-03', seat(-5.39, 1.864, 13.438, right, [[-5.48, 2.41]])],
  ['dining-chair-04', seat(-4.07, 1.774, 13.438, left, [[-3.88, 2.32]])],
  ['living-lounge-chair', seat(-7.252, 6.219, 13.343, -2.04, [[-6.67, 5.90], [-6.63, 5.84]])],
  ['terrace-bench', seat(0.85, 8.705, 13.343, Math.PI, [[0.60, 8.21], [0.43, 8.20]])]
]);
const sofaRight = seat(-5.85, 3.83, 13.433, 0, [[-5.60, 4.25]]);
const sofaLeft = seat(-7.17, 3.90, 13.433, 0, [[-7.37, 4.25]]);

export function createSeats(houseLayer) {
  const furniture = new Map();
  houseLayer.traverse(group => {
    if (!seats.has(group.name) && group.name !== 'living-sofa') return;
    group.traverse(mesh => { if (mesh.isMesh) furniture.set(mesh, group); });
  });

  function pick(hit, feet) {
    const object = furniture.get(hit.object);
    if (!object || Math.abs(feet.z - floorHeight) > 0.65) return null;
    const nearby = seat => Math.hypot(feet.x - seat.position.x, feet.y - seat.position.y) <= reach;
    if (object.name === 'living-sofa') {
      // The coffee table splits the aisle. Try the clicked end first, then its accessible neighbor.
      const options = [sofaLeft, sofaRight].filter(nearby);
      options.sort((a, b) => a.position.distanceToSquared(hit.point) - b.position.distanceToSquared(hit.point));
      return options.length ? { object, seat: { ...options[0], alternatives: options.slice(1) } } : null;
    }
    const target = seats.get(object.name);
    return nearby(target) ? { object, seat: target } : null;
  }

  return { parts: [...furniture.keys()], pick };
}
