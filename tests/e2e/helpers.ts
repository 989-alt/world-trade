import { expect, type Page } from '@playwright/test';
import { GOOD_BY_ID } from '../../src/content/goods';
import { PORT_BY_ID } from '../../src/content/ports';
import type { GoodId, PortId } from '../../src/content/types';
import { startJudgment, type Dir } from '../../src/engine/judgment';
import { createLog } from '../../src/engine/log';
import type { GameState } from '../../src/engine/types';

export const SEED = 42;
export const URL = `/?seed=${SEED}&e2e=1`;

type Box = { x: number; y: number; w: number; h: number };
/** 배 그림(중심·표시 크기)과 월드 카메라가 보는 사각형(worldView, 월드 좌표)·줌(CSS px 당)·캔버스 배수 k */
export type View = { ship: Box; cam: Box & { zoom: number; k: number } };
type W = { __ktrade: { sailTo(p: PortId): Promise<void>; dock(): void; state(): GameState; view(): View }; __sail: Promise<string> };

export const state = (page: Page) => page.evaluate(() => (window as unknown as W).__ktrade.state());
export const view = (page: Page) => page.evaluate(() => (window as unknown as W).__ktrade.view());
export const logOf = async (page: Page, type: string) => (await state(page)).log.filter((e) => e.type === type);

/** 저장 지우고 타이틀 → 닉네임·번호 → 프롤로그 3화면 → 부산 항구 화면 */
export async function newGame(page: Page, shots?: string): Promise<void> {
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  const start = page.getByRole('button', { name: '시작' });
  await expect(start).toBeDisabled();
  await page.getByLabel('닉네임').selectOption('고래');
  await expect(start).toBeDisabled();
  await page.getByLabel('번호').selectOption('3');
  if (shots) await page.screenshot({ path: `${shots}c5-title.png` });
  await page.getByRole('button', { name: '시작' }).click();
  await page.getByRole('button', { name: '비단을 산다' }).click();
  await page.getByRole('button', { name: '다음' }).click();
  await page.locator('.pg-btn').first().click();
  await page.getByRole('button', { name: '다음' }).click();
  await page.getByRole('button', { name: '출항' }).click();
  await expect(page.locator('.port-ui .ribbon.name')).toHaveText('부산');
}

/** 무전 카드가 떠 있으면 첫 선택지 → 계속 */
export async function answerEvent(page: Page): Promise<boolean> {
  const card = page.locator('.ev-card');
  if (!(await card.isVisible())) return false;
  await card.locator('.ev-opt').first().click();
  await card.locator('.ev-go').click();
  await expect(card).toBeHidden();
  return true;
}

/**
 * e2e 자동 조타로 port 반경까지 → HUD 「입항」. 도중 무전 카드는 답한다. 반환 = 출발~도착 벽시계 ms(카드 응답 포함).
 * during: 출발 직후 한 번(측정용), arrived: 반경에 닿아 배가 멈춘 뒤 입항 전에 한 번
 */
export async function sail(page: Page, port: PortId, hooks: { during?: () => Promise<void>; arrived?: () => Promise<void> } = {}): Promise<number> {
  await page.evaluate((p) => {
    const w = window as unknown as W;
    w.__sail = w.__ktrade.sailTo(p).then(() => 'ok', (e: Error) => `err:${e.message}`);
  }, port);
  const t0 = Date.now();
  await hooks.during?.();
  for (;;) {
    if (Date.now() - t0 > 180_000) throw new Error(`sailTo ${port}: 3분 초과`);
    await answerEvent(page);
    const r = await page.evaluate(() => Promise.race([(window as unknown as W).__sail, new Promise((res) => setTimeout(() => res(null), 200))]));
    if (r === 'ok') break;
    if (r) throw new Error(`sailTo ${port}: ${r}`);
  }
  const ms = Date.now() - t0;
  await hooks.arrived?.();
  await page.locator('.sail-ui .prompt .btn').click();
  // 밀린 필수 카드가 있으면 입항 직전에 뜬다(F1) → 답하면 바로 입항
  const ribbon = page.locator('.port-ui .ribbon.name');
  for (const t1 = Date.now(); !(await ribbon.isVisible()); ) {
    if (Date.now() - t1 > 10_000) throw new Error(`dock ${port}: 항구 화면이 안 열림`);
    if (!(await answerEvent(page))) await page.waitForTimeout(100);
  }
  await expect(ribbon).toHaveText(PORT_BY_ID[port].nameKo);
  return ms;
}

