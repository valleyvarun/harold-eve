// Adjacent clearings connect across walkable terrain outside the house, stairs and trees.
// The first clearing leads directly away from the house from Harold's landing spot.
const clearings = [
  [-1, -6], [4, -7], [10, -5], [13, 0], [13, 6], [10, 11], [5, 15],
  [-1.5, 13], [-11, 11.5], [-14, 8], [-15, 1], [-12, -6], [-7, -9]
];

export function createOutdoorPatrol() {
  let index = -1;
  let direction = Math.random() < 0.5 ? -1 : 1;

  function next(blocked = false) {
    if (index === -1) {
      index = 0;
    } else {
      // Even a turn back stays on the current stretch of meadow.
      if (blocked || Math.random() < 0.10) direction *= -1;
      index = (index + direction + clearings.length) % clearings.length;
    }
    const [x, y] = clearings[index];
    return { x: x + (Math.random() - 0.5) * 1.1, y: y + (Math.random() - 0.5) * 1.1 };
  }

  return { next };
}
