import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import * as feedback from './feedback/feedback-system.js';
import { FlowSystem } from './flow/flow-system.js';
import { PanelSystem } from './panel.js';
import * as events from './play/events.js';
import * as play from './play/play-system.js';
import { setGlassBoxSize } from './scene-assets/glass-box.scene-asset.js';
import { TutorialSystem } from './tutorial/tutorial-system.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(PanelSystem);

  // --- Later tickets register their systems here (wired by the orchestrator).
  // T-03 play, T-04 feedback, T-05 flow, T-06 tutorial.
  world.registerSystem(play.PlaySystem);
  world.registerSystem(feedback.FeedbackSystem);
  world.registerSystem(TutorialSystem); // before FlowSystem: a first visit starts the tutorial
  world.registerSystem(FlowSystem); // after PlaySystem: Home needs the play API
  // --- End of later-ticket systems.

  // Dev-only handle for emulator checks; stripped from production builds.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__threeViews = {
      world,
      setGlassBoxSize,
      play,
      events,
      feedback,
      flow: () => world.getSystem(FlowSystem),
      tutorial: () => world.getSystem(TutorialSystem),
    };
  }
});