export async function leave(page: Page): Promise<void> {
  await page.locator('.port-ui .acts .btn.orange').click();
}

export const row = (page: Page, good: GoodId, which: 'first' | 'last') =>
  page.locator('.port-ui .rows .row').filter({ has: page.locator('.n', { hasText: new RegExp(`^${GOOD_BY_ID[good].nameKo}$`) }) })[which]();

const tradeCount = async (page: Page) => (await state(page)).log.filter((e) => ['trade', 'load', 'buy_home'].includes(e.type)).length;

export async function stepAndGo(page: Page, scope: string, qty: number, action: string): Promise<void> {
  const box = page.locator(scope);
  for (let i = 1; i < qty; i++) await box.getByRole('button', { name: '늘리기' }).click();
  await expect(box.locator('.stepper b')).toHaveText(String(qty));
  const before = await tradeCount(page);
  await box.getByRole('button', { name: action, exact: true }).click();
  await expect.poll(() => tradeCount(page)).toBeGreaterThan(before);
}

/** 부산(판정 없음): 창고 싣기(같은 이름 줄 중 앞) 또는 특산 사기(뒤) */
export async function homeTrade(page: Page, good: GoodId, mode: 'load' | 'buy', qty: number): Promise<void> {
  await row(page, good, mode === 'load' ? 'first' : 'last').click();
  await stepAndGo(page, '.port-ui .home-trade', qty, mode === 'load' ? '싣기' : '사기');
}

/** 판정의 정답·오답 선택지 글자 — 엔진 startJudgment 로 계산(하드코딩 안 함) */
export function causeChoices(port: PortId, good: GoodId, dir: Dir): { right: string; wrong: string } {
  const j = startJudgment({ port, good, dir, shuffle: (xs) => [...xs], log: createLog() });
  if (!j.ok) throw new Error(`판정 불가: ${port} ${good} ${dir} ${j.reason}`);
  const { options, correctCauses } = j.session;
  return {
    right: options.find((o) => correctCauses.includes(o.axis))!.label,
    wrong: options.find((o) => !correctCauses.includes(o.axis))!.label,
  };
}

/**
 * 외국 항구: 줄 클릭 → 방향 판정(정답) → 까닭 판정(wrongFirst 면 1차 오답 후 정답).
 * 사는 줄은 시세표 앞쪽, 파는 줄은 뒤쪽(싱가포르는 같은 상품이 둘 다 있다).
 */
export async function judge(page: Page, good: GoodId, mode: 'buy' | 'sell', wrongFirst = false): Promise<void> {
  const port = (await state(page)).location as PortId;
  const dir: Dir = mode === 'buy' ? 'import' : 'export';
  await row(page, good, mode === 'buy' ? 'first' : 'last').click();
  const dlg = page.locator('.port-ui .speech');
  await dlg.getByRole('button', { name: dir === 'import' ? '수입' : '수출', exact: true }).click();
  const c = causeChoices(port, good, dir);
  if (wrongFirst) {
    await dlg.getByRole('button', { name: c.wrong, exact: true }).click();
    await expect(dlg.locator('.fb')).toBeVisible(); // 교과서 문장 피드백
    await expect(dlg.getByRole('button', { name: c.wrong, exact: true })).toBeDisabled();
  }
  await dlg.getByRole('button', { name: c.right, exact: true }).click();
}

/** judge → 수량 → 사기/팔기 */
export async function judgeAndTrade(page: Page, good: GoodId, mode: 'buy' | 'sell', qty: number, wrongFirst = false): Promise<void> {
  await judge(page, good, mode, wrongFirst);
  await stepAndGo(page, '.port-ui .speech', qty, mode === 'buy' ? '사기' : '팔기');
}

