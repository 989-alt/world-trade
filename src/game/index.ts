import type Phaser from 'phaser';
import { SailingScene } from './SailingScene';

export const scenes: Phaser.Types.Scenes.SceneType[] = [SailingScene];

// 개발용 진입(타이틀 → 항해). app.tsx 가 화면 흐름을 맡으면 이 줄을 지운다
if (import.meta.env.DEV) void import('../ui/TitleScreen').then((m) => m.mountDev());
