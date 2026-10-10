import { expect, type Page } from '@playwright/test';
import { GOOD_BY_ID } from '../../src/content/goods';
import { PORT_BY_ID } from '../../src/content/ports';
import type { GoodId, PortId } from '../../src/content/types';
import { startJudgment, type Dir } from '../../src/engine/judgment';
import { createLog } from '../../src/engine/log';
import type { GameState } from '../../src/engine/types';

export const SEED = 42;
export const URL = `/?seed=${SEED}&e2e=1`;

type W = { __ktrade: { sailTo(p: PortId): Promise<void>; dock(): void; state(): GameState }; __sail: Promise<string> };

export const state = (page: Page) => page.evaluate(() => (window as unknown as W).__ktrade.state());
export const logOf = async (page: Page, type: string) => (await state(page)).log.filter((e) => e.type === type);

/** 저장 지우고 타이틀 → 닉네임·번호 → 프롤로그 3화면 → 부산 항구 화면 */
export async function newGame(page: Page): Promise<void> {
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.getByLabel('닉네임').fill('별');
  await page.getByLabel('번호').fill('3');
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

/** e2e 자동 조타로 port 반경까지 → HUD 「입항」. 도중 무전 카드는 답한다. 반환 = 출발~도착 벽시계 ms(카드 응답 포함) */
export async function sail(page: Page, port: PortId): Promise<number> {
  await page.evaluate((p) => {
    const w = window as unknown as W;
    w.__sail = w.__ktrade.sailTo(p).then(() => 'ok', (e: Error) => `err:${e.message}`);
  }, port);
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > 180_000) throw new Error(`sailTo ${port}: 3분 초과`);
    await answerEvent(page);
    const r = await page.evaluate(() => Promise.race([(window as unknown as W).__sail, new Promise((res) => setTimeout(() => res(null), 200))]));
    if (r === 'ok') break;
    if (r) throw new Error(`sailTo ${port}: ${r}`);
  }
  const ms = Date.now() - t0;
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

const row = (page: Page, good: GoodId, which: 'first' | 'last') =>
  page.locator('.port-ui .rows .row').filter({ has: page.locator('.n', { hasText: new RegExp(`^${GOOD_BY_ID[good].nameKo}$`) }) })[which]();

const tradeCount = async (page: Page) => (await state(page)).log.filter((e) => ['trade', 'load', 'buy_home'].includes(e.type)).length;

async function stepAndGo(page: Page, scope: string, qty: number, action: string): Promise<void> {
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
 * 외국 항구: 줄 클릭 → 방향 판정(정답) → 까닭 판정(wrongFirst 면 1차 오답 후 정답) → 수량 → 사기/팔기.
 * 사는 줄은 시세표 앞쪽, 파는 줄은 뒤쪽(싱가포르는 같은 상품이 둘 다 있다).
 */
export async function judgeAndTrade(page: Page, good: GoodId, mode: 'buy' | 'sell', qty: number, wrongFirst = false): Promise<void> {
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
  await stepAndGo(page, '.port-ui .speech', qty, mode === 'buy' ? '사기' : '팔기');
}
