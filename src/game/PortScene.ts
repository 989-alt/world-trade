import Phaser from 'phaser';
import type { PortId } from '../content/types';

/** 항구 배경 한 장(1280x720 cover). 글자·버튼은 전부 DOM(ui/PortPanel). 항해 씬은 그동안 멈춰 있다 */
let plugin: Phaser.Scenes.ScenePlugin | null = null;
let showing: PortId | null = null;

window.addEventListener('ktrade:docked', (e) => {
  showing = (e as CustomEvent<{ port: PortId }>).detail.port;
  plugin?.restart({ port: showing });
});
window.addEventListener('ktrade:undock', () => {
  showing = null;
  plugin?.stop();
});

export class PortScene extends Phaser.Scene {
  constructor() {
    // 부팅 때 한 번 켜져 플러그인을 잡아 두고, 입항마다 restart·출항 때 stop
    super({ key: 'port', active: true, loader: { imageLoadType: 'HTMLImageElement' } });
  }

  create(data: { port?: PortId }) {
    plugin = this.scene;
    const port = data.port ?? showing;
    if (!port) return;
    const key = `port-${port}`;
    const show = () => {
      const img = this.add.image(640, 360, key);
      img.setScale(Math.max(1280 / img.width, 720 / img.height));
    };
    if (this.textures.exists(key)) return show();
    this.load.image(key, `assets/img/${key}.png`);
    this.load.once(Phaser.Loader.Events.COMPLETE, show);
    this.load.start();
  }
}
