import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Download, type Page } from '@playwright/test';
import { EVENTS } from '../../src/content/events';
import { PORT_BY_ID } from '../../src/content/ports';
import type { PortId } from '../../src/content/types';
import {
  URL as GAME_URL, answerEvent, canvasShot, cornersOnMap, findSprite, homeTrade, judge, judgeAndTrade, landAt, leave, logOf, newGame, row, sail,
  shipLandFraction, state, stepAndGo, view,
} from './helpers';

const RESULT_PATH = fileURLToPath(new URL('./fixtures/last-result.json', import.meta.url));
const SHOTS = fileURLToPath(new URL('./fixtures/shots/', import.meta.url));

/**
 * V2·M2: 카메라 줌 1.0(CSS px 당, 뷰 1280×720 월드px), worldView 가 지도(0..3072×2048) 안, 화면 네 모서리 색 = 그 자리 지도 색(바탕색 노출 없음).
 * M12: 같은 자리에서 배 그림 상자 안 시각 육지 ≤ 5%. 증거 사진은 fixtures/shots
 */
async function expectCornersOnMap(page: Page, name: string) {
  await page.waitForTimeout(1500); // 배가 멈춘 뒤 카메라 lerp(0.08)가 따라붙을 시간
  await canvasShot(page, { path: `${SHOTS}v2-${name}.jpg`, jpeg: true });
  const shot = await canvasShot(page);
  const v = await view(page);
  const corners = await cornersOnMap(page, shot, v);
  const land = await shipLandFraction(page, v);
  console.log(JSON.stringify({ v2: name, cam: v.cam, corners: corners.map((c) => [c.world, c.diff]), m12: { frac: +land.frac.toFixed(4), ship: v.ship } }));
  expect(v.cam.zoom).toBe(1);
  expect(corners[0].map).toEqual([3072, 2048]); // M1 지도 = 월드
  expect(v.cam.w).toBeCloseTo(1280, 6);
  expect(v.cam.h).toBeCloseTo(720, 6);
  expect(v.cam.x).toBeGreaterThanOrEqual(0);
  expect(v.cam.y).toBeGreaterThanOrEqual(0);
  expect(v.cam.x + v.cam.w).toBeLessThanOrEqual(3072 + 1e-6);
  expect(v.cam.y + v.cam.h).toBeLessThanOrEqual(2048 + 1e-6);
  for (const c of corners) {
    expect(c.inMap, `${name} ${c.screen}`).toBe(true);
    expect(c.diff, `${name} ${c.screen} ${c.shotRgb}`).toBeLessThanOrEqual(40);
  }
  if (name !== 'busan') expect(land.frac, `${name} 배 아래 시각 육지`).toBeLessThanOrEqual(0.05); // 부산은 출항 직후(항구 안)
  return v;
}

/**
 * V8·M10 화면 고정 UI: T14 이전(HEAD c95e357, 줌 1·scrollFactor 0)에서 같은 findSprite 로 잰 값 — dpr 1·2 모두 이 자리·크기(±1.5px).
 * D-패드 176×184 우28·하24, 닻 120×120 우224·하40 (dpad.ts DPAD·ANCHOR — 그 모듈은 Phaser 를 끌어와 node 에서 못 읽는다)
 */
const FIXED_UI = [
  { src: 'assets/ui/dpad.png', rect: { x: 1076, y: 512, w: 176, h: 184 }, before: { cx: 1164, cy: 604, rx: 88, ry: 92 } },
  { src: 'assets/ui/anchor-btn.png', rect: { x: 936, y: 560, w: 120, h: 120 }, before: { cx: 996, cy: 620, rx: 60, ry: 60 } },
];
async function expectFixedUi(page: Page, name: string) {
  const shot = await canvasShot(page);
  for (const { src, rect, before } of FIXED_UI) {
    const got = await findSprite(page, shot, src, rect);
    console.log(JSON.stringify({ v8: name, src, before, after: got }));
    for (const k of ['cx', 'cy', 'rx', 'ry'] as const) expect(Math.abs(got[k] - before[k]), `${name} ${src} ${k}`).toBeLessThanOrEqual(1.5);
  }
}
const SAIL_BUDGET_MS = 4 * 60_000; // S8 항해 누적 ≤ 4분
const MAX_SCREENS = 35; // S8
const MAX_JUDGE_DIALOGS = 14; // S8
const M2_TIP = '우리나라는 원유를 전량 수입합니다'; // PortPanel.M2_TIP (그 모듈은 Phaser 를 끌어와 node 에서 못 읽는다)

