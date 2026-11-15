# Hardening results (T-07)

Run 2026-11-15 by the T-07 agent. **All of this is desktop data.** It comes from the IWSDK browser emulator (IWER) on a MacBook, with the Meta Quest 3 and Meta VR Glasses device profiles. None of it was measured on a Quest or on glasses. Frame times on a laptop do not show that the app holds 60 fps on a headset. The agent cannot hear audio, so sound results rest on Web Audio node starts and the AudioContext state.

Screenshots are in `/private/tmp/claude-501/-Users-bashaarjavaid-Projects-three-views/3175fc5f-e9de-4772-a1d8-501f42b38806/scratchpad/t07/`. That is session scratch space; copy anything you want to keep.

## Summary

| # | Check | Result | Key number (method below) |
|---|---|---|---|
| 1 | Glasses fit, every screen | PASS | Worst edges: result card v −40.7° (limit −43°), sides ±34.7° (limit ±37°) |
| 2 | Daily puzzle solved by gaze and pinch | PASS | 9 gaze taps, 9 blocks, solved; run twice (before and after the fixes) |
| 3 | Tap targets ≥ 3° with a visible gap | PASS | Smallest: Exit VR 3.5° tall, Skip 3.6° tall; gaps 0.8–1.2° |
| 4 | Draw calls under 100, largest case | **FAIL** | 602 draw calls per stereo frame (N = 4, 40 blocks, turning) |
| 4b | Frame time, normal and 4× CPU throttle | Reported | Update + render CPU: 5.2 ms normally, 18.4 ms at 4×, mean per frame |
| 5 | Cold start (production build, flat) and bundle size | Reported | First frame after all panels load: 1410 ms on the first run, then 208–242 ms. Build is 3.71 MB in 20 files |
| 6 | Failure drills | PASS, with notes | No app errors. One emulator-only error when storage is blocked from page load (see 6a) |
| 7 | High contrast | PASS | Frames and lines brighter and thicker. Panels don't change, by design |
| 8 | Runtime network calls | **FAIL against D8** | The SDK fetches hand and controller models from cdn.jsdelivr.net when XR starts |

Small fixes made (each listed with evidence under "Fixes"): gaze enabled, Home settings row, ghost hit-test, start-of-puzzle tap guard.

## 1. Glasses fit (Meta VR Glasses profile)

Method: `dev.emulator.device` was set to `metaVRGlasses` and `gazeTracking` was enabled. `xr status` reported `deviceName: "Meta VR Glasses"` with `gaze-tracking` among `enabledFeatures`. Headset at the seated pose (0, 1.2, 0), looking straight ahead. Box at its −30° resting yaw.

An in-page script took the world bounding box of every visible mesh under each screen object. It skipped meshes whose bounds sit at the origin (UIKit glyph quads). Each corner's angle from the eye was then measured on the view axis: h = atan2(dx, −dz), v = atan2(dy, −dz). Limits are h ±37°, v −43°…+25°. The figures are box corners, so they are conservative.

