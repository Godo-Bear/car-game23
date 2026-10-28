# Tokyo Circuit Racer

A Forza-inspired 3D racing game set in Japan — city streets, a mountain pass and cherry-blossom
countryside, by day, at sunset or at night — running in the browser and hosted on Cloudflare.

- **Core racing loop:** cinematic fly-in over the grid, F1-style start lights, lap counting, live
  positions, lap timing, 3–7 AI opponents, a slow-motion trackside finish shot and a results screen.
- **Menu hub:** a bottom menu bar (*Home*, *Career*, *Garage*, *Shop*, *Quests*, *Profile*) with
  the logo, money, drift points (DP), profile and settings at the top. *Home* shows your car on a turntable under neon with,
  on the left: your next career event, Garage (upgrade level) and Profile cards, the featured
  *mega quest* (tap it to open *Quests*) and today's *daily quests*.
- **Quests:** *mega quests* are big goals that take a while (win 25 races, drive 300 laps, fully
  upgrade a car, own every car, every career event on the podium, 30 stars, 100,000 drift
  points, every star...) paying ¥25,000 – ¥200,000;
  *daily quests* are three small goals a day picked from a pool (finish 3 races, win one, a
  night race, a mountain pass, two circuits, a Hard race, 3,000 drift points...) that reset at midnight UTC. Finished
  quests glow with a *Claim* button; the server checks every claim against the account's stats
  and the day's races.
- **Career map:** the whole game is a career. *Career* shows an aerial view of a Japanese city
  (downtown towers and Tokyo Tower, green outskirts, snowy mountains and Fuji behind) with 20
  events pinned on it - city races downtown, countryside races on the outskirts, mountain passes
  up in the hills. Each event sets the circuit, time of day, laps and rivals; you choose the
  difficulty on the event card (Easy, Normal or Hard - harder pays more prize money, and a result
  on any difficulty counts, Easy included). Locked events show a padlock, the next one pulses
  under a green arrow, finished ones show your medal and stars. A podium unlocks the next event,
  and the first podium on each pays a bonus (¥5,000 – ¥40,000, up to the Tokyo Grand Final).
- **Stars:** every event has three time limits, shown on its card: finish the race inside them
  for one, two or three stars (about 1.4x, 1.18x and 1.04x the AI's typical lap on that circuit,
  times the laps; any difficulty and any position). Each new star pays ¥1,500 once, and the
  results screen shows the stars you earned and the time for the next one. The map opens on your next event (a big green NEXT pin, and a
  *Next event* button finds it again); drag the map to look around; tap a pin for its course map,
  prizes, star times and your best result. The server checks every event result (unlocked,
  matching the event) for accounts. The map picture (`public/career/map.jpg`) is rendered from the game.
- **Career:** you start with ¥3,000 and the Mame 1.3 starter car. Every finished race pays prize
  money (more for a better place, more laps, harder difficulty and more rivals; a 3-lap win on
  Normal is ¥10,500), plus career bonuses. Spend it in the *Shop* on other cars (¥30,000 – ¥220,000) or on upgrades
  in the garage: Engine, Gearbox, Aero, Tyres, Suspension, Brakes, Differential and Nitro, four
  levels each. Every car starts with similar stats (each with a little personality: the drift
  coupe slides best, the hypercar is fastest), and a fully upgraded car has every stat maxed at
  10, so any car you like can be tuned to the top. Old saves' "Handling" upgrade carries over to
  tyres, suspension and brakes. With an account the server does
  the sums (prices, prize money, what you own), so money only comes from racing; guests are saved
  on the device. A guest's money doesn't move to a new account.
- **Garage:** six cars with their own feel — Mame 1.3 (starter), Shiro Spyder (roadster),
  Kaze GT (all-rounder), Oni 86R (drift coupe), Yama R4 (rally special) and Raijin V12 (hypercar).
  Five use 3D models from `public/models/` (see *3D assets*); the rally car (and any car whose
  model fails to load) uses the built-in body with wheel arches, glasshouse, lights, grilles and
  brake calipers. Customise paint colour and finish (gloss / metallic / pearl / matte, plus satin,
  candy and chrome from the shop), livery
  (racing stripes, side stripe, two-tone, race livery), accent colour, rim colour, race number and
  your own number plate text (up to 8 characters), and *Extras* bought in the shop (underglow,
  nitro flame colour, tyre smoke colour); saved per car to your account.
