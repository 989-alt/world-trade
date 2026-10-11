import Phaser from 'phaser';
import { PORTS } from '../content/ports';
import type { PortId } from '../content/types';
import { nearestPort } from '../engine/economy';
import { saveGame } from '../engine/save';
import { nextEventFor, reduce, requiredEventNow, type Action } from '../engine/state';
import type { GameState, Result } from '../engine/types';
import { installAutopilot, routeBetween, towPath } from './autopilot';
import { K, setDialogOpen } from './boot';
import { maskFromRGBA, tryMove, withOcean, type Mask } from './collision';
import { TouchPad } from './dpad';
import { enteredZones } from './eventZones';
import { nearestPortWithin, posAfterDialog } from './ports-layout';
import { HEADINGS, WORLD_H, WORLD_W, angleOf, dirFromKeys, helmStep, spriteFor, spriteKey, steer, type Helm, type Pos } from './ship';

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
/** 무전 카드·일지 중 열린 창이 있다(app.tsx 가 알린다) — 그동안은 항해를 재개하지 않는다(§4.7) */
let windowOpen = false;
export const setWindowOpen = (open: boolean) => { windowOpen = open; };
/** 무전 카드·일지가 닫힐 때: 배는 제자리에서 다시 움직인다 */
export const resumeSailing = () => { if (!windowOpen) active?.resumeFromDialog(false); };
/** 항구에서 출항할 때: 바로 다시 입항되지 않게 반경 밖 출항점으로 옮긴 뒤 재개 */
export const departPort = () => { if (!windowOpen) active?.resumeFromDialog(true); };

const emit = (name: string, detail: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));
const toWorld = (p: Pos) => ({ x: p.x * WORLD_W, y: p.y * WORLD_H });
const token = (name: string) =>
  Phaser.Display.Color.HexStringToColor(getComputedStyle(document.documentElement).getPropertyValue(name).trim()).color;
/** 배 선체 길이(월드px) = 옆모습(ship-e) 그림 너비. 8방위 그림은 크기가 제각각이라 모두 같은 배율로 줄인다 — 선체 충돌은 collision.ts HULL_PX(±22) */
const SHIP_PX = 56;
/** 월드 카메라 줌(CSS px 기준): 화면 1280×720 에 월드 1280×720(지도의 42%)이 보인다. 실제 줌 = ZOOM × k(boot.ts, 캔버스 dpr 배수) */
const ZOOM = 1.0;

export class SailingScene extends Phaser.Scene {
  private mask!: Mask;
  private ship!: Phaser.GameObjects.Image;
  private pad!: TouchPad;
  private keyboard!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;
  /** 조타 상태(헤딩 각·속도) — ship.ts helmStep */
  private helm: Helm = { angle: 0, speed: 0 };
  /** 흔들림 각(도) */
  private bob = { a: 0 };
  private towing = false;
  /** 이번 출항의 출항점(필수 카드 거리 트리거 기준) */
  private legStart: Pos = { x: 0, y: 0 };
  /** 입항 직전 밀린 필수 카드를 띄웠다 → 카드를 닫으면 입항 */
  private dockAfterCard = false;
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
    this.legStart = { ...s.shipPos };
    this.dockAfterCard = false;

    const map = this.add.image(0, 0, 'map').setOrigin(0); // 원본 3072×2048 = 월드 크기
    const src = this.textures.get('mask').getSourceImage() as HTMLImageElement;
    const cv = document.createElement('canvas');
    [cv.width, cv.height] = [src.width, src.height];
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(src, 0, 0);
    this.mask = withOcean(maskFromRGBA(cv.width, cv.height, ctx.getImageData(0, 0, cv.width, cv.height).data));

    // 핀: 화면에서 T14(반지름 8 × 줌 1.6)와 같은 크기
    const pins = this.add.graphics();
    pins.fillStyle(token('--color-accent')).lineStyle(5, token('--color-border'));
    for (const p of PORTS) {
      const w = toWorld(p.mapPos);
      pins.fillCircle(w.x, w.y, 13).strokeCircle(w.x, w.y, 13);
    }