type Run = { logLength: number; grade: string; ledger: unknown[] };
const runs: Run[] = [];

/**
 * seed 42 한 판. 입항 6회: 베트남 → 사우디 → 싱가포르(새로 고침) → 부산 → 일본 → 싱가포르 → 에필로그 → 내보내기.
 * 1·2턴은 까닭 1차 오답 후 정답(attempt 2). 판정 다이얼로그 11회, 일지 12행(베트남산 사우디 판매·싱가포르 중계 = 한국 미포함).
 */
async function playthrough(page: Page): Promise<Run> {
  const sailMs: Partial<Record<string, number>> = {};
  const go = async (turn: number, port: PortId) => (sailMs[`${turn}-${port}`] = await sail(page, port));

  await newGame(page, SHOTS);
  expect((await state(page)).profile).toEqual({ nickname: '고래', seat: '3' });

  // 부산(출발 전): M2 잠금 줄 — 비활성, 눌러도 툴팁만, export_attempt_blocked 0 (T10 판정: 클릭은 아무것도 dispatch 하지 않는다)
  const off = page.locator('.port-ui .row.off');
  await expect(off).toHaveCount(4);
  for (const r of await off.all()) {
    await expect(r).toHaveAttribute('aria-disabled', 'true');
    await expect(r).toBeDisabled();
    await r.click({ force: true });
    await expect(page.locator('.port-ui .home-trade .warn')).toHaveText(M2_TIP);
  }
  expect(await logOf(page, 'export_attempt_blocked')).toHaveLength(0);

  await homeTrade(page, 'semiconductor', 'load', 2);
  await homeTrade(page, 'phone', 'buy', 2);
  await leave(page);

  // 1 베트남: 반도체 수출(까닭 1차 오답), 무선 통신 기기 수입
  await go(1, 'vietnam');
  await judgeAndTrade(page, 'semiconductor', 'sell', 2, true);
  await judgeAndTrade(page, 'phone', 'buy', 2);
  await leave(page);

  // 2 사우디: 연료 게이지 감소 → 급유 100 내외. 무선 통신 기기 수출(까닭 1차 오답, 부산산=수출·베트남산=중계), 원유·천연가스 수입
  const fuelBefore = (await state(page)).fuel;
  await go(2, 'saudi');
  const atSaudi = await state(page);
  expect(atSaudi.fuel).toBeLessThan(fuelBefore);
  await expect(page.getByRole('meter', { name: '연료' })).toHaveAttribute('aria-valuenow', String(Math.round(atSaudi.fuel)));
  await page.locator('.port-ui').getByRole('button', { name: '급유', exact: true }).click();
  await expect.poll(async () => (await logOf(page, 'refuel')).length).toBe(1);
  const refuel = (await logOf(page, 'refuel'))[0] as { cost: number; port: string };
  expect(refuel.port).toBe('saudi');
  expect(refuel.cost).toBe(Math.round(100 * atSaudi.flags.refuelFactor)); // 중거리 100, 자동화 항만 카드면 80
  expect(refuel.cost).toBeGreaterThanOrEqual(80);
  expect(refuel.cost).toBeLessThanOrEqual(100);
  const afterRefuel = await state(page);
  expect(afterRefuel.cash).toBe(atSaudi.cash - refuel.cost);
  expect(afterRefuel.fuel).toBe(300);
  await judgeAndTrade(page, 'phone', 'sell', 4, true);
  await judgeAndTrade(page, 'crude-oil', 'buy', 2);
  await judgeAndTrade(page, 'natural-gas', 'buy', 2);
  await leave(page);

  // 3 싱가포르: 입항 직후 새로 고침 → 이어하기 → 같은 턴·현금
  await go(3, 'singapore');
  const before = await state(page);
  expect(before.portCalls).toBe(3);
  await page.reload();
  await page.getByRole('button', { name: '이어하기' }).click();
  await expect(page.locator('.port-ui .ribbon.name')).toHaveText(PORT_BY_ID.singapore.nameKo);
  const restored = await state(page);
  expect(restored.portCalls).toBe(before.portCalls);
  expect(restored.cash).toBe(before.cash);
  expect(restored.location).toBe('singapore');
  await judgeAndTrade(page, 'crude-oil', 'sell', 2);
  // Q1: 판정을 마친 뒤 새로 고침 → 같은 상품 다시 → 판정 다이얼로그 없이 시세·거래 칸, 판정 로그 그대로
  await judge(page, 'natural-gas', 'sell');
  const judged = async () => (await state(page)).log.filter((e) => e.type === 'judge_dir' || e.type === 'judge_cause').length;
  const judgedBefore = await judged();
  await page.reload();
  await page.getByRole('button', { name: '이어하기' }).click();
  await expect(page.locator('.port-ui .ribbon.name')).toHaveText(PORT_BY_ID.singapore.nameKo);
  const gas = row(page, 'natural-gas', 'last');
  await expect(gas.locator('.p')).not.toHaveText('?');
  await gas.click();
  const dlg = page.locator('.port-ui .speech');
  await expect(dlg.locator('.trade')).toBeVisible();
  await expect(dlg.locator('.choices')).toHaveCount(0);
  expect(await judged()).toBe(judgedBefore);
  await stepAndGo(page, '.port-ui .speech', 2, '팔기');
  await leave(page);

  // 4 부산: 급유(0), 화장품 싣기, 반도체 사기
  await go(4, 'busan');
  await page.locator('.port-ui').getByRole('button', { name: '급유', exact: true }).click();
  await expect.poll(async () => (await state(page)).fuel).toBe(300);
  await homeTrade(page, 'cosmetics', 'load', 2);
  await homeTrade(page, 'semiconductor', 'buy', 2);
  await leave(page);

  // 5 일본: 반도체 수출, 로봇 수입
  await go(5, 'japan');
  await judgeAndTrade(page, 'semiconductor', 'sell', 2);
  await judgeAndTrade(page, 'robot', 'buy', 2);
  await leave(page);

  // 6 싱가포르: 화장품 수출, 로봇 중계 → 출항 = 에필로그
  await go(6, 'singapore');
  await judgeAndTrade(page, 'cosmetics', 'sell', 2);
  await judgeAndTrade(page, 'robot', 'sell', 2);
  await leave(page);

  // 에필로그: 일지 → 까닭 문장 → 생각 그물 → 결과
  await expect(page.locator('.ep-root .ep-table')).toBeVisible();
  // C2 수동 1행: 선택 상자 3칸
  await page.getByLabel('수출국').selectOption('사우디아라비아');
  await page.getByLabel('품목').selectOption('원유');
  await page.getByLabel('수입국').selectOption('대한민국');
  await page.screenshot({ path: `${SHOTS}c5-ledger.png` });
  await page.getByRole('button', { name: '추가' }).click();
  expect(await logOf(page, 'ledger_manual')).toEqual([expect.objectContaining({ exporter: '사우디아라비아', good: '원유', importer: '대한민국', correct: true })]);
  await page.getByRole('button', { name: '다음' }).click();
  // C3 까닭 문장: 축 칩 + 맺음말
  const submit = page.getByRole('button', { name: '제출' });
  for (const a of ['자연환경', '자원', '기술']) await page.getByRole('checkbox', { name: a }).check();
  await expect(submit).toBeDisabled();
  await page.getByRole('radio', { name: '…이 나라마다 달라서 무역을 한다' }).check();
  await expect(page.getByLabel('무역이 생기는 까닭')).toHaveText('자연환경·자원·기술이 나라마다 달라서 무역을 한다.');
  await page.screenshot({ path: `${SHOTS}c5-sentence.png` });
  await submit.click();
  expect((await logOf(page, 'sentence')).map((e) => (e as { text: string }).text)).toEqual(['자연환경·자원·기술이 나라마다 달라서 무역을 한다.']);
  // C7 같은 저장소 새 page 로 이어하기 → 일지 → 문장 화면: 제출한 칩·맺음말 복원, 고치기 1회만 남음
  const p3 = await page.context().newPage();
  await p3.goto(GAME_URL);
  await p3.getByRole('button', { name: '이어하기' }).click();
  await p3.getByRole('button', { name: '다음' }).click();
  for (const a of ['자연환경', '자원', '기술']) await expect(p3.getByRole('checkbox', { name: a })).toBeChecked();
  await expect(p3.getByRole('checkbox', { name: '자본' })).not.toBeChecked();
  await expect(p3.getByRole('radio', { name: '…이 나라마다 달라서 무역을 한다' })).toBeChecked();
  await expect(p3.getByLabel('무역이 생기는 까닭')).toHaveText('자연환경·자원·기술이 나라마다 달라서 무역을 한다.');
  await expect(p3.getByRole('button', { name: '제출' })).toBeDisabled();
  await p3.getByRole('button', { name: '고치기' }).click();
  await p3.getByRole('checkbox', { name: '자본' }).check();
  await p3.getByRole('button', { name: '제출' }).click();
  await expect(p3.getByRole('button', { name: '고치기' })).toHaveCount(0);
  await expect(p3.getByRole('checkbox', { name: '자본' })).toBeDisabled();
  await p3.close();
  await page.getByRole('button', { name: '다음' }).click();
  const mind: Record<string, string> = {
    '나라와 나라 사이에 물자나 서비스를 사고파는 것': '무역',
    '다른 나라에서 사 오는 것': '수입',
    '다른 나라에 파는 것': '수출',
    '무역하는 까닭: 나라마다 자연환경·자원·자본·기술이 ○○': '차이',
    '서로 잘하는 것으로 협력하는 관계': '상호의존',
  };
  const ok = page.getByRole('button', { name: '확인' });
  for (const [k, v] of Object.entries(mind)) {
    await expect(ok).toBeDisabled();
    const group = page.getByRole('radiogroup', { name: k, exact: true });
    await expect(group.getByRole('radio')).toHaveCount(4);
    await group.getByRole('radio', { name: v, exact: true }).check();
  }
  await page.screenshot({ path: `${SHOTS}c5-mindmap.png` });
  await ok.click();
  await page.getByRole('button', { name: '결과 보기' }).click();
  await expect(page.locator('.ep-panel.result')).toBeVisible();

  // 내보내기: 다운로드 2건(JSON·CSV)
  const downloads: Download[] = [];
  page.on('download', (d) => downloads.push(d));
  await page.getByRole('button', { name: '결과 내보내기' }).click();
  await expect.poll(() => downloads.length).toBe(2);
  const json = downloads.find((d) => d.suggestedFilename().endsWith('.json'))!;
  const csv = downloads.find((d) => d.suggestedFilename().endsWith('.csv'))!;
  await json.saveAs(RESULT_PATH);
  const result = JSON.parse(readFileSync(RESULT_PATH, 'utf8'));
  const csvBytes = readFileSync(await csv.path());
  expect([...csvBytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

  // 결과 단언
  const log = result.log as { type: string; attempt?: number; correct?: boolean; name?: string; good?: string }[];
  const causes2 = log.filter((e) => e.type === 'judge_cause' && e.attempt === 2);
  expect(causes2).toHaveLength(2);
  expect(causes2.every((e) => e.correct)).toBe(true);
  expect(log.filter((e) => e.type === 'export_attempt_blocked')).toHaveLength(0);
  expect(log.filter((e) => e.type === 'port_call')).toHaveLength(6);
  const screens = log.filter((e) => e.type === 'screen').length;
  const dialogs = log.filter((e) => e.type === 'judge_dir' && e.attempt === 1).length;
  const sailTotal = Object.values(sailMs).reduce((a, b) => a! + b!, 0)!;
  console.log(JSON.stringify({ screens, dialogs, sailMs, sailTotal, grade: result.grade, rows: result.ledger.length, logLength: log.length }));
  expect(screens).toBeLessThanOrEqual(MAX_SCREENS);
  expect(dialogs).toBeLessThanOrEqual(MAX_JUDGE_DIALOGS);
  expect(sailTotal).toBeLessThanOrEqual(SAIL_BUDGET_MS);
  expect(result.grade.grade).toBe('A');
  // R1: 필수 이벤트 5장이 매 판 전부 event_choice 로그에
  const chosen = log.flatMap((e) => (e.type === 'event_choice' ? [(e as unknown as { event: string }).event] : []));
  expect(chosen).toEqual(expect.arrayContaining(EVENTS.filter((e) => e.required).map((e) => e.id)));

  // R5: 결과 화면에서 같은 저장소의 새 page 로 이어하기 → 결과 화면(완주 저장은 「처음으로」 전까지 남는다)
  const p2 = await page.context().newPage();
  await p2.goto(GAME_URL);
  await p2.getByRole('button', { name: '이어하기' }).click();
  await expect(p2.locator('.ep-panel.result')).toBeVisible();
  await expect(p2.locator('.ep-medal')).toHaveText(result.grade.grade);
  await p2.close();

  await page.getByRole('button', { name: '처음으로' }).click();
  await expect(page.getByRole('button', { name: '이어하기' })).toBeDisabled(); // 완주 뒤 저장 삭제
  return { logLength: log.length, grade: result.grade.grade, ledger: result.ledger };
}

test.describe.serial('완주 seed 42', () => {
  test('1회차 — 프롤로그→6턴→에필로그→내보내기', async ({ page }) => {
    runs.push(await playthrough(page));
  });

  test('2회차 — 같은 seed 면 log 길이·등급 동일', async ({ page }) => {
    const r = await playthrough(page);
    expect(r.logLength).toBe(runs[0].logLength);
    expect(r.grade).toBe(runs[0].grade);
    expect(r.ledger).toEqual(runs[0].ledger);
  });
});

test('예인 — 급유 없이 두 구간(부산→칠레, 칠레→독일) 연속 항해 → 연료 0 → 예인 연출 → 가장 가까운 항구, 거래 없음·급유만', async ({ page }) => {
  await newGame(page);
  await leave(page);
  await sail(page, 'chile', { arrived: () => expectCornersOnMap(page, 'chile') });
  await leave(page); // 칠레에서 급유하지 않는다
  await page.evaluate(() => {
    const w = window as unknown as { __ktrade: { sailTo(p: string): Promise<void> }; __sail: Promise<string> };
    // T15: 연료 잣대가 219/단위로 바뀌어 칠레→부산(0.71)은 연료가 남는다 → 칠레→독일(부산 앞 갈림점까지 되짚고 1.17 더)로 바닥낸다
    w.__sail = w.__ktrade.sailTo('germany').then(() => 'ok', (e: Error) => `err:${e.message}`);
  });
  const t0 = Date.now();
  let fuelSeen = (await state(page)).fuel;
  let towedAt = 0;
  while (Date.now() - t0 < 180_000) {
    await answerEvent(page);
    const s = await state(page);
    expect(s.fuel).toBeLessThanOrEqual(fuelSeen); // 항해 중 연료는 줄기만
    fuelSeen = s.fuel;
    if (s.log.some((e) => e.type === 'towed')) {
      towedAt = Date.now();
      break;
    }
    await page.waitForTimeout(100);
  }
  if (!towedAt) {
    const st = await state(page);
    const sailed = await page.evaluate(() => Promise.race([(window as unknown as { __sail: Promise<string> }).__sail, new Promise((r) => setTimeout(() => r('pending'), 100))]));
    console.log(JSON.stringify({ notTowed: { sailed, shipPos: st.shipPos, fuel: st.fuel, location: st.location } }));
  }
  expect(towedAt, '3분 안에 예인되지 않음').toBeGreaterThan(0);
  // V6: 예인 연출 중 배 그림 위치 표본 — 전부 바다(마스크), 직선이 아니라 뱃길을 따라 꺾인다
  const towShip: { x: number; y: number }[] = [];
  while (!(await page.locator('.port-ui .ribbon.name').isVisible()) && Date.now() - towedAt < 5000) {
    const { ship } = await view(page);
    towShip.push({ x: +ship.x.toFixed(1), y: +ship.y.toFixed(1) });
    await page.waitForTimeout(50);
  }
  const towLand = await landAt(page, towShip);
  const [a, b] = [towShip[0], towShip[towShip.length - 1]];
  const off = Math.max(...towShip.map((p) => Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / Math.hypot(b.x - a.x, b.y - a.y)));
  console.log(JSON.stringify({ towSamples: towShip.length, towShip: towShip.filter((_, i) => i % 4 === 0), maxOffStraightPx: +off.toFixed(1) }));
  expect(towShip.length).toBeGreaterThanOrEqual(10);
  expect(towLand.filter(Boolean)).toHaveLength(0);
  const s = await state(page);
  const towed = s.log.find((e) => e.type === 'towed') as { to: PortId };
  expect(s.log.filter((e) => e.type === 'refuel')).toHaveLength(0);
  expect(s.fuel).toBe(0);
  expect(s.location).toBe(towed.to);
  expect(s.portCalls).toBe(2);
  expect(s.flags.towedCall).toBe(true);
  // 예인 연출(뱃길 따라 1.5~3초)이 끝난 뒤에야 항구 화면
  await expect(page.locator('.port-ui .ribbon.name')).toHaveText(PORT_BY_ID[towed.to].nameKo);
  const tweenMs = Date.now() - towedAt;
  console.log(JSON.stringify({ towedTo: towed.to, tweenMs, sailMs: towedAt - t0 }));
  expect(tweenMs).toBeGreaterThanOrEqual(1000);
  await expect(page.locator('.port-ui .rows .row')).toHaveCount(0); // 거래 없음
  await page.locator('.port-ui').getByRole('button', { name: '급유', exact: true }).click();
  await expect.poll(async () => (await state(page)).fuel).toBe(300);
});

test('출항 직후 새로 고침 — 저장본의 배 위치 = 출항점(입항 반경 밖), 재입항 프롬프트 없음(F2)', async ({ page }) => {
  await newGame(page);
  await leave(page);
  const exit = (await state(page)).shipPos;
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ktrade.save.v1')!).shipPos);
  expect(saved).toEqual(exit);
  expect(Math.hypot(exit.x - PORT_BY_ID.busan.mapPos.x, exit.y - PORT_BY_ID.busan.mapPos.y)).toBeGreaterThan(0.03);
  await page.reload();
  await page.getByRole('button', { name: '이어하기' }).click();
  await expect(page.locator('.sail-ui .hud')).toBeVisible();
  const s = await state(page);
  expect(s.location).toBe('sea');
  expect(s.shipPos).toEqual(exit);
  await expect(page.locator('.sail-ui .prompt')).toHaveCount(0);
});

// T14: 부산 출항점이 선체 3점 기준으로 (0.48, 0.375) 로 옮겨져, 손으로는 일본 반경까지 0.04 안에 닿지 못한다 → 같은 성질의 짧은 뱃길 상하이(출항점에서 약 0.0125)
test('손 조타 짧은 뱃길(부산→상하이, 출항점에서 0.04 미만) — 입항 직전 밀린 필수 카드 → 답하면 입항(F1)', async ({ page }) => {
  await newGame(page);
  await leave(page);
  await page.waitForTimeout(500); // 조작 테스트와 같은 이유(출항 직후 같은 프레임 keydown)
  const exit = (await state(page)).shipPos;
  const shanghai = PORT_BY_ID.shanghai.mapPos;
  // T15: 상하이 핀은 만 서쪽 육지 위라 ← 만으로는 반경(0.028) 앞 선수가 해안에 걸린다(실측 0.0375) → ← 2초(반 바퀴 돌고 해안 앞까지) 뒤 ↖
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(2000);
  await page.keyboard.down('ArrowUp');
  await expect.poll(async () => Math.hypot((await state(page)).shipPos.x - shanghai.x, (await state(page)).shipPos.y - shanghai.y) <= 0.028, { timeout: 15_000 }).toBe(true);
  await page.keyboard.up('ArrowUp');
  await page.keyboard.up('ArrowLeft');
  const at = await state(page);
  console.log(JSON.stringify({ exit, at: at.shipPos, fromExit: Math.hypot(at.shipPos.x - exit.x, at.shipPos.y - exit.y) }));
  expect(Math.hypot(at.shipPos.x - exit.x, at.shipPos.y - exit.y)).toBeLessThan(0.04); // 거리 트리거로는 못 뜬다
  expect(at.log.filter((e) => e.type === 'event_choice')).toHaveLength(0);
  await page.locator('.sail-ui .prompt .btn').click();
  await expect(page.locator('.ev-card')).toBeVisible();
  expect((await state(page)).portCalls).toBe(0); // 카드가 먼저, 입항은 아직
  await answerEvent(page);
  await expect(page.locator('.port-ui .ribbon.name')).toHaveText(PORT_BY_ID.shanghai.nameKo);
  const s = await state(page);
  const types = s.log.map((e) => e.type);
  expect(types.indexOf('event_choice')).toBeLessThan(types.indexOf('port_call'));
  expect((s.log.find((e) => e.type === 'event_choice') as { event: string }).event).toBe(s.eventQueue[0]);
  expect(s.location).toBe('shanghai');
});

test('독일 — 부산에서 자동 조타로 한 탱크에 도착(연료 > 0, 예인 0)', async ({ page }) => {
  await newGame(page);
  await leave(page);
  const ms = await sail(page, 'germany', { arrived: () => expectCornersOnMap(page, 'germany') });
  const s = await state(page);
  console.log(JSON.stringify({ germanyMs: ms, fuel: s.fuel }));
  expect(s.location).toBe('germany');
  expect(s.fuel).toBeGreaterThan(0);
  expect(s.log.filter((e) => e.type === 'towed')).toHaveLength(0);
});

test('조작 — ArrowRight 2초 → x 증가, ArrowUp 유지 → 육지에 막혀 정지', async ({ page }) => {
  await newGame(page);
  await leave(page);
  await page.waitForTimeout(500); // 출항 직후 같은 프레임의 keydown 은 멈춰 있던 씬이 못 받는다(사람 손으론 생기지 않는 간격)
  // V11: 부산 출항점에서 ↓·← 도 바로 움직인다(출항점은 16방위 모두 선체 3점이 바다). M5: 헤딩은 초당 180° 로 돌아 ← 는 반 바퀴(1초) 돌고 나서 나아간다
  for (const [key, axis, sign] of [['ArrowDown', 'y', 1], ['ArrowLeft', 'x', -1]] as const) {
    const a = (await state(page)).shipPos;
    await page.keyboard.down(key);
    await page.waitForTimeout(1200);
    await page.keyboard.up(key);
    const b = (await state(page)).shipPos;
    console.log(JSON.stringify({ v11: key, from: a, to: b }));
    expect((b[axis] - a[axis]) * sign).toBeGreaterThan(0);
  }
  const p0 = (await state(page)).shipPos;
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(2000);
  await page.keyboard.up('ArrowRight');
  const p1 = (await state(page)).shipPos;
  expect(p1.x).toBeGreaterThan(p0.x);

  await page.keyboard.down('ArrowUp');
  let prev = p1;
  let stopped: { x: number; y: number } | null = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    await page.waitForTimeout(1000);
    const p = (await state(page)).shipPos;
    if (p.x === prev.x && p.y === prev.y) {
      stopped = p;
      break;
    }
    prev = p;
  }
  await page.keyboard.up('ArrowUp');
  const s = await state(page);
  console.log(JSON.stringify({ p0, p1, stopped, fuel: s.fuel }));
  expect(stopped, '30초 안에 멈추지 않음').not.toBeNull();
  expect(stopped!.y).toBeLessThan(p1.y); // 위로 갔다가
  expect(stopped!.y).toBeGreaterThan(0.01); // 지도 끝이 아니라 육지에서 섰다
  expect(s.fuel).toBeGreaterThan(0); // 연료 때문이 아니다
  expect(s.location).toBe('sea');
});

// T11 이 찾은 결함(T10 fix2 에서 수정): 항구 반경 안에서 무전 카드를 닫아도 배는 제자리여야 한다.
// 베트남 출항 직후 남중국해 카드가 베트남 반경 안에서 뜬다 → 닫은 뒤 위치 그대로, 사우디까지 자동 조타가 이어진다.
test('카드 닫기 — 항구 반경 안에서 무전 카드를 닫아도 배는 제자리(베트남→사우디)', async ({ page }) => {
  await newGame(page);
  await leave(page);
  await sail(page, 'vietnam');
  await leave(page);
  await page.evaluate(() => {
    const w = window as unknown as { __ktrade: { sailTo(p: string): Promise<void> }; __sail: Promise<string> };
    w.__sail = w.__ktrade.sailTo('saudi').then(() => 'ok', (e: Error) => `err:${e.message}`);
  });
  await expect(page.locator('.ev-card')).toBeVisible({ timeout: 60_000 });
  const before = (await state(page)).shipPos;
  await answerEvent(page);
  const after = (await state(page)).shipPos;
  console.log(JSON.stringify({ before, after }));
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(0.005); // 카드 닫기 = 제자리
  const r = await page.evaluate(() => (window as unknown as { __sail: Promise<string> }).__sail);
  expect(r).toBe('ok');
});

test('항해 연출(T14·T15) — 카메라 경계(부산·LA)·화면 고정 UI 위치/크기·부산→일본 배 아래 시각 육지 ≤ 5%(V2·V8·V12·M12)', async ({ page }) => {
  await newGame(page);
  await leave(page);
  await expectCornersOnMap(page, 'busan');
  await expectFixedUi(page, 'busan');

  // V12·M12: 부산→일본 자동 조타 중 0.5초 간격 6장. 배 그림 화면 박스(월드 중심·크기 → 카메라 투영) 안 시각 육지(mask-visual) 비율
  const shots: { i: number; frac: number; ship: { x: number; y: number }; screenBox: number[] }[] = [];
  await sail(page, 'japan', {
    during: async () => {
      const t0 = Date.now();
      for (let i = 1; i <= 6; i++) {
        await page.waitForTimeout(Math.max(0, t0 + 500 * i - Date.now()));
        await answerEvent(page);
        await canvasShot(page, { path: `${SHOTS}v12-busan-japan-${i}.jpg`, jpeg: true });
        const v = await view(page);
        const { frac, screenBox } = await shipLandFraction(page, v);
        shots.push({ i, frac: +frac.toFixed(4), ship: { x: +v.ship.x.toFixed(1), y: +v.ship.y.toFixed(1) }, screenBox });
      }
    },
  });
  console.log(JSON.stringify({ v12: shots }));
  expect(shots).toHaveLength(6);
  expect(new Set(shots.map((s) => `${s.ship.x},${s.ship.y}`)).size).toBe(6); // 배가 실제로 움직이는 중에 찍었다
  for (const s of shots) expect(s.frac, `shot ${s.i}`).toBeLessThanOrEqual(0.05);

  await leave(page);
  await sail(page, 'la', {
    arrived: async () => {
      await expectCornersOnMap(page, 'la');
      await expectFixedUi(page, 'la');
    },
  });
});

// M3·M10: 캔버스를 기기 해상도로(deviceScaleFactor 2 → k = 2, 캔버스 2560×1440) 그려도 DOM 배치·D-패드·닻·배의 화면 자리는 dpr 1 과 같다(±1.5px)
test('dpr 2 — 캔버스 2560×1440, 화면 고정 UI·배 화면 위치 dpr 1 과 같음(M3·M10)', async ({ browser }) => {
  const at = async (dpr: number) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    await newGame(page);
    await leave(page);
    await page.waitForTimeout(1500); // 카메라 lerp
    const canvas = await page.evaluate(() => {
      const c = document.querySelector('#game canvas') as HTMLCanvasElement;
      const r = c.getBoundingClientRect();
      return { width: c.width, height: c.height, css: [r.x, r.y, r.width, r.height], stageScale: document.documentElement.style.getPropertyValue('--stage-scale') };
    });
    const v = await view(page);
    const shipScreen = { x: +((v.ship.x - v.cam.x) * v.cam.zoom).toFixed(2), y: +((v.ship.y - v.cam.y) * v.cam.zoom).toFixed(2) };
    await canvasShot(page, { path: `${SHOTS}m3-dpr${dpr}.jpg`, jpeg: true });
    const shot = await canvasShot(page);
    const ui = [];
    for (const { src, rect, before } of FIXED_UI) ui.push({ src, before, after: await findSprite(page, shot, src, rect) });
    await ctx.close();
    return { dpr, canvas, k: v.cam.k, zoom: v.cam.zoom, shipScreen, ui };
  };
  const one = await at(1);
  const two = await at(2);
  console.log(JSON.stringify({ m3: [one, two] }));
  expect(one.canvas.width).toBe(1280);
  expect(two.canvas.width).toBe(2560 * Number(two.canvas.stageScale));
  expect(two.canvas.height).toBe(1440 * Number(two.canvas.stageScale));
  expect(two.k).toBe(2);
  expect(two.canvas.css).toEqual(one.canvas.css); // CSS 상자 그대로(1280×720)
  expect(two.zoom).toBe(1);
  for (const a of ['x', 'y'] as const) expect(Math.abs(two.shipScreen[a] - one.shipScreen[a]), `ship ${a}`).toBeLessThanOrEqual(1.5);
  for (const [i, { before, after }] of two.ui.entries())
    for (const key of ['cx', 'cy', 'rx', 'ry'] as const) {
      expect(Math.abs(after[key] - before[key]), `dpr2 ${FIXED_UI[i].src} ${key}`).toBeLessThanOrEqual(1.5);
      expect(Math.abs(one.ui[i].after[key] - before[key]), `dpr1 ${FIXED_UI[i].src} ${key}`).toBeLessThanOrEqual(1.5);
    }
});
