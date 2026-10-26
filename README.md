# Tokyo Circuit Racer

A Forza-inspired 3D street racing game set on a night-time Tokyo circuit, running in the browser
and hosted on Cloudflare.

- **Core racing loop:** standing start with F1-style start lights, lap counting, live positions, lap
  timing, 3–7 AI opponents, results screen.
- **Vehicle physics:** semi-simulation bicycle model — tyre slip, weight transfer, 6-speed automatic
  gearbox, handbrake drifting with skid marks and tyre smoke, stability control, slipstream, and
  crashes that cost real speed.
- **Tokyo:** a 2.48 km *Shinjuku–Bay Street Circuit* — main straight under neon towers, a Shibuya
  scramble chicane, an elevated Shuto-style expressway along the bay, and Tokyo Tower, Skytree and
  Rainbow Bridge on the skyline.
- **HUD:** speed (KM/H), gear + RPM, position, lap, current/last/best lap time, standings, minimap.
- **Accounts:** log in / create an account from the homescreen; career stats, recent races and race
  settings are saved to your account (Cloudflare D1). Without an account, progress is kept as a
  guest profile on the device.

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
├── index.html                  # Canvas + HUD + homescreen/login/controls/pause/results markup
├── src/
│   ├── main.ts                 # Entry point (WebGL2 check, boots Game)
│   ├── styles.css              # UI styling
│   ├── game/Game.ts            # State machine (home → countdown → racing → finished), main loop, rendering
│   ├── track/
│   │   ├── tokyoCircuit.ts     # The circuit layout (corner points, radii, elevation)
│   │   ├── TrackPath.ts        # Centre-line sampling, projection (lap distance / lateral offset)
│   │   └── TrackMesh.ts        # Road, barriers, catch fences, kerbs, expressway deck, start gantry
│   ├── physics/
│   │   ├── VehiclePhysics.ts   # Car model: tyres, gearbox, brakes, handbrake, ESC
│   │   └── Collisions.ts       # Barrier + car-to-car impulses, crash speed loss
│   ├── ai/
│   │   ├── RacingLine.ts       # Minimum-curvature racing line + speed profile
│   │   └── AIDriver.ts         # Pure-pursuit driver, overtaking, stuck recovery
│   ├── race/
│   │   ├── RaceManager.ts      # Laps, lap times, positions (reverse-proof)
│   │   └── RaceSimulation.ts   # Fixed-step world update shared by game and tests
│   ├── vehicles/CarModel.ts    # Procedural car mesh: spinning/steering wheels, body roll, lights
│   ├── world/                  # Procedural Tokyo: buildings, neon signs, landmarks, sky, textures
│   ├── camera/ChaseCamera.ts   # Chase / far chase / bonnet cams + homescreen orbit
│   ├── core/                   # Input (keyboard + gamepad), synthesised audio, math
│   ├── ui/                     # HUD, minimap, menus
│   └── account/                # Client for the accounts API (with guest fallback)
├── server/                     # Cloudflare Worker: /api/* accounts, sessions, stats, settings
├── shared/api.ts               # Types shared by client and Worker
├── migrations/                 # D1 schema (applied automatically by the Worker)
├── tests/                      # Vitest: track, physics, collisions, race rules, full AI race
├── wrangler.jsonc              # Cloudflare Workers config (static assets + API + D1)
└── docs/DEPLOY_CLOUDFLARE.md   # Hosting guide
```

## Running locally

Requires Node.js 22+.

```bash
npm install
npm run dev        # http://localhost:5173 — game with hot reload (guest profile, no accounts)
npm run dev:full   # http://localhost:8787 — full stack: real Worker + local D1, accounts work
npm test           # unit tests incl. a headless 8-car race
npm run build      # type-check + production build into dist/
```

Add `?debug` to the URL to expose the game object as `window.game` in the console.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Accelerate | `W` / `↑` | Right trigger |
| Brake / reverse | `S` / `↓` | Left trigger |
| Steer | `A` `D` / `←` `→` | Left stick |
| Handbrake / drift | `Space` | A / Cross |
| Change camera | `C` | Y / Triangle |
| Reset car to track | `R` | View / Share |
| Pause | `Esc` / `P` | Menu / Options |
| Show controls | `H` (or the **?** / **Controls** buttons) | |
| Mute | `M` | |

## Deploying to Cloudflare

See **[docs/DEPLOY_CLOUDFLARE.md](docs/DEPLOY_CLOUDFLARE.md)**. Short version (Workers Builds from
GitHub): build command `npm run build`, deploy command `npx wrangler deploy`, Worker name
`tokyo-circuit-racer`. The D1 accounts database is created automatically on first deploy.

## 3D assets

Everything — cars, buildings, signs, landmarks, textures, sound — is generated in code, so the game
has no external asset files and no licensing to track. `CarModel` and `City` are isolated so
real glTF models (e.g. licensed Tokyo buildings or vehicles) can be swapped in later.