| Screen | Element | h (°) | v (°) | Screenshot |
|---|---|---|---|---|
| Home (after the settings fix) | Home panel | −24.2 … 24.2 | −29.5 … 3.0 | `g-01-home.png`, `12-glasses-home-after-daily.png` |
| Home / landing in XR | Welcome panel (title, Exit VR) | −9.9 … 9.9 | 8.7 … 21.7 | same |
| Puzzle N = 4 (daily) | Glass box | −18.6 … 18.6 | −25.2 … 12.6 | `g-02-puzzle-n4-daily.png`, `10-glasses-daily-start-n4.png` |
| | Control bar | −27.5 … 27.5 | −33.5 … −26.3 | |
| | Readout | −8.1 … 8.1 | 12.1 … 15.4 | |
| Puzzle N = 3 (practice) | Glass box | −16.5 … 16.5 | −23.1 … 10.5 | `g-03-puzzle-n3-practice.png` |
| Result, daily | Result card | −34.7 … 34.7 | −40.7 … −27.3 | `g-04-result-daily.png`, `11-glasses-daily-result.png` |
| | Box with the solved build | −18.6 … 18.6 | −25.2 … 15.0 | |
| Result, practice | Result card | −34.7 … 34.7 | −40.7 … −27.3 | `g-05-result-practice.png` |
| Tutorial step 1 | Tutorial panel (line and Skip) | −22.2 … 22.2 | 12.0 … 20.7 | `g-06-tutorial-step1.png` |
| Tutorial step 2 | same | −22.2 … 22.2 | 12.0 … 20.7 | `g-07-tutorial-step2.png` |
| Tutorial step 3, at rest | same; box −17 … 17 / −23.7 … 12.2 | | | `g-08-tutorial-step3-rest.png` |
| Tutorial step 3, after Turn right | box −19.2 … 19.2 / −26.5 … 12.2 | | | `g-09-tutorial-step3-turned.png` |
| Flat page (no glasses view) | Home + welcome, mouse | n/a | n/a | `21-flat-landing-home.png` |

Every element is inside the view. The tightest margins are the result card's bottom edge (2.3° above the −43° limit) and its lower corners (2.3° inside ±37°). In every glasses screenshot the content sits inside the black mask.

## 2. Gaze and pinch

- Config change: `"gazeTracking": true` under `world.xr.features` (optional, not required).
- Console: `[iwsdk][gaze] 'gaze-tracking' granted for this session`, then `gaze XRInputSource appeared`, then `emulated gaze pose is valid (synthetic, not eye tracking)`. No errors.
- Method: right hand ray pointed away from all content (at (0.6, 0.5, −0.3)). Gaze aimed with `xr look-at {"device":"gaze"}`, pinch sent with `xr select` on `hand-right`, or on `hand-left` for one tap.
- Daily, end to end, by gaze only:
  - Gaze at Daily, pinch: `puzzle-started {n:4, par:10}`.
  - 9 gaze taps. A script picked each next floor square or block face and checked first that the eye ray hit exactly that object. The taps produced 9 `block-added` (cells 17, 18, 19, 22, 23, 27, 34, 35, 38), three `wall-matched`, then `solved {seconds:61, blocks:9, par:10}`.
  - Result card, gaze at Home, **left**-hand pinch: Home shows "Daily: done 1:01", streak 1.
  - Run again after both play fixes: 9 gaze taps, `solved`. Screenshot `g-10-final-gaze-daily-solved.png`.
- Practice also solved by gaze (`g-05`).
- Whole tutorial by gaze: step 1 ghost, step 2 remove block 19, Turn right on the bar, step 3 ghost. Each step solved.
- Fallback: with gaze disconnected (`xr set-connected false`, log line `the gaze XRInputSource disappeared`), the hand ray at Practice started practice. With gaze reconnected and the hand still aimed at Practice, gaze at Daily plus a pinch started the **daily**, so gaze owns targeting.
- Hover evidence: `Hovered` is set on the whole panel entity, not on each button, so `ecs find` can't show hover moving between buttons on one panel. The state change after each pinch is the evidence.
- Quest 3 regression with `gazeTracking` on:
  - Hand ray-and-pinch solved a practice puzzle.
  - Controller ray solved one.
  - Mouse clicks in the flat page solved one.
  - Tutorial step 1 ghost tap from the low hand pose solved it.
  - Side effect: on Quest 3 the SDK logs two **warnings** per session ("'gaze-tracking' was NOT granted", "no XRInputSource with targetRayMode === "gaze" appeared within 3s"). They are not errors.

## 3. Target audit

Method: an in-page script measured each button's own mesh. Angular width and height = the angle at the eye between opposite edge midpoints. Gap = the angle between facing edges of neighbours. Seated eye (0, 1.2, 0).

