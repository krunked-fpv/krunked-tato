# krunkedtato

[![CI & Deploy Pages](https://github.com/krunked-fpv/krunked-tato/actions/workflows/ci.yml/badge.svg)](https://github.com/krunked-fpv/krunked-tato/actions/workflows/ci.yml)

**Play Live:** https://krunked-fpv.github.io/krunked-tato/

A standalone, deterministic 60 Hz top-down arena shooter roguelite built in TypeScript and WebGL2, featuring multi-device input (Keyboard/Mouse, Xbox/Standard Gamepad, and auto-hiding transparent Touch controls for Mobile & Tesla in-car browsers), a 60-character / 80-weapon / 194-item declarative EffectGraph, and dual-mode Built-In Original Krunked Art/Synth or optional local Custom Pack loading.

## Features

- **Deterministic 60 Hz Simulation (`src/sim/`)**: 100% DOM-free fixed-timestep arena simulation with serializable Mulberry32 PRNG and FNV-1a state hashing for bit-exact replay verification.
- **Massive Build Variety (`src/data/`)**: 60 playable spud characters, 80 weapons across 4 rarity tiers (45 melee + 35 ranged), 17 weapon sets with 2–6 piece bonuses, 194 items, 64 level-up stat cards, 38 enemies/elites/bosses, 3 arena zones (Crash Zone, Abyssal Trench, Primal Jungle), and Danger 0–6 (including Double Wave 20 Boss & Endless Wave 21+).
- **WebGL2 High-Refresh Rendering (`src/render/`)**: Batched instanced quad renderer supporting 30 / 60 / 120 FPS (default 120 FPS with smooth interpolation or Classic 60 snap), hit-flash, rarity outlines, melee slash smears, floor decals, and automatic Canvas 2D fallback.
- **Dual-Mode Asset & Audio Engine (`src/assets/`, `src/audio/`)**: Ships ready-to-play with 100% original procedural comic-inked Krunked vector atlases and dynamic Web Audio synthesis, plus an optional client-side Custom Pack loader with IndexedDB caching and live toggle on the Title screen.
- **Seamless Multi-Device Input (`src/input/`)**:
  - **Keyboard + Mouse**: `WASD` / Arrow keys to move, auto-aim default (`Space` / Click / `M` toggles manual cursor aim), `Esc` Pause, `Tab` Stats.
  - **Xbox / Standard Gamepad**: Full combat + menu/shop navigation (`Left Stick` / `D-Pad`, `Right Stick` instant twin-stick aim override, `A` Confirm/Buy, `B` Back, `X` Reroll/Recycle, `Y` Lock/Combine, `LB/RB` Switch Focus, `Start` Pause, `View` Stats) with dynamic Xbox glyphs.
  - **Mobile & Tesla Browser Touch**: Virtual touch controls stay completely hidden on desktop and smoothly appear as low-opacity translucent glass overlays **only** when touch input activates (floating left-half movement stick, right-half optional manual-aim pad, and translucent corner controls), immediately hiding again on keyboard, mouse, or gamepad activity.

## Quick Start

```bash
npm install
npm run play
```

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start Vite development server |
| `npm run play` | Launch local play server on `http://127.0.0.1:5173` |
| `npm run typecheck` | Run strict TypeScript type check |
| `npm run test` | Execute Vitest unit & integration suites |
| `npm run verify:assets` | Run Gate A asset resolution, oracle parity, and hygiene checks |
| `npm run verify:sim` | Run Gate B deterministic headless campaign & replay soak |
| `npm run verify` | Run typecheck, tests, Gate A, and Gate B |
| `npm run build` | Build production bundle into `dist/` |
| `npm run extract` | Optional local read-only pack extraction into gitignored `.krunkedtato-assets/` |
| `npm run oracle` | Optional local read-only mechanic oracle dump into `.krunkedtato-assets/oracle.json` |