- **Drift points and cosmetics:** drifting scores drift points (speed x slide angle; a crash
  mid-drift loses that drift's points). They're banked into your DP balance at the finish (the
  server caps them by the race time). Spend DP in *Shop → Cosmetics* on neon underglow (7
  colours), nitro flame colours (6) and tyre smoke colours (7); the premium paint finishes cost
  money. Tap an item to try it on your car on the turntable before buying.
  The AI race your car's class and the classes either side of it (a few the same as yours) in team
  colours, with their engines evened out a little toward your car's pace; your upgrades are yours
  alone, so tuning pays off.
- **Admin tab:** on the Profile page. Press *Admin* and enter the admin code to unlock it; it then
  shows as a Profile tab for the account (or guest) that entered it on that device, until *Lock*
  is pressed. Look up any player (or list them all) and set their money and drift points, which
  cars they own and each car's upgrade levels, shop items (give or take all), career (win every
  event, every star, or reset), quests (finish or reset today's dailies, reset mega quests) and
  career stats (races, wins, podiums, laps). The server
  checks the code on every request (changes are saved to the player's account) and locks a network address out for 15 minutes after 10 wrong
  codes. Only a SHA-256 of the code is in this repository (`shared/admin.ts`); to use a private
  code instead, run `npx wrangler secret put ADMIN_CODE` (it replaces the built-in one). Without
  the backend, the panel edits this device's guest profile.
- **Nitro:** Shift / N (X or RB on a gamepad). A tank of boost that pushes harder than the engine
  alone, with blue exhaust flames, a wider view and speed blur. It refills slowly on its own and
  quickly while drifting.
- **Vehicle physics:** semi-simulation bicycle model — tyre slip, weight transfer, 6-speed automatic
  gearbox, handbrake drifting with skid marks and tyre smoke, stability control, slipstream, and
  crashes that cost real speed. Drifts are assisted: there's no countersteering to do - once the
  car is sideways the game countersteers for you and you keep steering into the corner (more
  lock for more angle and a tighter line); centre the steering or lift off and it straightens
  up and settles without fishtailing. A drift follows the road even flat out: the direction of
  travel is swung round the bend ahead, speed is scrubbed off if the corner is too tight for it,
  and a slide heading for the barrier is pushed back onto the road. The car carves toward
  where it is pointing instead of sliding wide into the barrier, and lifting off the throttle ends a drift
  cleanly (the rear grips up and the slide is reeled in). Steering calms down at speed, and with
  stability assist on a barrier assist nudges you away from walls you're about to hit.
- **Ten circuits** with wide, flowing corners (the track picker scrolls sideways):
  - **Tokyo** — 2.95 km *Shinjuku–Bay Street Circuit*: neon towers, a Shibuya scramble chicane, an
    elevated Shuto-style expressway, Tokyo Tower, Skytree and Rainbow Bridge.
  - **Osaka** — 3.71 km *Namba–Dotonbori Street Circuit*: a neon main straight, a square block
    through Namba, the elevated Hanshin Expressway, Osaka Castle in its park, a big wheel and
    Umeda's supertall tower.
  - **Yokohama** — 3.67 km *Minato Mirai Bay Circuit*: downtown blocks, then an elevated run along
    the harbour past the Cosmo Clock big wheel, the Landmark Tower, the Marine Tower and the Bay
    Bridge.
  - **Hakone** — 3.71 km mountain pass (touge): a ladder of hairpin switchbacks climbing through
    cedar forest, a ridge road and a long descent to the lake with its floating torii; guardrails
    and hairpin chevrons.
  - **Irohazaka** — 3.74 km: Nikko's famous hairpin road, four tight switchbacks in a row through
    blazing autumn maples and gold broadleaf trees, falling leaves, a pagoda by the lake.
  - **Mt. Haruna** — 2.75 km touge: back-to-back hairpins up from the lake, a fast ridge and a run
    of esses on the way down; lakeside ryokan, torii and ropeway.
  - **Niseko** — 3.22 km Hokkaido snow pass: wide, flowing road between frosted firs, a frozen
    lake, falling snow, red-and-white arrow poles marking the road edges, Mt. Yotei on the horizon.
  - **Sakura Valley** — 3.22 km fast countryside circuit through rolling grassland, cherry-blossom
    avenues with falling petals, a lake with a five-storey pagoda, and a torii gate over the start.
  - **Arashiyama** — 3.03 km through Kyoto's western hills: a third of the lap walled in by the
    bamboo grove, red maples, a temple pagoda by the pond and the Sagano line.
  - **Izu Coast** — 2.98 km: a long beachfront straight along the sea, pine-lined shore and a
    lighthouse, then up into the hills, with Mt. Fuji across the bay.
- **Time of day:** day, sunset or night on any circuit — sky, sun position, shadows, fog, street
  lamps, lit windows, neon and headlights all change.
- **Realistic look (Dirt 5-style):** physically based sky (Rayleigh/Mie scattering) with drifting
  clouds that also lights and reflects in the scene; a camera "lens" pass with filmic grading,
  vignette, subtle colour fringing and sun glare that only shows when the sun is unobstructed;
  thousands of individually swaying grass blades (with wildflowers) planted on the terrain around
  the camera; surface relief on asphalt, concrete and rock; tree shadows on High; MSAA anti-aliasing
  (FXAA on Low), real-time ambient occlusion plus baked contact shadows; rubbered-in racing line;
  rain-soaked Tokyo nights with puddles and neon/lamp reflections.
- **Japan, everywhere you look:** Mt. Fuji with snow in its gullies on the horizon; power poles
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
│   │   ├── cityCircuits.ts     # Osaka and Yokohama layouts
│   │   ├── circuits.ts         # Mountain and countryside layouts
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
│   │   ├── CarModel.ts         # Car bodies + liveries: spinning/steering wheels, body roll, lights, plates
│   │   ├── importedCars.ts     # Loads public/models/<car>/car.glb: fit, paint recolouring, livery shader
│   │   ├── meshUtils.ts        # Geometry merge / winding helpers
│   │   ├── TireEffects.ts      # Skid marks + tyre smoke
│   │   └── Sparks.ts           # Barrier-scrape sparks
│   ├── world/
│   │   ├── World.ts            # Builds the scenery for a circuit
│   │   ├── scenes.ts           # What surrounds each circuit (landmarks, lake, trees, signs...)
│   │   ├── City.ts             # Procedural city: buildings, neon, lamps, landmarks
│   │   ├── Nature.ts           # Terrain, lakes, forests, cherry blossoms, petals, pagoda, Fuji
│   │   ├── foliage.ts          # Tree shapes, wind sway, contact shadows
│   │   ├── Grass.ts            # GPU grass field that travels with the camera
│   │   ├── japan.ts            # Fuji, power lines, vending machines, trains, mirrors, houses, paddies…
│   │   ├── surfaces.ts         # Terrain/road detail, wet asphalt, light reflections
│   │   ├── Lighting.ts         # Physical sky, sun/moon, fog, shadows and reflections per time of day
│   │   └── textures.ts         # Canvas-generated textures
│   ├── camera/ChaseCamera.ts   # Chase / far chase / bonnet cams
│   ├── core/                   # Input (rebindable keys + gamepad), settings store, audio, math
│   ├── ui/                     # HUD, minimap, menu hub, garage + upgrades, shop, settings window
│   └── account/                # Client for the accounts API (with guest fallback)
├── server/                     # Cloudflare Worker: /api/* accounts, sessions, stats, settings, shop
├── shared/api.ts               # Types + validation shared by client and Worker
├── shared/economy.ts           # Prices, prize money, upgrades, purchase rules (client and Worker)
├── shared/career.ts            # Career events, unlocks, bonuses, stars, drift points (client and Worker)
├── shared/items.ts             # Shop cosmetics: underglow, flames, smoke, paint finishes
├── shared/quests.ts            # Quests and their rewards (client and Worker)
├── shared/wallet.ts            # Validating stored wallets
├── migrations/                 # D1 schema (applied automatically by the Worker)
├── public/models/<car>/car.glb # Car models (see 3D assets)
├── public/previews/            # Track-picker pictures (rendered by `npm run previews`)
├── scripts/render-previews.mjs # Renders those pictures from the game itself
├── tests/                      # Vitest: track, physics (incl. drift), collisions, races for every car and a mixed field
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

Most of the world — terrain, trees, signs, sky, textures, sound, the rally car — is generated in
code. From model files:

- **Cars:** five car bodies (below).
- **City Kit buildings** (`public/models/city/`): the city lots near the circuit, merged into a
  few meshes with Japanese wall colours and windows that light up at night.
- **Tokyo Tower** (`public/models/landmarks/`, by Kenta Imai): cut out of its diorama, it stands
  once on every map (in Tokyo, as Osaka's and Yokohama's red towers, and on the skyline of every
  countryside map), lit orange after dark.

- **Countryside landmarks** (`public/models/landmarks`, `nature`, `props`): a five-storey pagoda
  by the Sakura Valley lake (and by the lakes at Irohazaka and Arashiyama), a giant old cherry by
  the start line (Sakura Valley, Izu), a castle-style pagoda on the Hakone lake shore (and as Osaka
  Castle's keep), a giant autumn maple by the start (Hakone, Irohazaka, Haruna, Arashiyama), and
  wooden roadside signs painted with place names in Japanese and English. Each is placed on level ground that fits it (lake
  shore, roadside verge at road height) and only downloaded with the map that uses it. The two
  trees and the castle were shrunk 3-4x (merged per material, quantized vertices).

If a scenery file fails to load, the built-in buildings and tower are used
(`src/world/sceneryModels.ts`).

The car models are glTF files in `public/models/<car>/car.glb`, set up in
`src/vehicles/importedCars.ts`. Each is scaled to the car's size, its axles lined up with the
physics, and split into parts by material: the paint takes the player's colour, finish and livery
(paint baked into a texture is picked out by its hue and recoloured), rims take the rim colour,
tail lights glow under braking, the wheels spin and steer, and number plates are fitted to the
bumpers. Brand badges and the models' own plates are left out. Wheels can be separate nodes,
a pair in one node (split down the middle) or moulded into the body (cut out and replaced). To add
a model: put it in the car's folder, add an entry with its material names, and run `npm test` (it
checks the file matches its entry). Keep files small (these are 0.2–1.4 MB); large textures can
be shrunk to JPEG before adding them.

| Car | Model | Author | Source |
| --- | --- | --- | --- |
| Mame 1.3 | Basic Car | Quaternius (CC0) | Poly Pizza |
| Kaze GT | 2015 Dodge Challenger | Grzybek | Poly Pizza |
| Shiro Spyder | Convertible | Poly by Google (CC-BY) | Poly Pizza |
| Oni 86R | Mazda RX-7 | IvOfficial | Poly Pizza |
| Raijin V12 | Lamborghini Aventador | Ignition Labs | Poly Pizza |
| Sakura Valley pagoda | Pagoda | Poly by Google (CC-BY) | Poly Pizza |
| Hakone castle pagoda | Pagoda | Poly by Google (CC-BY) | Poly Pizza |
| Sakura start tree | Big Sakura Bonsai | Michael Grönert | Poly Pizza |
| Hakone start tree | Mystic Tree | Alexandre KOURNWSKY | Poly Pizza |
| Roadside signs | Wooden Sign | iPoly3D | Poly Pizza |
| Tokyo Tower | 東京タワー | Kenta Imai | Poly Pizza |

Credits are also shown in the garage. Check each model's licence on its Poly Pizza page before
using the game commercially (the real car names and designs may be trademarks).
