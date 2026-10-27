# Tokyo Circuit Racer

A Forza-inspired 3D racing game set in Japan — city streets, a mountain pass and cherry-blossom
countryside, by day, at sunset or at night — running in the browser and hosted on Cloudflare.

- **Core racing loop:** cinematic fly-in over the grid, F1-style start lights, lap counting, live
  positions, lap timing, 3–7 AI opponents, a slow-motion trackside finish shot and a results screen.
- **Menu hub (Dirt 5 style):** *Race* (circuit cards with preview pictures, time of day, laps,
  opponents, difficulty), *Garage*, *Career* and *Settings* tabs over a live homescreen: the field
  racing over the Hakone pass on a sunny day, filmed with TV-style camera shots.
- **Garage:** five cars with their own handling and body (wheel arches, real glasshouse with
  pillars, swept lights, grilles, diffusers, exhausts, flares/intakes/vents per model, detailed
  wheels with brake calipers) — Kaze GT (all-rounder), Shiro Type-H
  (hot hatch), Yama R4 (rally special), Oni 86R (drift coupe) and Raijin V12 (hypercar). Customise
  paint colour and finish (gloss / metallic / pearl / matte), livery (racing stripes, side stripe,
  two-tone, race livery), accent colour, rim colour and race number; saved per car to your account.
  Races are one-make: the AI drive the same car in team colours.
- **Vehicle physics:** semi-simulation bicycle model — tyre slip, weight transfer, 6-speed automatic
  gearbox, handbrake drifting with skid marks and tyre smoke, stability control, slipstream, and
  crashes that cost real speed. High-speed drifts are assisted: the car carves toward where it is
  pointing instead of sliding wide into the barrier. Steering calms down at speed, and with
  stability assist on a barrier assist nudges you away from walls you're about to hit.
- **Three circuits:**
  - **Tokyo** — 2.48 km *Shinjuku–Bay Street Circuit*: neon towers, a Shibuya scramble chicane, an
    elevated Shuto-style expressway, Tokyo Tower, Skytree and Rainbow Bridge.
  - **Hakone** — 2.87 km mountain pass (touge): a ladder of hairpin switchbacks climbing through
    cedar forest, a ridge road and a long descent to the lake with its floating torii; guardrails
    and hairpin chevrons.
  - **Sakura Valley** — 2.59 km fast countryside circuit through rolling grassland, cherry-blossom
    avenues with falling petals, a lake with a five-storey pagoda, and a torii gate over the start.
- **Time of day:** day, sunset or night on any circuit — sky, sun position, shadows, fog, street
  lamps, lit windows, neon and headlights all change (Mt. Fuji is on the horizon everywhere).
- **Realistic look (Dirt 5-style):** physically based sky (Rayleigh/Mie scattering) with drifting
  clouds that also lights and reflects in the scene; a camera "lens" pass with filmic grading,
  vignette, subtle colour fringing and sun glare that only shows when the sun is unobstructed;
  thousands of individually swaying grass blades (with wildflowers) planted on the terrain around
  the camera; surface relief on asphalt, concrete and rock; tree shadows on High; MSAA anti-aliasing
  (FXAA on Low), real-time ambient occlusion plus baked contact shadows; rubbered-in racing line;
  rain-soaked Tokyo nights with puddles and neon/lamp reflections.
- **Japan, everywhere you look:** Mt. Fuji with snow in its gullies on every horizon; power poles
  with sagging wires; glowing vending machines; red lanterns outside izakaya; Japanese traffic
  lights; a JR commuter line on a viaduct over Tokyo and a Shinkansen crossing Sakura Valley
  between two tunnels; orange curve mirrors and concrete lattice cut slopes on the Hakone pass; a
  lakeside ryokan and the Hakone ropeway; flooded rice paddies, tiled-roof and thatched gassho
  farmhouses and carp streamers in the countryside; cedar, sugi, maple, pine, bamboo and sakura.
- **Speed & impact feedback:** speed blur and speed lines above ~180 km/h, kerb rumble and camera
  shake, sparks and grinding when scraping a barrier, impact thuds.
- **Settings:** graphics quality Low / Medium / High (auto-detected), speed blur and camera shake
  toggles, master / engine / effects volume, and fully rebindable keyboard controls with
  **Reset binds**. Stored per device.