/* ── T14 항해 연출 측정: 캔버스 스크린샷 + 지도·마스크·UI 그림을 페이지 안 캔버스로 읽어 비교 ── */

/** 캔버스만 찍는다(DOM HUD·카드는 잠깐 숨김). PNG 는 측정용, JPEG 은 저장용 */
export async function canvasShot(page: Page, opts: { path?: string; jpeg?: boolean } = {}): Promise<Buffer> {
  await page.evaluate(() => void (document.getElementById('ui')!.style.visibility = 'hidden'));
  const buf = await page.locator('#game canvas').screenshot(opts.jpeg ? { type: 'jpeg', quality: 70, path: opts.path } : { path: opts.path });
  await page.evaluate(() => void (document.getElementById('ui')!.style.visibility = ''));
  return buf;
}

type Px = { w: number; h: number; d: Uint8ClampedArray };
type PxWin = { __px: (src: string, w?: number, h?: number) => Promise<Px> };
/** 페이지 안에 window.__px(그림 URL·data URL → w×h 캔버스 RGBA, URL 은 캐시)를 둔다. CSP 가 eval 을 막아 함수로 심는다 */
const probe = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as Partial<PxWin> & { __pxCache?: Map<string, Promise<Px>> };
    if (w.__px) return;
    const cache = (w.__pxCache = new Map());
    w.__px = (src, wd, ht) => {
      const key = src.startsWith('data:') ? null : `${src}@${wd}x${ht}`;
      if (key && cache.has(key)) return cache.get(key)!;
      const job = (async () => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const cv = document.createElement('canvas');
        cv.width = wd ?? img.naturalWidth;
        cv.height = ht ?? img.naturalHeight;
        const ctx = cv.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        return { w: cv.width, h: cv.height, d: ctx.getImageData(0, 0, cv.width, cv.height).data };
      })();
      if (key) cache.set(key, job);
      return job;
    };
  });

/**
 * V2: 화면 네 모서리 픽셀을 카메라(worldView·줌)로 월드에 되돌려 — 지도 안(0..3072×2048)인지, 스크린샷 색이 그 자리 지도 색과 같은지.
 * 색은 카메라 한두 프레임 어긋남을 봐 ±2 월드px 안 최소 차(RGB 절댓값 합)로 잰다
 */
export async function cornersOnMap(page: Page, shot: Buffer, v: View) {
  await probe(page);
  return page.evaluate(
    async ({ b64, v }) => {
      const px = (window as unknown as PxWin).__px;
      const s = await px(`data:image/png;base64,${b64}`);
      const map = await px('assets/img/bg-worldmap.png');
      const k = s.w / 1280; // 캔버스 CSS 크기 = 게임 1280×720
      return [[0, 0], [1279, 0], [0, 719], [1279, 719]].map(([sx, sy]) => {
        const wx = v.cam.x + (sx + 0.5) / v.cam.zoom;
        const wy = v.cam.y + (sy + 0.5) / v.cam.zoom;
        const i = (Math.floor(sy * k) * s.w + Math.floor(sx * k)) * 4;
        const shotRgb = [s.d[i], s.d[i + 1], s.d[i + 2]];
        let diff = Infinity;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const mx = Math.min(map.w - 1, Math.max(0, Math.floor(wx) + dx));
            const my = Math.min(map.h - 1, Math.max(0, Math.floor(wy) + dy));
            const j = (my * map.w + mx) * 4;
            diff = Math.min(diff, Math.abs(map.d[j] - shotRgb[0]) + Math.abs(map.d[j + 1] - shotRgb[1]) + Math.abs(map.d[j + 2] - shotRgb[2]));
          }
        return { screen: [sx, sy], world: [+wx.toFixed(1), +wy.toFixed(1)], inMap: wx >= 0 && wy >= 0 && wx < map.w && wy < map.h, map: [map.w, map.h], shotRgb, diff };
      });
    },
    { b64: shot.toString('base64'), v },
  );
}

