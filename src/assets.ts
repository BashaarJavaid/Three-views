import { AssetType, defineAssets } from '@iwsdk/core';
import { createGlassBox } from './scene-assets/glass-box.scene-asset.js';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

const uikitml = (fileName: string, name: string) => ({
  url: publicAssetUrl(`ui/${fileName}`),
  type: AssetType.UIKitML,
  name,
});

export default defineAssets({
  'glass-box': createGlassBox(3),
  'welcome-panel': uikitml('welcome.uikitml', 'Welcome Panel'),
  'controls-panel': uikitml('controls.uikitml', 'Controls Panel'),
  'home-panel': uikitml('home.uikitml', 'Home Panel'),
  'result-panel': uikitml('result.uikitml', 'Result Panel'),
  'tutorial-panel': uikitml('tutorial.uikitml', 'Tutorial Panel'),
});