    this.ship = this.add.image(0, 0, spriteKey('e')).setDepth(5);
    this.ship.setScale(SHIP_PX / (this.textures.get(spriteKey('e')).getSourceImage() as HTMLImageElement).width);
    this.helm = { angle: 0, speed: 0 };
    this.bob = { a: 0 };
    this.drawShip();
    this.syncShip();
    // 경계 안에서만 보므로 지도 가장자리에서도 바탕색이 드러나지 않는다. roundPixels 끔 + 같은 lerp 로 주춤거림 없이 따라간다
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H).setZoom(ZOOM * K).startFollow(this.ship, false, 0.08, 0.08);
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // 흔들림 ±1.5°, 한 주기 2초 — 헤딩 잔여 회전에 더한다(drawShip)
      this.tweens.add({ targets: this.bob, a: { from: -1.5, to: 1.5 }, duration: 1000, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }

    // 캡처 끔: 타이틀·대화 입력칸에서 WASD·스페이스 타자가 막히지 않게
    const kb = this.input.keyboard!;
    this.keyboard = kb.addKeys({ up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', w: 'W', a: 'A', s: 'S', d: 'D' }, false) as typeof this.keyboard;
    kb.on('keydown-ENTER', () => this.dock());
    kb.on('keydown-SPACE', () => this.dock());
    this.pad = new TouchPad(this, () => this.dock(), K);
    // 화면 고정 UI 는 UI 카메라(왼쪽 위 기준 줌 k = 1280×720 좌표)에만, 지도·핀·배는 월드 카메라에만 그린다
    this.cameras.add(0, 0, this.scale.width, this.scale.height).setOrigin(0).setZoom(K).ignore([map, pins, this.ship]);
    this.cameras.main.ignore(this.pad.images);

    installAutopilot({
      // 방금 떠난 항구(마지막 depart 로그)의 출항점에서 고정 뱃길을 따라간다. 부산 출항점은 일본 핀이 더 가까워 거리로 고르면 안 된다
      sailTo: (port) =>
        new Promise((resolve, reject) => {
          const s = gameStore.get()!;
          const dep = [...s.log].reverse().find((e) => e.type === 'depart');
          const from = dep?.type === 'depart' ? dep.port : nearestPort(s.shipPos).id;
          this.autopilot = { port, path: routeBetween(from, port), i: 0, resolve, reject };
        }),
      dock: () => this.dock(),
      state: () => gameStore.get(),
      view: () => {
        const v = this.cameras.main.worldView;
        return {
          ship: { x: this.ship.x, y: this.ship.y, w: this.ship.displayWidth, h: this.ship.displayHeight },
          cam: { x: v.x, y: v.y, w: v.width, h: v.height, zoom: this.cameras.main.zoom / K, k: K },
        };
      },
    });

    // 항구 안에서 시작·복원(새 판 부산, 입항 중 저장) → 그 항구 화면으로. create 안에서 pause 하면 Phaser 가 RUNNING 으로 덮어써 CREATE 뒤로 미룬다
    const at = s.location;
    if (s.stage === 'main' && at !== 'sea') this.events.once(Phaser.Scenes.Events.CREATE, () => this.openDialog('ktrade:docked', { port: at }));
  }

  update(_t: number, dtMs: number) {
    const s = gameStore.get();
    // !this.mask: 부팅 때 빈 바다로 뜬 인스턴스(startSailing 의 restart 전)는 움직이지 않는다
    if (!s || !this.mask || this.towing || s.stage !== 'main' || s.location !== 'sea' || document.body.classList.contains('ui-open')) return;
    if (this.dockAfterCard) {
      // 입항 직전 카드를 닫았다 → 씬이 다시 돈 첫 프레임에 입항(resume 은 다음 프레임에 적용돼 닫는 순간엔 못 한다)
      this.dockAfterCard = false;
      return this.dock();
    }
    if (s.fuel <= 0) return this.tow();

    // 목표 헤딩: 자동 조타 = 다음 웨이포인트(4px 안이면 넘김), 손 조타 = 키·D-패드(없으면 null → 감속)
    let target: number | null;
    const ap = this.autopilot;
    if (ap) {
      if (nearestPortWithin(s.shipPos)?.id === ap.port) {
        this.autopilot = null;
        this.helm.speed = 0; // 반경에 들면 선다(입항 프롬프트 자리를 벗어나지 않게)
        return ap.resolve();
      }
      const st = steer(s.shipPos, ap.path, ap.i);
      ap.i = st.i;
      if (st.target === null) {
        this.autopilot = null;
        return ap.reject(new Error('route ended outside port'));
      }
      target = st.target;
    } else {
      const k = this.keyboard;
      const p = this.pad.keys();
      target = angleOf(
        dirFromKeys({
          up: k.up.isDown || k.w.isDown || p.up,
          down: k.down.isDown || k.s.isDown || p.down,
          left: k.left.isDown || k.a.isDown || p.left,
          right: k.right.isDown || k.d.isDown || p.right,
        }),
      );
    }
    const { helm, move } = helmStep(this.helm, target, Math.min(dtMs, 100));
    this.helm = helm;
    this.drawShip();
    if (move.x === 0 && move.y === 0) return;

    const prev = s.shipPos;
    const next = tryMove(this.mask, prev, move);
    if (next === prev) {
      this.helm.speed = 0;
      // 자동 조타: 아직 도는 중이면 계속 돌고(선수가 비스듬히 걸린 것), 목표 쪽을 다 보고도 막히면 실패
      if (this.autopilot && target === this.helm.angle) {
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
    const due = requiredEventNow(r.state, this.legStart, false);
    if (due) return this.openDialog('ktrade:event', { event: due });
    if (r.state.fuel <= 0) this.tow();
  }

  dock() {
    const s = gameStore.get();
    if (!s || this.towing || !this.scene.isActive()) return;
    const port = nearestPortWithin(s.shipPos);
    if (!port) return;
    const due = requiredEventNow(s, this.legStart, true);
    if (due) {
      this.dockAfterCard = true;
      return this.openDialog('ktrade:event', { event: due });
    }
    if (gameStore.dispatch({ type: 'ENTER_PORT', port: port.id }).reason) return;
    this.syncShip();
    this.openDialog('ktrade:docked', { port: port.id });
  }

  resumeFromDialog(depart: boolean) {
    const s = gameStore.get();
    if (!s || !this.mask || s.stage !== 'main' || s.location !== 'sea') return;
    const pos = posAfterDialog(s.shipPos, this.mask, depart);
    this.helm.speed = 0; // 대화창이 열리면 배는 멈춘다(PRD §4.7) — 닫힌 뒤 다시 가속
    if (pos !== s.shipPos) gameStore.set({ ...s, shipPos: pos });
    if (depart) {
      this.legStart = { ...pos };
      saveGame(gameStore.get()!); // 출항점 이동은 로그가 없어 자동 저장이 못 본다 — 새로 고침해도 반경 밖에서 이어지게
    }
    this.syncShip();
    setDialogOpen(false);
    this.scene.resume();
  }

  /** 연료 0: 입력 무시 → 엔진 TOW(가장 가까운 항구·급유만 입항) → 뱃길을 따라 1.5~3초 등속 예인 → 그 항구 화면. 길이 없으면 경고하고 제자리에서 항구 화면 */
  private tow() {
    const at = gameStore.get()!.shipPos;
    const due = requiredEventNow(gameStore.get()!, this.legStart, true);
    if (due) return this.openDialog('ktrade:event', { event: due }); // 카드를 닫으면 update 가 다시 tow
    const r = gameStore.dispatch({ type: 'TOW' });
    if (r.reason) return;
    this.towing = true;
    this.pad.clear();
    this.autopilot?.reject(new Error(`towed to ${r.state.location}`)); // e2e 자동 조타가 끝없이 기다리지 않게
    this.autopilot = null;
    // 직선으로 대륙을 건너지 않게 바다 뱃길(지금 위치 → 곧장 닿는 뱃길 점(없으면 4px 격자 BFS) → 예인 항구 반경)을 따라간다
    const found = towPath(at, r.state.location as PortId, this.mask);
    if (!found) console.warn(`[tow] no sea path from (${at.x.toFixed(4)}, ${at.y.toFixed(4)}) to ${r.state.location} — ship stays`);
    const path = (found ?? [at]).map(toWorld);
    const seg = path.slice(1).map((p, i) => Math.hypot(p.x - path[i].x, p.y - path[i].y));
    const total = seg.reduce((a, b) => a + b, 0);
    this.tweens.addCounter({
      from: 0,
      to: total,
      duration: Phaser.Math.Clamp(total * 2, 1500, 3000), // 500 월드px/초, 1.5~3초 안으로
      onUpdate: (tw) => {
        if (!seg.length) return;
        let d = tw.getValue() ?? 0;
        let i = 0;
        while (i < seg.length - 1 && d > seg[i]) d -= seg[i++];
        const [a, b] = [path[i], path[i + 1]];
        const k = seg[i] ? Math.min(1, d / seg[i]) : 1;
        this.ship.setPosition(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
        this.helm.angle = angleOf({ x: b.x - a.x, y: b.y - a.y }) ?? this.helm.angle;
        this.drawShip();
      },
      onComplete: () => {
        this.towing = false;
        this.helm.speed = 0;
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

  /** 헤딩 각 → 가장 가까운 8방위 그림 + 남는 각(±22.5°) 회전 + 흔들림 */
  private drawShip() {
    const { heading, residualDeg } = spriteFor(this.helm.angle);
    if (this.ship.texture.key !== spriteKey(heading)) this.ship.setTexture(spriteKey(heading));
    this.ship.setAngle(residualDeg + this.bob.a);
  }

  private syncShip() {
    const s = gameStore.get();
    if (s) this.ship.setPosition(toWorld(s.shipPos).x, toWorld(s.shipPos).y);
  }
}
