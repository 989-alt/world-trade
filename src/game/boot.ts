import Phaser from 'phaser';
import { scenes } from './index';


export function setDialogOpen(open: boolean): void {
  document.body.classList.toggle('ui-open', open);
  const kb = game?.input.keyboard;
  if (kb) kb.enabled = !open;
  if (game) game.input.enabled = !open;
}

let game: Phaser.Game | undefined;

/**
 * 캔버스 해상도 배수(M3): k = min(devicePixelRatio × 스테이지 배율, 3), 부팅 때 한 번.
 * 게임 크기 = 1280k × 720k, CSS 로는 #game(1280×720) 에 맞춘다 → 모든 카메라 줌·UI 좌표에 k 를 곱한다(그림은 기기 픽셀로, DOM 은 그대로).
 * FIT 이 아니라 NONE + zoom 1/k: FIT 은 #game 의 getBoundingClientRect(스테이지 scale() 이 이미 곱해진 크기)에 맞춰
 * 배율이 두 번 들어간다(실측 960×540 창: 캔버스 720×405 로 작아짐, 1920×1080: 2880×1620 으로 넘침). 1/k 면 CSS 1280×720 고정, 스테이지가 키운다
 */
export let K = 1;

export function boot(): Phaser.Game {
  const stage = Number(document.documentElement.style.getPropertyValue('--stage-scale')) || 1; // main.tsx fit()
  K = Math.min(window.devicePixelRatio * stage, 3);
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: 1280 * K,
    height: 720 * K,
    backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--color-sea').trim(), // tokens.css
    scale: { mode: Phaser.Scale.NONE, zoom: 1 / K },
    scene: scenes,
    // CSP connect-src 'none' 이라 XHR 로더가 막힌다 → 모든 씬이 <img> 로 읽는다
    loader: { imageLoadType: 'HTMLImageElement' },
  });
  return game;
}
