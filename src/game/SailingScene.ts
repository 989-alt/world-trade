import Phaser from 'phaser';
import { PORTS } from '../content/ports';
import type { PortId } from '../content/types';
import { nearestPort } from '../engine/economy';
import { nextEventFor, reduce, type Action } from '../engine/state';
import type { GameState, Result } from '../engine/types';
import { installAutopilot, routeBetween } from './autopilot';
import { setDialogOpen } from './boot';
import { maskFromRGBA, tryMove, withOcean, type Mask } from './collision';
import { TouchPad } from './dpad';
import { enteredZones } from './eventZones';
import { exitPoint, nearestPortWithin } from './ports-layout';
import { HEADINGS, WORLD_H, WORLD_W, dirFromKeys, headingOf, pxDist, spriteKey, stepDelta, type Heading, type Pos } from './ship';

/** 한 판 상태 저장소: dispatch → 순수 리듀서, subscribe → Preact HUD */
type Listener = (s: GameState | null) => void;
let current: GameState | null = null;
const listeners = new Set<Listener>();
export const gameStore = {
  get: () => current,
  set(s: GameState | null) {
    current = s;
    listeners.forEach((f) => f(s));
  },
  dispatch(a: Action): Result {
    const r = reduce(current, a);
    if (!r.reason) gameStore.set(r.state);
    return r;
  },
  subscribe(f: Listener) {
    listeners.add(f);
    return () => void listeners.delete(f);
  },
};
export type GameStore = typeof gameStore;

let active: SailingScene | undefined;

/** 새 판·불러온 판으로 항해 씬을 (다시) 연다. Phaser 는 main.tsx 가 이미 boot 했다 */
export function startSailing(state: GameState): void {
  gameStore.set(state);
  active?.scene.restart();
}
/** 항구 반경 안에서만 입항(Enter·스페이스·닻·「입항」 버튼 공용) */
export const requestDock = () => active?.dock();
/** 다이얼로그(항구·무전)가 닫힐 때 부른다. 항구 반경 안이면 바로 다시 입항되지 않게 반경 밖 바다로 옮긴다 */
export const resumeSailing = () => active?.resumeFromDialog();

const emit = (name: string, detail: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));
const toWorld = (p: Pos) => ({ x: p.x * WORLD_W, y: p.y * WORLD_H });
const token = (name: string) =>
  Phaser.Display.Color.HexStringToColor(getComputedStyle(document.documentElement).getPropertyValue(name).trim()).color;
const SHIP_PX = 64;

export class SailingScene extends Phaser.Scene {
  private mask!: Mask;
  private ship!: Phaser.GameObjects.Image;
  private pad!: TouchPad;
  private keyboard!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;
  private heading: Heading | null = null;
  private towing = false;
  private autopilot: { port: PortId; path: Pos[]; i: number; resolve: () => void; reject: (e: Error) => void } | null = null;

  constructor() {
    super({ key: 'sailing' });
  }

  preload() {
    this.load.image('map', 'assets/img/bg-worldmap.png');
    this.load.image('mask', 'assets/img/mask-worldmap.png');
    for (const h of HEADINGS) this.load.image(spriteKey(h), `assets/img/ship/ship-${h}.png`);
    this.load.image('dpad', 'assets/ui/dpad.png');
    this.load.image('dpad-pressed', 'assets/ui/dpad-right-pressed.png');
    this.load.image('anchor-btn', 'assets/ui/anchor-btn.png');
    this.load.image('anchor-btn-pressed', 'assets/ui/anchor-btn-pressed.png');
  }

