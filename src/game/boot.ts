import Phaser from 'phaser';
import { scenes } from './index';

const SEA = '#3FA7E6'; // --color-sea (tokens.css)

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
    backgroundColor: SEA,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: scenes,
  });
  return game;
}
