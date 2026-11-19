// Centers of the exterior walls in treehouse-structure.gltf, in scene meters.
// The decks, both stair flights and the space under the house are outdoors.
const perimeter = [
  [-7.45, -2.05], [-2.15, -2.05], [-0.85, -0.70], [-1.80, 1.15],
  [-1.80, 4.90], [-2.50, 5.90], [-2.50, 8.50], [-1.90, 9.45],
  [-5.95, 9.40], [-9.05, 4.30], [-9.05, -0.16]
];

export function configureHouseLights(house) {
  // Match the export's candela values to the daylight levels used in this scene.
  house.traverse(light => {
    if (!light.isPointLight) return;
    light.intensity *= 0.045;
    light.distance = Math.min(light.distance || Infinity, 5);
  });
}

function insideHouse(position) {
  // Eve's root follows her feet. The interior floor is at 12.91 m and
  // the lowest roof edge is above 15.2 m.
  if (!position || position.z < 12.78 || position.z > 15.19) return false;
  const { x, y } = position;
  let inside = false;
  let previous = perimeter.at(-1);
  for (const current of perimeter) {
    const [ax, ay] = previous, [bx, by] = current;
    if ((ay > y) !== (by > y) && x < ax + (y - ay) * (bx - ax) / (by - ay)) {
      inside = !inside;
    }
    previous = current;
  }
  return inside;
}

export function createInteriorLighting(ambientLight) {
  const fullDaylight = ambientLight.intensity;
  let indoorFactor = 1;
  return function updateInteriorLight(position, elapsed, outdoorIntensity = fullDaylight) {
    const target = insideHouse(position) ? 0.22 : 1;
    indoorFactor += (target - indoorFactor) * (1 - Math.exp(-5 * elapsed));
    ambientLight.intensity = outdoorIntensity * indoorFactor;
  };
}
