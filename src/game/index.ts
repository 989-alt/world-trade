import type Phaser from 'phaser';
import { K } from './boot';
import { PortScene } from './PortScene';
import { SailingScene } from './SailingScene';

/** 항구 배경은 1280×720 좌표로 그린다 → 캔버스 배수 k(boot.ts)만큼 카메라를 키운다(왼쪽 위 기준) */
class Port extends PortScene {
  create(data: Parameters<PortScene['create']>[0]) {
    this.cameras.main.setOrigin(0).setZoom(K);
    super.create(data);
  }
}

export const scenes: Phaser.Types.Scenes.SceneType[] = [SailingScene, Port];
