# Three Views

Three Views is a daily spatial puzzle for VR, played with your hands. The top, front and side outlines of a hidden shape glow on three walls of a glass box. You build a shape from blocks inside the box until its three shadows match the three outlines. Any shape that casts the right shadows wins.

**Play:** https://bashaarjavaid.github.io/Three-views/ (live after the first deploy)

## How to play

- Play seated. Every target is within arm's reach.
- Point and pinch (or click with a mouse) to tap. Every action is a tap: there is nothing to hold or drag.
- In **Add** mode, tap a floor square or the face of a block to place a block there. In **Remove** mode, tap a block to take it away.
- **Turn left** and **Turn right** rotate the box by a quarter turn. **Undo** steps back one move. **Clear** empties the box (tap it twice to confirm).
- When all three shadows match their outlines, the puzzle is solved.
- One new **daily puzzle** each day. Solving it on consecutive days builds your **streak**.
- **Practice** has eight levels. Two solves at a level move you up one.
- The first time you play, three short teaching puzzles show you how it works.

## Devices

- Meta Quest 3 and 3S, in the Meta Quest Browser, with hand tracking.
- Meta VR Glasses (gaze and pinch).
- Any desktop browser, in a flat tab, with a mouse.

## Testing status

This build was tested only in the browser, with the Immersive Web SDK's XR emulator (IWER). It has **never been run on a physical headset or on Meta VR Glasses**. What could not be checked without a headset is listed in [HARDENING.md](HARDENING.md).

## Run it locally

Needs Node 24.

```sh
npm install
npm run dev        # dev server with the XR emulator in a managed browser
npm test           # game-logic tests
npm run build      # production build into dist/
```

`npm run typecheck` checks types. Pushing to `main` builds, tests and publishes the site to GitHub Pages (`.github/workflows/deploy-pages.yml`).

## Privacy

No accounts, no sign-in, no analytics and no server of its own. Your progress (streak, level, settings) is stored only in your browser's `localStorage`. The game still works if storage is blocked; progress is just not kept.

## Built with

[Immersive Web SDK](https://iwsdk.dev) (IWSDK), TypeScript and Vite. The shapes are generated in code and the sounds are synthesized; there is no third-party art or audio.

## Licence

Copyright 2026 BashaarJavaid. Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