| Panel | Target | Width × height (°) | Gap to next (°) |
|---|---|---|---|
| Home | Daily | 44.0 × 7.8 | 1.2 (to Practice) |
| | Practice | 42.5 × 7.3 | 1.1 (to settings row) |
| | Sound | 12.2 × 4.7 | 1.0 |
| | Contrast ("Contrast off/high") | 15.9 × 4.8 | 1.0 |
| | Tutorial | 10.4 × 4.6 | |
| Result | Next | 13.5 × 4.9 | 0.8 (to Home) |
| | Home | 13.5 × 4.9 | |
| Control bar | Add, Remove, Turn left, Turn right, Undo, Clear, Home | 5.0–5.7 × 4.9–5.2 | 1.1–1.2 |
| Tutorial | Skip | 7.9 × 3.6 | |
| Welcome | Exit VR | 17.0 × 3.5 | |
| Box | One block face or floor square, N = 3 (12 cm) | 5.2–6.4 | 0, by design (neighbouring cells; the face is read from the hit point) |
| Box | One block face or floor square, N = 4 (10 cm) | 4.2–5.4 | 0, by design |

No target is under 3°. The smallest is Exit VR at 3.5° tall.

## 4. Frame time and draw calls

Method:
- An in-page sampler wrapped `world.update` and `renderer.render` for 6 s, or 2.5 s for the solve.
- It recorded the frame interval, the CPU time of each call, and `renderer.info.render.calls/triangles` after each render.
- Emulator in an `immersive-vr` session, Quest 3 profile.
- One `render()` per frame draws both eyes, so draw calls are per stereo frame.
- 4× throttling used CDP `Emulation.setCPUThrottlingRate {rate: 4}` on the managed tab.
- The browser's frame interval is capped at the laptop's 60 Hz display, so the CPU time per frame is the meaningful figure.

| Case | Frame interval mean / p95 (ms) | update mean (ms) | render mean / p95 (ms) | Draw calls | Triangles |
|---|---|---|---|---|---|
| N = 4, 40 blocks, Turn every 300 ms | 16.66 / 18.0 | 0.81 | 4.40 / 5.2 | **602** | 9,400 |
| Same, 4× CPU throttle | 24.27 / 30.0 (about 41 fps) | 2.81 | 15.61 / 19.5 | **602** | 9,400 |
| N = 4 daily, solve moment (10 blocks) | 16.66 / 17.7 | 0.77 | 2.80 / 3.3 | 254–266 | 8,160 |
| Same, 4× CPU throttle | 16.66 / 19.0 | 2.42 | 7.49 / 9.3 | 254–266 | 8,160 |

Draw calls by state, read once from `renderer.info` (stereo): Home 58; daily puzzle empty 126; daily with 9 blocks 258.

**FAIL: under 100 draw calls.** Every block is two draws (the mesh and its edge lines), and every wall square overlay is a separate mesh. A visible-object count in the 40-block state gave `play-walls` 95, `play-build` 81, control bar 12 and glass walls 6, then doubled for two eyes. The fix is to instance the blocks and edges and merge the overlay meshes in `src/play/`. That is more than a small fix, so it was not made.

A typical daily (10 blocks) uses about 260 draw calls. The 4×-throttled 40-block case averaged about 41 fps on this laptop. Quest hardware was not measured.

## 5. Cold start and bundle

- Build: `npx vite build --outDir <scratch>/dist-t07` (same config as `npm run build`; built away from `dist/` because T-08 was working in parallel). Result: `✓ built in 6.05s`.
  - 20 files, 3,705,067 bytes. Main chunk `index-*.js` is 2,461.96 kB, or 678.49 kB gzip.
  - Each file gzipped at −9: 1,260,017 bytes in total.
  - No `__threeViews` in the build.
- Cold start: `vite preview` served that build on port 4180. Playwright-core then launched headless Chromium with the HTTP cache off, five fresh contexts each, flat page (no WebXR in that browser).
  - "First interactive frame" = the first `requestAnimationFrame` after all five `ui/*.uikitml` panels finished loading. Screenshot `70-coldstart-prod-flat.png` shows tutorial step 1 fully drawn at that moment.

