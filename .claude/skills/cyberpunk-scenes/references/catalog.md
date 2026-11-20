# Scene catalog: design notes

All scenes share one world: the same megacity at night, seen from different places. Reuse kit pieces so they feel related. Palettes must match the `--scene-*` gradients in `tokens.css` and `ATMOSPHERES` in `kit/atmosphere.ts`.

## home (`/`), built
- Ground-level avenue looking down −z, stepped megatower at z ≈ −380. Rain, blade signs with wet-street reflections, flying and ground traffic, three searchlights.
- Camera: slow drift around (0, 7.5, 24) looking at (0, 24, −160), with pointer parallax.
- Kit: `avenue`, `skyline`, `steppedTower`, `streetSurface`, `streetLamps`, `hangSigns`, `createTraffic`, `createRain`, `createSearchlights`, `createBeacons`.

## metro (`/stack`, ambient on `/stack/[slug]`)
- Elevated viewpoint across the city. Glowing rail lines (cyan, amber, pink) on pylons link station towers, and trains (glow strings) run along them. It reads as a map of connected technologies.
- Palette: deep indigo sky, cyan and amber lines, sparse pink.
- Kit: `skyline`, `createBeacons`. New kit pieces: rail line (curve plus emissive tube or line strip, batched) and train (moving glow cluster along a curve).
- Ambient freeze: trains mid-line, all lines lit.

## archive (`/knowledge`, ambient on notes)
- Underground: one long corridor of server racks receding into cold fog, with LED status lights (mostly teal, rare amber) blinking and a floor grille catching reflections.
- Palette: blue-black, teal-cyan, small amber warnings. Dense fog (FogExp2 ≈ 0.02).
- Kit: `StaticBatch` for racks (reuse `buildingGeometry` with an LED-grid palette), `GlowField` for LEDs, `StreakField` for floor reflections.
- Ambient freeze: LEDs in a pleasant random state.

## construction (`/projects`, ambient on project pages)
- Construction district at night. Half-built megatower (`steppedTower` with `built ≈ 0.6`) wrapped in scaffold lines, tower cranes with red beacons and slowly swinging jibs, welding spark bursts (short-lived glows), sodium work lights.
- Palette: warm haze, sodium amber, blue-white sparks.
- Kit: `steppedTower(built)`, `skyline`, `createBeacons`, `GlowField`. New: crane (batched boxes plus a rotating jib group) and spark emitter.

## rooftop (`/ideas`)
- Camera on a rooftop looking up. Antenna and mast forest in the foreground, drones (small blinking glows) drifting, searchlights sweeping low violet cloud.
- Palette: violet cloud, pink underglow from the street below, cyan beams.
- Kit: `createSearchlights` (tilted up), `createBeacons`, `GlowField`. New: cloud layer (large additive planes or a scrolling canvas texture) and antenna generator.

## desert (`/about`)
- Desert highway at dusk outside the city. Solar field rows catching the sky, a lone hauler truck (glow cluster) driving the highway, the megacity glowing on the horizon.
- Palette: amber → pink → violet sky, with cyan and pink city glow on the horizon.
- Kit: `skyline` (far away, low height), `createTraffic` (one ground vehicle), `StreakField` for highway reflections. New: solar panel rows (batched tilted planes).

## 404
- A static CSS-only skyline silhouette and neon "404" sign in the home palette. No three.js.
