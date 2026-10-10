import Phaser from 'phaser';
import { scenes } from './index';


export function setDialogOpen(open: boolean): void {
  document.body.classList.toggle('ui-open', open);
  const kb = game?.input.keyboard;
  if (kb) kb.enabled = !open;
  if (game) game.input.enabled = !open;
}

let game: Phaser.Game | undefined;

export function boot(): Phaser.Game {
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: 1280,
    height: 720,
    backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--color-sea').trim(), // tokens.css
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: scenes,
    // CSP connect-src 'none' 이라 XHR 로더가 막힌다 → 모든 씬이 <img> 로 읽는다
    loader: { imageLoadType: 'HTMLImageElement' },
  });
  return game;
}