| CPU | Run 1 | Runs 2–5 | DOMContentLoaded (runs 2–5) | Main-window transfer |
|---|---|---|---|---|
| 1× | 1410 ms | 231, 208, 218, 242 ms | 172–182 ms | 967 KB, 9 requests |
| 4× throttle | 1033 ms | 580, 571, 585, 646 ms | 433–487 ms | 967 KB, 9 requests |

These are localhost numbers: no network latency, laptop CPU. The cold start was measured on the build before the 2-line start-guard fix. The final build differs by 44 bytes.

Note for T-08: `public/ui/AGENTS.md` and `public/scenes/AGENTS.md` are copied into the build (`ui/AGENTS.md`, `scenes/AGENTS.md`) and would be published.

## 6. Failure drills

| Drill | How | Result |
|---|---|---|
| a. Storage blocked from page load | Playwright route injected a script at the top of the app document, so `localStorage`/`sessionStorage` threw `SecurityError` before any app code ran. Stacks were recorded for every access. | App: `progress.load()` threw inside its own try/catch, and defaults were used (tutorial starts). Skip, then Practice, then a mouse solve: result card shown, progress kept in memory (`solvesAtLevel 1`). **One uncaught `SecurityError` per load, from the IWER emulator injection (`virtual:iwsdk-dev-runtime/.../injection-template` called from `@iwer-injection-runtime`).** IWER doesn't install, so `navigator.xr.offerSession` is missing and XR can't start in the emulator under blocked storage. That is the cause of T-05's `[XR] Failed to start offered XR session`. It is dev-only: the production bundle's only storage users are our `progress.ts` (try/catch) and the SDK's SceneUnderstandingSystem (not registered here; also try/catch). Not fixable in our code; documented, not hacked. Screenshots `50-…`, `51-…`. |
| b. Audio blocked | `window.AudioContext` replaced by a constructor that throws `NotAllowedError` before the first tap. Then Practice by hand pinch and a full solve by hand ray. | Solved. `soundLog` stayed empty, and play, walls, solve pulse and result card were unaffected. No new console errors or warnings (only the two gaze warnings). `80-…` |
| c. Reload mid-puzzle | Practice with 2 blocks, then `browser reload`. | Home, `session: null`, progress unchanged. The unfinished puzzle is not restored (no mid-puzzle save, by design). No errors. `81-…` |
| d. XR ended and re-entered mid-puzzle | Practice by hand pinch with 2 blocks, `xr exit`, then `xr enter`, then the rest of the solve by hand ray. | After exit: flat view, same build `[1, 2]`, same session. After re-entry the solve completed (`[1, 2, 5, 8, 11]`, solved). One three.js warning, `Can't change size while VR device is presenting`, which is harmless. `82-…`, `83-…` |
| e. Rapid repeated taps on every button | Flat page, 8 trusted mouse clicks 40 ms apart on Sound, Contrast, Practice, Remove, Add, Turn left, Turn right, Undo, Clear, then Home. | Sound and Contrast unchanged after 8 (even count). Turn ×8 gave 2 accepted turns; the rest emitted `tap-rejected`. Undo ×8 removed all 4 blocks, then rejected. Clear ×8 left 0. Home returned Home. No errors. **Found:** the clicks after Practice landed on the new puzzle's floor and added stray blocks. Fixed (see Fixes). |
| f. Tapping during a turn | Part of (e) and (g). | Bar taps during a turn: `tap-rejected`. Build taps during a turn: ignored (DESIGN §5). |
| g. 200 random taps | Flat page, 200 trusted clicks at seeded random points over box and bar (not the bar's Home), 30 or 120 ms apart. Invariants checked every 20 taps. | 10 adds, 8 rejected, 16 button presses, 6 turns. At all 10 checkpoints, the wall-match flags equal `wallMatches(shape)`, `solved` equals `isSolved`, and 0 block meshes are out of sync with the shape. No errors. `84-…` |
| h. CDN unreachable (added for §8) | Playwright route aborted jsdelivr, unpkg and dicebear with `internetdisconnected`, then reload, enter XR, hands. | 4 failed GLB requests and the SDK warning `input will be tracked without a visual`. Hand rays still drawn. Practice and Remove by hand pinch both worked. Hands are invisible. `60-…` |
| No hover (issue 7) | Every `pointerover/enter/out/leave/move` listener in the scene stripped (58), and stripped again every 50 ms. Practice with blocks [0, 10]. Clear by hand pinch twice. | 1st tap: label "Sure?", blocks kept (`32-…`). 2nd tap: 0 blocks. |

Console after the final reload (Quest 3 profile, flat, before entering XR): 0 errors, 0 warnings. Each Quest 3 XR session adds the two gaze warnings described in §2.

## 7. High contrast

Puzzle at N = 4 with 7 blocks, contrast on and off at the seated pose and close up (`40-…` to `43-…`). With it on, target frames are brighter and thicker and grid lines read more strongly. Matched walls, ticks and result-card build look correct (`11-glasses-daily-result.png` was taken with it on). Home, result, tutorial and bar panels don't change in high contrast mode. They are already light-on-dark Horizon UI and the setting only touches the wall overlays (`setHighContrast` → `setOverlayContrast`). Nothing broken.

## 8. Runtime network calls (orchestrator request)

Method:
- Playwright `context.on('request')` with a reload, for flat load (352 requests seen), XR with hands, and XR with controllers.
- For a full puzzle (controller ray), `performance` resource timing was cleared just before the first tap, with the buffer raised to 10,000.

| Moment | Requests leaving the origin | Trigger |
|---|---|---|
| Flat page load | none | |
| Enter XR (session starts with controllers) | `https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/meta-quest-touch-plus/left.glb` and `…/right.glb` (200) | `@iwsdk/xr-input` loads the controller visual when an input source connects |
| Switch to hands | `…/profiles/generic-hand/left.glb` and `…/right.glb` (200) | Same, for the hand visual |
| Full puzzle by controller ray | none (0 resource entries during the puzzle) | |
| Production cold start (Playwright, flat) | none | |

Sizes when fetched in-page: touch-plus left 217,984 B, right 213,868 B; generic-hand left 94,572 B, right 94,004 B. On glasses the source profiles may differ; I didn't capture those separately.

`unpkg.com/three@0.185.0/.../draco` and `basis` are never requested: no glTF here uses Draco or KTX2. `api.dicebear.com` is never requested: no UIKit `Avatar` is used. Both strings are present in the bundle.

Supported way to avoid the CDN: **none found in config.**
- `iwsdk.config.json`'s schema `input` block only has `canvasPointerEvents`.
- In `@iwsdk/xr-input`, `loadInputProfile()` hard-codes `assetPath: ${DEFAULT_PROFILES_PATH}/…` with `DEFAULT_PROFILES_PATH = "https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles"`.
- `createVisual()` prefers that path over any `visualClass.assetPath`.
- Core builds `XRInputManager` with `assetLoader: AssetManager` and gives no option to override it.

The only routes would be:
- vendor the 4 GLBs (about 620 KB, third-party profile art from `@webxr-input-profiles/assets`) and redirect the URLs, for example by pre-seeding `AssetManager`'s cache under the CDN URL as key (untested); or
- patch the SDK.

Both need the orchestrator's go-ahead, and vendoring brings the third-party-art rule into play. Measured fallback: with the CDN unreachable the app is fully playable and hands or controllers are just not drawn (drill h). The D8 wording, and the README's claim of no runtime network calls, needs the orchestrator's decision.

## Fixes made in this ticket

| File | Change | Why | Evidence |
|---|---|---|---|
| `iwsdk.config.json` | `"gazeTracking": true` (+1 line, comma) | Gaze and pinch did nothing on the glasses | Before (T-05): gaze + pinch didn't select. After: daily solved by gaze. Quest hand, controller and mouse still work |
| `public/ui/home.uikitml` | Root width 600 → 700 px (60 → 70 cm); settings buttons gap 8 → 6 px, side padding 10 → 8 px | "Sound on" and "Contrast off" wrapped to two lines | Before `01-home-settings-fix.png` (660 px try, still wrapping), `01c-…` ("Contrast high" wrapped at equal widths). After `01b-…` and `01d-…`: "Sound off", "Contrast high" and "Tutorial" each on one line. Home h ±24.2° (was ±21.0°) |
| `src/play/play-system.ts` `syncGhostHit` + `afterChange` (+4 lines) | The ghost takes ray hits only while its cell is empty, re-synced after every change, undo or clear | With the hinted cell filled, a tap on it gave `tap-rejected` | Step 3 with extra block 25: ghost tap adds 12 (`ghostHit: off`). A tap on block 12's top now adds 21 (before: rejected via the ghost path, per T-06's note). Undo of 12 turns the ghost hit back on |
| `src/play/play-system.ts` `START_GUARD_MS = 300` (+3 lines) | Ray taps on the build are ignored for 300 ms after a puzzle starts | A fast double tap on Daily, Practice or Next dropped a stray block into the new puzzle | Double click 109 ms → 0 blocks; 193 ms → 0; 540 ms → 1 block (normal). The in-page play API (`tapFloor`) is unaffected |

