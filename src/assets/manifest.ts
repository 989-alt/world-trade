import { GOODS } from '../content/goods';
import { PORTS } from '../content/ports';
import { HEADINGS } from '../game/ship';
import { BGM } from '../audio/audio';

/**
 * 런타임이 읽는 에셋 전부(키 = 파일 1:1, 값 = index.html 기준 상대경로).
 * public/assets → ../assets 심링크를 Vite 가 dist/assets 로 복사한다. 검증: audio/audio.test.ts 'asset manifest'(디스크에 있나·코드가 쓰는 경로가 다 들었나)
 */
const UI = [
  'panel', 'ribbon', 'speech-frame', 'badge', 'logo',
  'btn-blue', 'btn-orange', 'btn-cream',
  'dpad', 'dpad-right-pressed', 'anchor-btn', 'anchor-btn-pressed',
  'medal-gold', 'medal-silver', 'medal-bronze',
  'icon-anchor', 'icon-cargo', 'icon-coin', 'icon-fuel', 'icon-speech', 'icon-ledger', 'icon-compass', 'icon-map',
  'icon-import', 'icon-export',
  'icon-axis-nature', 'icon-axis-resource', 'icon-axis-capital', 'icon-axis-tech', 'icon-axis-geo',
];
const IMG = ['bg-worldmap', 'mask-worldmap', 'key-title', 'scene-byeokran', 'npc-customs-alpha', 'npc-manager-alpha'];

export const MANIFEST: Record<string, string> = Object.fromEntries([
  ...UI.map((n) => [`ui/${n}`, `assets/ui/${n}.png`]),
  ...IMG.map((n) => [`img/${n}`, `assets/img/${n}.png`]),
  ...PORTS.map((p) => [`port/${p.id}`, p.background]),
  ...GOODS.map((g) => [`goods/${g.id}`, g.icon]),
  ...HEADINGS.map((h) => [`ship/${h}`, `assets/img/ship/ship-${h}.png`]),
  ...Object.entries(BGM).map(([k, v]) => [`bgm/${k}`, v]),
]);
