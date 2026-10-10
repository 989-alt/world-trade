import type Phaser from 'phaser';
import { PortScene } from './PortScene';
import { SailingScene } from './SailingScene';

export const scenes: Phaser.Types.Scenes.SceneType[] = [SailingScene, PortScene];