Gates after the fixes: `npm run typecheck` exit 0; `npm test` gives tests 17, pass 17, fail 0. Production build OK (above).

## Known issues not fixed

1. **Draw calls (602 at 40 blocks, about 260 typical) are over the 100 target.** Fixing it means instancing in `src/play/`. Not small.
2. **Hand and controller models come from cdn.jsdelivr.net** (§8). There is no config switch.
3. **Tutorial step 3 ghost after the turn is hard to see.**
   - The ghost (`#ffd29a`, opacity 0.3–0.55) sits behind the side-wall pane and in front of orange blocks of a similar colour.
   - In seated screenshots it reads only as a slightly paler block. The idle gold halo (opacity sampled 0.40–0.48) hardly separates from it.
   - The same applies, more mildly, to the step 1 ghost.
   - Evidence: `g-09e-step3-seated-idle-*.png`, crops `crop-idle-1.png`, `crop-idle-3.png`, and Quest `30-…`/`31-…`.
   - A colour change or `depthTest: false` on ghost and halo would be a few lines, but it is a visual-design call, so I left it to the orchestrator.
4. The daily result line "Streak: 1 day. Back tomorrow!" wraps to two lines on the card (`11-glasses-daily-result.png`). It still fits.
5. Audio: in the emulator the first sound after an XR pinch with no DOM pointer event played with `ctx running` and no autoplay warning. But the page already had user activation (`navigator.userActivation.hasBeenActive: true`), so this run can't show what happens on a headset where the session came from the browser's own XR offer without a page tap.

## Not verifiable without a headset

- Real frame rate and frame time on Quest 3/3S and on Meta VR Glasses (laptop CPU and GPU only; draw-call count is the known risk).
- Real hand tracking: pinch detection, ray jitter and hand-loss behaviour (emulator poses are exact).
- Real eye-tracking gaze accuracy on the glasses. The emulator's gaze is synthetic and aimed by script.
- Whether text and 10 cm blocks are legible at the headset's resolution, and the glasses' optics at the view edges (the result card sits 2.3° inside the lower limit).
- Sound: never heard. Only oscillator starts and the AudioContext state were checked. Whether the context starts when XR begins from the browser's own offer, with no page tap.
- Quest Browser behaviour with storage blocked or private browsing. The emulator's XR runtime itself needs storage.
- Comfort of the seated layout over a 10-minute session.
- Behaviour with no internet: hand and controller models are fetched from a CDN; offline they are not drawn (input still works, as shown in the emulator).
