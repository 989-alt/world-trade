import type Phaser from 'phaser';
import { PortScene } from './PortScene';
import { SailingScene } from './SailingScene';

export const scenes: Phaser.Types.Scenes.SceneType[] = [SailingScene, PortScene];

// 개발용 진입(타이틀 → 항해, 입항하면 항구 화면). app.tsx 가 화면 흐름을 맡으면 이 줄을 지운다
// TitleScreen.mountDev 는 입항 즉시 출항시키는 리스너를 달아서, 그 몸통만 여기서 되풀이한다
if (import.meta.env.DEV) {
  void Promise.all([import('preact'), import('../ui/TitleScreen'), import('../ui/Hud'), import('../ui/PortPanel'), import('../engine/state'), import('./SailingScene')]).then(
    ([{ h, render }, { TitleScreen }, { mountSailingUi }, { mountPortUi }, { reduce }, { gameStore, startSailing }]) => {
      const el = document.createElement('div');
      el.className = 'title';
      document.getElementById('ui')!.appendChild(el);
      mountPortUi(gameStore);
      const onStart = (s: Parameters<typeof reduce>[0]) => {
        render(null, el);
        el.remove();
        mountSailingUi(gameStore);
        startSailing(reduce(s, { type: 'START_MAIN' }).state);
      };
      render(h(TitleScreen, { hasSave: false, onStart: (s) => onStart(s), onContinue: () => {} }), el);
    },
  );
}
