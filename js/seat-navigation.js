const spacing = 0.22;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// Seat approaches are standing positions in an aisle on the same floor.
// Use the same body clearance as manual walking when checking an approach.
export function pathToSeat(start, seat, house, height, radius, firstStepClear) {
  const goals = seat.approaches.filter(p => Math.abs(p.z - start.z) < 0.3);
  if (!goals.length) return null;
  goals.sort((a, b) => distance(a, start) - distance(b, start));
  function clear(a, b) {
    if (firstStepClear && a.x === start.x && a.y === start.y && !firstStepClear(b.x, b.y, start.z)) return false;
    // Leave a centimeter at corners so smaller walking steps also clear the furniture.
    if (!house.canMove(a.x, a.y, b.x, b.y, start.z, height, radius + 0.01)) return false;
    const count = Math.max(1, Math.ceil(distance(a, b) / 0.16));
    for (let i = 1; i <= count; i++) {
      const x = a.x + (b.x - a.x) * i / count;
      const y = a.y + (b.y - a.y) * i / count;
      if (Math.abs(house.support(x, y, start.z) - start.z) > 0.17) return false;
    }
    return true;
  }
  for (const goal of goals) {
    if (clear(start, goal)) return [goal];
  }

  const first = { x: start.x, y: start.y, i: 0, j: 0, cost: 0, score: 0 };
  const open = [first], costs = new Map([['0,0', 0]]);
  const limit = distance(start, goals[0]) + 3.5;
  while (open.length) {
    open.sort((a, b) => b.score - a.score);
    const here = open.pop();
    if (here.cost > costs.get(here.i + ',' + here.j)) continue;
    for (const goal of goals) {
      if (distance(here, goal) > 0.65 || !clear(here, goal)) continue;
      const path = [goal];
      for (let node = here; node.parent; node = node.parent) path.unshift(node);
      // Walk straight stretches in one motion instead of turning at grid corners.
      for (let i = 0; i < path.length - 1;) {
        if (clear(i ? path[i - 1] : start, path[i + 1])) path.splice(i, 1);
        else i++;
      }
      return path;
    }
    for (const [di, dj] of directions) {
      const i = here.i + di, j = here.j + dj, key = i + ',' + j;
      const cost = here.cost + spacing * Math.hypot(di, dj);
      if (cost >= (costs.get(key) ?? Infinity) - 0.00001) continue;
      const next = { x: start.x + i * spacing, y: start.y + j * spacing, i, j, cost, parent: here };
      next.score = cost + Math.min(...goals.map(goal => distance(next, goal)));
      if (next.score > limit || !clear(here, next)) continue;
      costs.set(key, cost);
      open.push(next);
    }
  }
  return null;
}
