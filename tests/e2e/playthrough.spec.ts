import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Download, type Page } from '@playwright/test';
import { PORT_BY_ID } from '../../src/content/ports';
import type { PortId } from '../../src/content/types';
import { answerEvent, homeTrade, judgeAndTrade, leave, logOf, newGame, sail, state } from './helpers';

const RESULT_PATH = fileURLToPath(new URL('./fixtures/last-result.json', import.meta.url));
const SAIL_BUDGET_MS = 4 * 60_000; // S8 항해 누적 ≤ 4분
const MAX_SCREENS = 35; // S8
const MAX_JUDGE_DIALOGS = 14; // S8
const M2_TIP = '우리나라는 원유를 전량 수입합니다'; // PortPanel.M2_TIP (그 모듈은 Phaser 를 끌어와 node 에서 못 읽는다)

type Run = { logLength: number; grade: string; ledger: unknown[] };
const runs: Run[] = [];

/**
 * seed 42 한 판. 입항 6회: 상하이 → 사우디 → 싱가포르(새로 고침) → 부산 → 일본 → 싱가포르 → 에필로그 → 내보내기.
 * 1·2턴은 까닭 1차 오답 후 정답(attempt 2). 판정 다이얼로그 10회, 일지 10행(싱가포르 중계 = 한국 미포함).
 * 베트남을 거치지 않는 까닭: 아래 '결함' 테스트(베트남 출항 직후 무전 카드 → 순간이동 → 자동 조타 중단).
 */
async function playthrough(page: Page): Promise<Run> {
  const sailMs: Partial<Record<string, number>> = {};
  const go = async (turn: number, port: PortId) => (sailMs[`${turn}-${port}`] = await sail(page, port));

  await newGame(page);

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

  // 1 상하이: 반도체 수출(까닭 1차 오답), 흑연 수입
  await go(1, 'shanghai');
  await judgeAndTrade(page, 'semiconductor', 'sell', 2, true);
  await judgeAndTrade(page, 'graphite', 'buy', 2);
  await leave(page);

  // 2 사우디: 연료 게이지 감소 → 급유 100 내외. 무선 통신 기기 수출(까닭 1차 오답), 원유 수입
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
  await judgeAndTrade(page, 'phone', 'sell', 2, true);
  await judgeAndTrade(page, 'crude-oil', 'buy', 2);
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
  await judgeAndTrade(page, 'graphite', 'sell', 2);
  await judgeAndTrade(page, 'crude-oil', 'sell', 2);
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
  await page.getByRole('button', { name: '다음' }).click();
  await page.getByLabel('무역이 생기는 까닭').fill('나라마다 자연환경과 자원, 기술이 달라서 잘 만드는 것이 다르기 때문에 무역을 한다.');
  await page.getByRole('button', { name: '제출' }).click();
  await page.getByRole('button', { name: '다음' }).click();
  const mind: Record<string, string> = {
    '뜻': '무역',
    '다른 나라에서 사 오는 것': '수입',
    '다른 나라에 파는 것': '수출',
    '무역하는 까닭: 나라마다 자연환경·자원·자본·기술이 ○○': '차이',
    '서로 잘하는 것으로 협력하는 관계': '상호의존',
  };
  for (const [k, v] of Object.entries(mind)) await page.getByLabel(k, { exact: true }).fill(v);
  await page.getByRole('button', { name: '확인' }).click();
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

test('예인 — 부산→독일 뱃길(연료 504 > 탱크 300)에서 연료 0 → 예인 연출 → 가장 가까운 항구, 거래 없음·급유만', async ({ page }) => {
  await newGame(page);
  await leave(page);
  await page.evaluate(() => {
    void (window as unknown as { __ktrade: { sailTo(p: string): Promise<void> } }).__ktrade.sailTo('germany').catch(() => {});
  });
  const t0 = Date.now();
  let fuelSeen = 300;
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
  expect(towedAt, '3분 안에 예인되지 않음').toBeGreaterThan(0);
  const s = await state(page);
  const towed = s.log.find((e) => e.type === 'towed') as { to: PortId };
  expect(s.fuel).toBe(0);
  expect(s.location).toBe(towed.to);
  expect(s.portCalls).toBe(1);
  expect(s.flags.towedCall).toBe(true);
  // 예인 연출(1.5초 트윈)이 끝난 뒤에야 항구 화면
  await expect(page.locator('.port-ui .ribbon.name')).toHaveText(PORT_BY_ID[towed.to].nameKo);
  const tweenMs = Date.now() - towedAt;
  console.log(JSON.stringify({ towedTo: towed.to, tweenMs, sailMs: towedAt - t0 }));
  expect(tweenMs).toBeGreaterThanOrEqual(1000);
  await expect(page.locator('.port-ui .rows .row')).toHaveCount(0); // 거래 없음
  await page.locator('.port-ui').getByRole('button', { name: '급유', exact: true }).click();
  await expect.poll(async () => (await state(page)).fuel).toBe(300);
});

test('조작 — ArrowRight 2초 → x 증가, ArrowUp 유지 → 육지에 막혀 정지', async ({ page }) => {
  await newGame(page);
  await leave(page);
  await page.waitForTimeout(500); // 출항 직후 같은 프레임의 keydown 은 멈춰 있던 씬이 못 받는다(사람 손으론 생기지 않는 간격)
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

// 결함(src 미수정, 보고): SailingScene.resumeFromDialog 는 출항뿐 아니라 무전 카드·일지를 닫을 때도 불린다.
// 그때 배가 아무 항구 반경(0.03) 안이면 그 항구 출항점으로 옮겨 버린다 → 베트남 출항 직후 남중국해 카드가 베트남 반경 안에서 뜨면
// 배가 베트남 출항점으로 순간이동하고, 자동 조타는 다음 웨이포인트로 육지를 가로지르다 'blocked by land' 로 끊긴다.
// 기대: 카드를 닫아도 배는 제자리, 사우디까지 간다. 고쳐지면 test.fail 을 지운다.
test('결함 — 항구 반경 안에서 무전 카드를 닫으면 배가 순간이동(베트남→사우디 자동 조타 중단)', async ({ page }) => {
  test.fail();
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
