# Scene catalog: design notes

All scenes share one world: the same megacity at night, seen from different places. Reuse kit pieces so they feel related. Palettes must match the `--scene-*` gradients in `tokens.css` and `ATMOSPHERES` in `kit/atmosphere.ts`.

## home (`/`), built
- Ground-level avenue looking down −z, stepped megatower at z ≈ −380. Rain, blade signs with wet-street reflections, flying and ground traffic, three searchlights.
- Camera: slow drift around (0, 7.5, 24) looking at (0, 24, −160), with pointer parallax.
- Kit: `avenue`, `skyline`, `steppedTower`, `streetSurface`, `streetLamps`, `hangSigns`, `createTraffic`, `createRain`, `createSearchlights`, `createBeacons`.

## metro (`/stack`, ambient on `/stack/[slug]`), built: `src/scenes/metro.ts`
- High view over a low city. 12 stations (tower + lit deck), 3 lines (cyan, amber, pink) at different heights, routed octilinearly (`kit/paths.ts` `octilinear`) so they read like a metro map.
- Rails are emissive boxes on dark beams with pylons, plus a soft glow strip. Trains are strings of 6 glows ping-ponging along each `Polyline`. Air traffic sits above the lines.
- Camera: (±30, 120, 170) looking at (0, 20, −230).

## archive (`/knowledge`, ambient on notes), built: `src/scenes/archive.ts`
- Cold aisle 2.4 m wide between rack rows, ceiling at 3 m. One 9.6 m period (16 racks per side) is built and copied 8×. The camera dollies at 0.7 m/s and wraps every period, so the loop is seamless.
- Rack fronts are procedural 1U textures (`buildingGeometry` with `tile: [0.6, 2.2]`, `jitter: false`). LEDs are tiny glows whose blink state is shared across copies so the wrap is invisible. Ceiling strips have floor reflections, there's a raised-floor grid, and low teal haze.
- Dense FogExp2 (0.045) ends the corridor.

## construction (`/projects`, ambient on project pages), built: `src/scenes/construction.ts`
- `steppedTower(built: 0.56)` with an open column frame and slabs above the build line, a 4-face amber scaffold lattice, work lights and floodlights.
- Two tower cranes: mast with lattice edges, a slewing `Group` jib with counter-jib, cab, trolley light and a hook cable updated in place, with the tip beacon tracked in world space.
- Welders: blue-white core flicker plus pooled spark glows with gravity. Sodium site lamps with wet-ground streaks.

## rooftop (`/ideas`), built: `src/scenes/rooftop.ts`
- Camera on a roof deck looking up at about 30°. 16–28 masts with crossbars, dishes and guy wires as silhouettes, each topped with a red beacon.
- Neighbouring towers rise from the street at y = −140. Two additive cloud layers (procedural tileable texture) scroll at different speeds.
- Searchlights come up from the street. Drones drift on Lissajous paths with blinking navigation lights.

## desert (`/about`), built: `src/scenes/desert.ts`
- Low camera on the highway shoulder looking at the horizon. Road with dashes and amber/red reflectors.
- Two solar fields of tilted panel rows (gradient texture catching the dusk), merged into one draw call. A ridge silhouette.
- The city at z ≈ −1750: skyline, megatower, and huge pink, cyan and amber horizon glows. Stars as `Points` with fog off.
- The hauler: tail lights, amber trailer markers and a cab beacon heading for the city, looping.

## 404, built: `src/pages/404.astro`
- CSS-only skyline of window-striped blocks and a humming neon "404". `sceneLive={false}` keeps three.js off the page.