- **Runs on modest hardware:** if the frame rate stays under ~40 FPS, the game steps the quality
  down by itself (High → Medium → Low, then a lower render resolution) and remembers it; this can
  be switched off, and an FPS counter can be shown, in Settings → Graphics. Cars are merged per
  material (~16 draw calls each), so a full race frame is ~180–490 draw calls depending on quality.
- **HUD:** speed (KM/H), gear + RPM, position, lap, current/last/best lap time, standings, minimap.
- **Accounts:** log in / create an account from the homescreen; career stats, best lap per circuit,
  recent races, race settings and your garage are saved to your account (Cloudflare D1). Without an
  account, progress is kept as a guest profile on the device.
- **Fast loading:** racing lines are computed in a Web Worker while the scenery builds (and cached
  on the device), built circuits are kept for instant switching, and shaders compile
  asynchronously.

## Engine / framework choice

**Three.js + TypeScript + Vite**, with a custom physics/AI layer.

| Option | Why / why not |
| --- | --- |
| **Three.js** ✅ | Mature WebGL renderer, tiny compared to engine exports (~175 kB gzipped total here), loads in seconds, deploys as plain static files — a perfect fit for Cloudflare's edge hosting. |
| Babylon.js | Also good, but heavier and more "engine" than this game needs. |
| Unity / Godot web export | Great editors, but 10–40 MB WebAssembly downloads, slow first load, and awkward to host/iterate as a website. |
| Physics engine (Rapier/cannon) | General rigid-body engines make arcade-sim car handling hard to tune. A purpose-built tyre model is deterministic, testable without a browser, and lets the AI drive the exact same car as the player. |

The simulation (track, physics, AI, race rules) is plain TypeScript with no rendering dependencies,
runs at a fixed 120 Hz, and is covered by unit tests — including a headless 8-car race.

## Project structure

```
├── index.html                  # Canvas + HUD + menu hub / garage / settings / pause / results markup
├── src/
│   ├── main.ts                 # Entry point (WebGL2 check, boots Game)
│   ├── styles.css              # UI styling
│   ├── game/
│   │   ├── Game.ts             # State machine (home → intro → countdown → racing → finished), main loop
│   │   ├── Cinematics.ts       # Grid fly-in, homescreen TV shots, garage turntable, slow-mo finish
│   │   ├── RaceFeedback.ts     # Impacts, kerb rumble/shake, scrapes + sparks, drift points, wrong way
│   │   ├── TrackLoader.ts      # Track + racing-line cache (Web Worker, device cache)
│   │   └── PerformanceMonitor.ts # FPS counter + automatic quality step-down
│   ├── render/RenderPipeline.ts # Renderer, MSAA/FXAA, ambient occlusion, bloom, speed blur, quality levels
│   ├── track/
│   │   ├── tracks.ts           # Circuit registry (theme, names)
│   │   ├── tokyoCircuit.ts     # Tokyo layout (corner points, radii, elevation)
│   │   ├── circuits.ts         # Hakone and Sakura Valley layouts
│   │   ├── TrackPath.ts        # Centre-line sampling, projection (lap distance / lateral offset)
│   │   ├── TrackMesh.ts        # Road, barriers, catch fences, kerbs, rubber line, start gantry
│   │   └── racingLine.worker.ts # Racing-line relaxation off the main thread
│   ├── physics/
│   │   ├── VehiclePhysics.ts   # Car model: tyres, gearbox, brakes, handbrake, drift assist, ESC
│   │   └── Collisions.ts       # Barrier + car-to-car impulses, crash speed loss, contact points
│   ├── ai/
│   │   ├── RacingLine.ts       # Minimum-curvature racing line + speed profile
│   │   └── AIDriver.ts         # Pure-pursuit driver, overtaking, stuck recovery
│   ├── race/
│   │   ├── RaceManager.ts      # Laps, lap times, positions (reverse-proof)
│   │   └── RaceSimulation.ts   # Fixed-step world update shared by game and tests
│   ├── vehicles/
│   │   ├── cars.ts             # The garage: car specs, bodies, stats, default paint jobs
│   │   ├── CarModel.ts         # Procedural cars + liveries: spinning/steering wheels, body roll, lights
│   │   ├── TireEffects.ts      # Skid marks + tyre smoke
│   │   └── Sparks.ts           # Barrier-scrape sparks
│   ├── world/
│   │   ├── World.ts            # Builds the scenery for a circuit
│   │   ├── City.ts             # Procedural Tokyo: buildings, neon, lamps, landmarks
│   │   ├── Nature.ts           # Terrain, lakes, forests, cherry blossoms, petals, pagoda, Fuji
│   │   ├── foliage.ts          # Tree shapes, wind sway, contact shadows
│   │   ├── Grass.ts            # GPU grass field that travels with the camera
│   │   ├── japan.ts            # Fuji, power lines, vending machines, trains, mirrors, houses, paddies…
│   │   ├── surfaces.ts         # Terrain/road detail, wet asphalt, light reflections
│   │   ├── Lighting.ts         # Physical sky, sun/moon, fog, shadows and reflections per time of day
│   │   └── textures.ts         # Canvas-generated textures
│   ├── camera/ChaseCamera.ts   # Chase / far chase / bonnet cams
│   ├── core/                   # Input (rebindable keys + gamepad), settings store, audio, math
│   ├── ui/                     # HUD, minimap, menu hub, garage, settings window
│   └── account/                # Client for the accounts API (with guest fallback)
├── server/                     # Cloudflare Worker: /api/* accounts, sessions, stats, settings
├── shared/api.ts               # Types + validation shared by client and Worker
├── migrations/                 # D1 schema (applied automatically by the Worker)
├── public/previews/            # Track-picker pictures (rendered by `npm run previews`)
├── scripts/render-previews.mjs # Renders those pictures from the game itself
├── tests/                      # Vitest: track, physics (incl. drift), collisions, races for every car
├── biome.json                  # Lint + format rules
├── .github/workflows/ci.yml    # CI: lint, tests, type-check + build
├── wrangler.jsonc              # Cloudflare Workers config (static assets + API + D1)
└── docs/DEPLOY_CLOUDFLARE.md   # Hosting guide
```