  create() {
    active = this;
    this.towing = false;
    this.autopilot = null;
    const s = gameStore.get();
    if (!s) return; // 타이틀 화면 중: 빈 바다

    this.add.image(0, 0, 'map').setOrigin(0).setDisplaySize(WORLD_W, WORLD_H);
    const src = this.textures.get('mask').getSourceImage() as HTMLImageElement;
    const cv = document.createElement('canvas');
    [cv.width, cv.height] = [src.width, src.height];
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(src, 0, 0);
    this.mask = withOcean(maskFromRGBA(cv.width, cv.height, ctx.getImageData(0, 0, cv.width, cv.height).data));

    const pins = this.add.graphics();
    pins.fillStyle(token('--color-accent')).lineStyle(3, token('--color-border'));
    for (const p of PORTS) {
      const w = toWorld(p.mapPos);
      pins.fillCircle(w.x, w.y, 8).strokeCircle(w.x, w.y, 8);
    }

    this.ship = this.add.image(0, 0, spriteKey('e')).setDepth(5);
    this.heading = null;
    this.setHeading('e');
    this.syncShip();
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H).startFollow(this.ship, true, 1, 0.1);
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.tweens.add({ targets: this.ship, angle: { from: -3, to: 3 }, duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }

    // 캡처 끔: 타이틀·대화 입력칸에서 WASD·스페이스 타자가 막히지 않게
    const kb = this.input.keyboard!;
    this.keyboard = kb.addKeys({ up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', w: 'W', a: 'A', s: 'S', d: 'D' }, false) as typeof this.keyboard;
    kb.on('keydown-ENTER', () => this.dock());
    kb.on('keydown-SPACE', () => this.dock());
    this.pad = new TouchPad(this, () => this.dock());

    installAutopilot({
      // 가장 가까운 항구(방금 떠난 곳)의 출항점에서 고정 뱃길을 따라간다
      sailTo: (port) =>
        new Promise((resolve, reject) => {
          const from = nearestPort(gameStore.get()!.shipPos).id;
          this.autopilot = { port, path: routeBetween(from, port), i: 0, resolve, reject };
        }),
      dock: () => this.dock(),
      state: () => gameStore.get(),
    });

    // 항구 안에서 시작·복원(새 판 부산, 입항 중 저장) → 그 항구 화면으로. create 안에서 pause 하면 Phaser 가 RUNNING 으로 덮어써 CREATE 뒤로 미룬다
    const at = s.location;
    if (s.stage === 'main' && at !== 'sea') this.events.once(Phaser.Scenes.Events.CREATE, () => this.openDialog('ktrade:docked', { port: at }));
  }

  update(_t: number, dtMs: number) {
    const s = gameStore.get();
    // !this.mask: 부팅 때 빈 바다로 뜬 인스턴스(startSailing 의 restart 전)는 움직이지 않는다
    if (!s || !this.mask || this.towing || s.stage !== 'main' || s.location !== 'sea' || document.body.classList.contains('ui-open')) return;
    if (s.fuel <= 0) return this.tow();

    let dir: Pos;
    if (this.autopilot) {
      const ap = this.autopilot;
      if (nearestPortWithin(s.shipPos)?.id === ap.port) {
        this.autopilot = null;
        return ap.resolve();
      }
      while (ap.i < ap.path.length && pxDist(s.shipPos, ap.path[ap.i]) < 0.5) ap.i++;
      if (ap.i >= ap.path.length) {
        this.autopilot = null;
        return ap.reject(new Error('route ended outside port'));
      }
      const t = toWorld(ap.path[ap.i]);
      const w = toWorld(s.shipPos);
      const len = Math.hypot(t.x - w.x, t.y - w.y);
      dir = { x: (t.x - w.x) / len, y: (t.y - w.y) / len };
    } else {
      const k = this.keyboard;
      const p = this.pad.keys();
      dir = dirFromKeys({
        up: k.up.isDown || k.w.isDown || p.up,
        down: k.down.isDown || k.s.isDown || p.down,
        left: k.left.isDown || k.a.isDown || p.left,
        right: k.right.isDown || k.d.isDown || p.right,
      });
    }
    const h = headingOf(dir);
    if (!h) return;
    this.setHeading(h);

    const prev = s.shipPos;
    let delta = stepDelta(dir, Math.min(dtMs, 100));
    const ap = this.autopilot;
    if (ap && pxDist(prev, ap.path[ap.i]) <= Math.hypot(delta.x * WORLD_W, delta.y * WORLD_H)) {
      // 웨이포인트에 딱 맞춰 선다(경로 검증과 같은 선분)
      delta = { x: ap.path[ap.i].x - prev.x, y: ap.path[ap.i].y - prev.y };
      ap.i++;
    }
    const next = tryMove(this.mask, prev, delta);
    if (next === prev) {
      if (this.autopilot) {
        this.autopilot.reject(new Error('blocked by land'));
        this.autopilot = null;
      }
      return;
    }
    const r = gameStore.dispatch({ type: 'MOVE_SHIP', dx: next.x - prev.x, dy: next.y - prev.y });
    this.syncShip();
    for (const zone of enteredZones(prev, r.state.shipPos)) {
      const event = nextEventFor(r.state, zone);
      if (event) return this.openDialog('ktrade:event', { event });
    }
    if (r.state.fuel <= 0) this.tow();
  }

  dock() {
    const s = gameStore.get();
    if (!s || this.towing || !this.scene.isActive()) return;
    const port = nearestPortWithin(s.shipPos);
    if (!port || gameStore.dispatch({ type: 'ENTER_PORT', port: port.id }).reason) return;
    this.syncShip();
    this.openDialog('ktrade:docked', { port: port.id });
  }

  resumeFromDialog() {
    const s = gameStore.get();
    if (!s || !this.mask || s.stage !== 'main' || s.location !== 'sea') return;
    const near = nearestPortWithin(s.shipPos);
    if (near) gameStore.set({ ...s, shipPos: exitPoint(near, this.mask) });
    this.syncShip();
    setDialogOpen(false);
    this.scene.resume();
  }

  /** 연료 0: 입력 무시 → 엔진 TOW(가장 가까운 항구·급유만 입항) → 1.5초 예인 → 그 항구 화면 */
  private tow() {
    const r = gameStore.dispatch({ type: 'TOW' });
    if (r.reason) return;
    this.towing = true;
    this.pad.clear();
    this.tweens.add({
      targets: this.ship,
      ...toWorld(r.state.shipPos),
      duration: 1500,
      ease: 'Sine.inOut',
      onComplete: () => {
        this.towing = false;
        this.openDialog('ktrade:docked', { port: r.state.location });
      },
    });
  }

  private openDialog(name: string, detail: unknown) {
    this.pad.clear();
    setDialogOpen(true);
    this.scene.pause();
    emit(name, detail);
  }

  private setHeading(h: Heading) {
    if (h === this.heading) return;
    this.heading = h;
    this.ship.setTexture(spriteKey(h));
    const f = this.ship.frame;
    this.ship.setScale(SHIP_PX / Math.max(f.width, f.height));
  }

  private syncShip() {
    const s = gameStore.get();
    if (s) this.ship.setPosition(toWorld(s.shipPos).x, toWorld(s.shipPos).y);
  }
}