/**
 * V8: 화면 고정 UI 그림(D-패드·닻)을 스크린샷에서 찾는다 — 기대 자리(rect) 둘레 ±4px·크기 ±4% 후보마다 그림을 그 크기로 그려
 * 불투명 픽셀의 평균 색 차를 재고 가장 잘 맞는 자리의 중심·반지름(가로·세로 반)을 돌려준다
 */
export async function findSprite(page: Page, shot: Buffer, src: string, rect: Box) {
  await probe(page);
  return page.evaluate(
    async ({ b64, src, rect }) => {
      const px = (window as unknown as PxWin).__px;
      const s = await px(`data:image/png;base64,${b64}`);
      const k = s.w / 1280;
      let best = { err: Infinity, cx: 0, cy: 0, rx: 0, ry: 0 };
      for (const scale of [0.96, 0.98, 1, 1.02, 1.04]) {
        const w = Math.round(rect.w * scale);
        const h = Math.round(rect.h * scale);
        const t = await px(src, w, h);
        for (let oy = -4; oy <= 4; oy++)
          for (let ox = -4; ox <= 4; ox++) {
            const x0 = Math.round(rect.x + (rect.w - w) / 2) + ox;
            const y0 = Math.round(rect.y + (rect.h - h) / 2) + oy;
            let sum = 0;
            let n = 0;
            for (let y = 0; y < h; y += 2)
              for (let x = 0; x < w; x += 2) {
                const j = (y * w + x) * 4;
                if (t.d[j + 3] < 255) continue;
                const i = (Math.floor((y0 + y) * k) * s.w + Math.floor((x0 + x) * k)) * 4;
                sum += Math.abs(t.d[j] - s.d[i]) + Math.abs(t.d[j + 1] - s.d[i + 1]) + Math.abs(t.d[j + 2] - s.d[i + 2]);
                n++;
              }
            const err = sum / n;
            if (err < best.err) best = { err: +err.toFixed(2), cx: x0 + w / 2, cy: y0 + h / 2, rx: w / 2, ry: h / 2 };
          }
      }
      return best;
    },
    { b64: shot.toString('base64'), src, rect },
  );
}

/**
 * V12·M12: 배 그림의 화면 바운딩 박스(월드 중심·크기를 카메라로 투영)를 다시 월드로 되돌려 시각 육지 마스크(mask-visual.png, 부풀리지 않은 육지, 흰색)
 * 픽셀 비율을 잰다. 항해 마스크(6px 부풀림)는 충돌용이라 쓰지 않는다
 */
export async function shipLandFraction(page: Page, v: View) {
  await probe(page);
  return page.evaluate(
    async ({ v }) => {
      const m = await (window as unknown as PxWin).__px('assets/img/mask-visual.png');
      const z = v.cam.zoom;
      const box = {
        x0: (v.ship.x - v.ship.w / 2 - v.cam.x) * z,
        y0: (v.ship.y - v.ship.h / 2 - v.cam.y) * z,
        x1: (v.ship.x + v.ship.w / 2 - v.cam.x) * z,
        y1: (v.ship.y + v.ship.h / 2 - v.cam.y) * z,
      };
      let n = 0;
      let land = 0;
      for (let sy = Math.floor(box.y0); sy < box.y1; sy++)
        for (let sx = Math.floor(box.x0); sx < box.x1; sx++) {
          const wx = Math.floor(v.cam.x + (sx + 0.5) / z);
          const wy = Math.floor(v.cam.y + (sy + 0.5) / z);
          n++;
          if (m.d[(wy * m.w + wx) * 4] > 127) land++;
        }
      return { frac: land / n, screenBox: Object.values(box).map((q) => +q.toFixed(1)) };
    },
    { v },
  );
}

/** 월드 좌표 한 점이 마스크 육지인가(V6 예인 경로 표본) */
export async function landAt(page: Page, pts: { x: number; y: number }[]): Promise<boolean[]> {
  await probe(page);
  return page.evaluate(
    async ({ pts }) => {
      const m = await (window as unknown as PxWin).__px('assets/img/mask-worldmap.png');
      return pts.map((p) => m.d[(Math.floor(p.y) * m.w + Math.floor(p.x)) * 4] > 127);
    },
    { pts },
  );
}
