# Kit API

Source: `src/scenes/kit/`. Everything takes a `Kit` from `createKit(ctx)`. Static geometry is batched, and glows and streaks are single instanced or merged meshes. Call `kit.finish()` once after building and `kit.commit()` at the end of every `update`.

## `index.ts`: `createKit(ctx, { glowCapacity?, streakCapacity?, palettes? })`

Returns:
- `ctx`, `rng`
- `glows: GlowField`: all camera-facing additive glows (default capacity 600)
- `streaks: StreakField`: all ground reflections (default capacity 300)
- `statics: StaticBatch`: merged static geometry per material
- `textures: { glow, streak }`
- `windowMaterials: MeshBasicMaterial[]`: one per window palette (`WIN_PALETTES` by default)
- `dark`: near-black structural material (`0x0a0812`)
- `unitPlane`: shared 1×1 plane geometry
- `finish()`, `commit()`

## `atmosphere.ts`
- `ATMOSPHERES[id]`: `{ sky: [stop, colour][], fog: { color, density } }` (FogExp2)
- `applyAtmosphere(scene, atmosphere)`: sets the background gradient texture and fog
- `skyTexture(stops)`

## `rng.ts`
- `createRng(seed)` → `{ next, range(min,max), pick(arr), chance(p) }` (mulberry32). Use `ctx.rng`, never `Math.random`, so every load of a scene builds the same city.

## `textures.ts`
- `glowTexture()`, `streakTexture()`
- `windowTexture(palette, rng, anisotropy)`: 128×256, an 8×16 window grid tiling both ways, with occasional fully lit floors
- `WIN_PALETTES`: `{ cols, d }[]`, where `d` is the fraction of windows lit

## `glow.ts`: `GlowField`
- `add(color, x, y, z, sx, sy, opacity) → index` (−1 when full)
- `setOpacity(i, o)`, `setPosition(i, x, y, z)`, `getZ(i)`, `commit()`
- A custom billboard shader: one draw call, FogExp2-aware (fades towards fog colour like SpriteMaterial), with `glowGain` applied as a uniform.

## `streaks.ts`: `StreakField`
- `add(color, x, z, w, len, opacity) → index`: a quad on the ground (y = 0.03) from `z` towards +z (the viewer), bright at the source
- `setOpacity(i, o)`, `commit()`

## `merge.ts`: `StaticBatch`
- `add(geometry, material)`, `addLines(geometry, lineMaterial)`, `flush(parent)`
- Translate and rotate geometry in place before adding. All geometries per material must share attributes (all indexed, or none).

## `buildings.ts`
- `buildingGeometry(rng, x, z, w, d, h, y0 = 0, { tile?, jitter? })`: a positioned box with the PoC's UV tiling. One texture tile per `tile` units, default `[12, 24]` (window grid), dark top and bottom. `jitter: false` disables the random horizontal offset, for panels like server racks that must line up.
- `boxEdges(x, y, z, w, h, d)`: edge lines for neon outlines
- `Frontage`: `{ side, x, w, zc, d, h }` street-facing facade info

## `city.ts`
- `avenue(kit, { road, zNear, zFar, maxX, beacons? }) → Frontage[]`: two rows of buildings along −z
- `skyline(kit, { count, xSpread, zNear, zFar, size?, height?, beacons?, beaconAbove? })`
- `steppedTower(kit, { x, z, tiers: [w, h][], material, edgeColor?, edgeOpacity?, built?, spire?, beacons? }) → topY`. Set `built < 1` for a half-built tower (construction scene).
- `streetSurface(kit, { road, zNear, zFar })`: ground, road and dashes
- `streetLamps(kit, { road, zNear, zFar, spacing?, color? })`: poles, glows and reflections
- `hangSigns(kit, signs, fronts, { max, nearZ? })`: blade signs and rooftop boards

## `signs.ts`: `createSigns(kit) → SignSystem`
- `blade(word, color, x, y, z, w, reflect)`, `bladeHeight(word, w)`, `board(word, color, x, y, z, w, h)`
- `update(t)`: delayed flicker-in over about 0.3–3 s, with about 18% flickering intermittently afterwards
- `count()`
- `SIGN_WORDS`, `SIGN_COLORS`, `BOARD_WORDS`: original words only (see the originality rule)
- Signs are front-side only: keep the camera on the +z side.

## `beacons.ts`: `createBeacons(kit) → { add(x, y, z, size?, color?), update(t), steady() }`

## `traffic.ts`: `createTraffic(kit, opts) → { update(dt) }`
- `opts`: `{ zMin, zMax, air: { count, lanes, spread(y), speed }, ground?: { count, x, y, speed }, colors? }`. Vehicles are glow pairs moving along z and wrapping around.

## `rain.ts`: `createRain(kit, { count, width, height, zMin, zMax, color?, opacity?, slant? }) → { update(dt) }`

## `searchlights.ts`: `createSearchlights(kit) → { add(x, z, color, { length?, radius?, tilt?, y?, opacity? }), update(t) }`

## `paths.ts`
- `new Polyline(points)`: `.length`, `.at(s, out)` samples by distance (clamped), `.segments()`
- `octilinear(stops2d, y)`: metro-map routing (a 45° run then a straight run between stops)

## `canvas.ts`
- `makeCanvas(w, h) → { canvas, g }`, `canvasTexture(canvas)`

## Adding to the kit
Put anything a second scene could use in the kit, with a typed options object, drawing from `kit.rng`. Static parts go through `kit.statics`, lights through `kit.glows`. Document it here.
