// The glTF assigns each point light, bulb and indicator to a circuit.
// Capture their imported on-state after the scene has adjusted the light levels.
export function createLightCircuits(house) {
  const circuits = new Map();
  function bind(id, setPower) {
    if (!circuits.has(id)) circuits.set(id, { on: true, bindings: [] });
    circuits.get(id).bindings.push(setPower);
  }

  const materials = new Set();
  house.traverse(part => {
    if (part.isPointLight && part.userData.circuitId) {
      const intensity = part.intensity;
      bind(part.userData.circuitId, on => { part.intensity = on ? intensity : 0; });
    }
    if (!part.isMesh) return;
    for (const material of Array.isArray(part.material) ? part.material : [part.material]) {
      const { circuitId, gameLightingOwnerId, switchId } = material.userData;
      if (!circuitId || !gameLightingOwnerId || materials.has(material)) continue;
      materials.add(material);
      const brightness = material.emissiveIntensity;
      const indicatorColor = switchId ? material.color.clone() : null;
      bind(circuitId, on => {
        material.emissiveIntensity = on ? brightness : 0;
        if (indicatorColor) {
          if (on) material.color.copy(indicatorColor);
          else material.color.setHex(0x38332c);
        }
      });
    }
  });

  function toggle(id) {
    const circuit = circuits.get(id);
    if (!circuit) return false;
    circuit.on = !circuit.on;
    for (const setPower of circuit.bindings) setPower(circuit.on);
    return circuit.on;
  }
  return { bind, toggle, isOn: id => circuits.get(id)?.on ?? false };
}
