import Phaser from 'phaser';
import type { Keys } from './ship';

type Dir = keyof Keys;
type Rect = { x: number; y: number; w: number; h: number };

/** DESIGN: D-패드 176×184 우28·하24, 닻 120×120 우224·하40 (스테이지 1280×720, 화면 고정) */
export const DPAD: Rect = { x: 1280 - 28 - 176, y: 720 - 24 - 184, w: 176, h: 184 };
export const ANCHOR: Rect = { x: 1280 - 224 - 120, y: 720 - 40 - 120, w: 120, h: 120 };
/** 가운데 칸(176/3 × 184/3 ≈ 59×61 — 팔 하나도 같은 크기라 56px 이상)은 방향 없음 */
const DEAD_W = DPAD.w / 3;
const DEAD_H = DPAD.h / 3;

const inside = (r: Rect, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

/** 화면 좌표 → D-패드 방향(가운데·바깥이면 null) */
export function dirAt(x: number, y: number): Dir | null {
  if (!inside(DPAD, x, y)) return null;
  const dx = x - (DPAD.x + DPAD.w / 2);
  const dy = y - (DPAD.y + DPAD.h / 2);
  if (Math.abs(dx) < DEAD_W / 2 && Math.abs(dy) < DEAD_H / 2) return null;
  if (Math.abs(dx) / DPAD.w >= Math.abs(dy) / DPAD.h) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/** 눌림 스프라이트는 오른쪽 하나뿐이라 회전해 쓴다 */
const PRESSED_ANGLE: Record<Dir, number> = { right: 0, down: 90, left: 180, up: -90 };

/** 터치 D-패드 + 닻 버튼. 포인터 id → 방향 집합이라 두 손가락 동시(↑+→) 허용 */
export class TouchPad {
  private held = new Map<number, Dir>();
  private anchorPointer: number | null = null;
  private pad: Phaser.GameObjects.Image;
  private anchor: Phaser.GameObjects.Image;
  /** 씬이 UI 전용 카메라(왼쪽 위 기준 줌 k·스크롤 0)에만 그린다 → 월드 카메라 줌·추적과 무관하게 같은 화면 자리·크기 */
  get images() {
    return [this.pad, this.anchor];
  }

  /** k = 캔버스 배수(boot.ts): 포인터 좌표(캔버스 px)를 1280×720 스테이지 좌표로 나눈다 */
  constructor(scene: Phaser.Scene, onAnchor: () => void, private k = 1) {
    if (scene.input.manager.pointersTotal < 3) scene.input.addPointer(1); // 마우스 + 터치 1 + 1 = 터치 2개(재시작마다 늘지 않게)
    const fixed = (img: Phaser.GameObjects.Image, r: Rect) =>
      img.setOrigin(0.5).setPosition(r.x + r.w / 2, r.y + r.h / 2).setDisplaySize(r.w, r.h).setScrollFactor(0).setDepth(10);
    this.pad = fixed(scene.add.image(0, 0, 'dpad'), DPAD);
    this.anchor = fixed(scene.add.image(0, 0, 'anchor-btn'), ANCHOR);

    const press = (p: Phaser.Input.Pointer) => {
      if (inside(ANCHOR, p.x / this.k, p.y / this.k)) {
        this.anchorPointer = p.id;
        this.anchor.setTexture('anchor-btn-pressed');
        return;
      }
      this.track(p);
    };
    const move = (p: Phaser.Input.Pointer) => {
      if (p.isDown && this.anchorPointer !== p.id) this.track(p);
    };
    const release = (p: Phaser.Input.Pointer) => {
      if (this.anchorPointer === p.id) {
        this.anchorPointer = null;
        this.anchor.setTexture('anchor-btn');
        if (inside(ANCHOR, p.x / this.k, p.y / this.k)) onAnchor();
      }
      this.held.delete(p.id);
      this.redraw();
    };
    scene.input.on('pointerdown', press);
    scene.input.on('pointermove', move);
    scene.input.on('pointerup', release);
    scene.input.on('pointerupoutside', release);
  }

  private track(p: Phaser.Input.Pointer) {
    const d = dirAt(p.x / this.k, p.y / this.k);
    if (d) this.held.set(p.id, d);
    else this.held.delete(p.id);
    this.redraw();
  }

  private redraw() {
    const dirs = [...new Set(this.held.values())];
    if (dirs.length === 1) this.pad.setTexture('dpad-pressed').setAngle(PRESSED_ANGLE[dirs[0]]);
    else this.pad.setTexture('dpad').setAngle(0);
    this.pad.setDisplaySize(DPAD.w, DPAD.h);
  }

  keys(): Keys {
    const d = new Set(this.held.values());
    return { up: d.has('up'), down: d.has('down'), left: d.has('left'), right: d.has('right') };
  }

  /** 다이얼로그가 열릴 때: 누르던 손가락을 잊는다(닫힌 뒤 저절로 움직이지 않게) */
  clear() {
    this.held.clear();
    this.anchorPointer = null;
    this.anchor.setTexture('anchor-btn');
    this.redraw();
  }
}