## Running locally

Requires Node.js 22+.

```bash
npm install
npm run dev        # http://localhost:5173 — game with hot reload (guest profile, no accounts)
npm run dev:full   # http://localhost:8787 — full stack: real Worker + local D1, accounts work
npm test           # unit tests incl. headless races on every circuit and with every car
npm run lint       # Biome lint + format check (npm run format fixes)
npm run build      # type-check + production build into dist/
npm run previews   # re-render public/previews/*.jpg (needs `npm run dev` running + Playwright)
```

In development (`npm run dev`), add `?debug` to the URL to expose the game object as `window.game`
in the console. GitHub Actions runs lint, tests and the build on every push and pull request.

## Controls

Every keyboard control can be changed in **Settings → Controls** (click a key, press the new one;
right-click clears it; **Reset binds** restores these defaults).

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Accelerate | `W` / `↑` | Right trigger |
| Brake / reverse | `S` / `↓` | Left trigger |
| Steer | `A` `D` / `←` `→` | Left stick |
| Handbrake / drift | `Space` | A / Cross |
| Change camera | `C` | Y / Triangle |
| Reset car to track | `R` | View / Share |
| Pause / back | `Esc` / `P` | Menu / Options |
| Skip intro | any key | any button |
| Controls & settings | `H` (or the **?** button) | |
| Browse cars (garage) | `←` `→` / `Q` `E` | |
| Mute | `M` | |

## Deploying to Cloudflare

See **[docs/DEPLOY_CLOUDFLARE.md](docs/DEPLOY_CLOUDFLARE.md)**. Short version (Workers Builds from
GitHub): build command `npm run build`, deploy command `npx wrangler deploy`, Worker name
`tokyo-circuit-racer`. The D1 accounts database is created automatically on first deploy.

## 3D assets

Everything — cars, buildings, terrain, trees, signs, landmarks, sky, textures, sound — is generated
in code, so the game has no external asset files and no licensing to track. `CarModel` and `City` are isolated so
real glTF models (e.g. licensed Tokyo buildings or vehicles) can be swapped in later.
