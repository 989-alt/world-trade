import { describe, expect, it, vi } from 'vitest';
import { PORT_BY_ID } from '../content/ports';
import { createLog } from '../engine/log';
import { createRng } from '../engine/rng';
import { startJudgment, type JudgmentSession } from '../engine/judgment';
import { newGame, reduce, type Action } from '../engine/state';
import type { GameState } from '../engine/types';
import { DOCK_RADIUS, exitPoint, nearestPortWithin } from '../game/ports-layout';
import { recipeView } from './FactoryPanel';
import { TIP_FULL, TIP_NO_CASH, refuelView } from './RefuelPanel';
import { clampQty, createGuard, maxQty, tradeAction, tradeSummary, type Row } from './TradePanel';
import portSrc from './PortPanel.tsx?raw';

const resume = vi.fn();
vi.mock('../game/SailingScene', () => ({ departPort: () => resume() }));
const { M2_TIP, M7_BANNER, leavePort, portRows } = await import('./PortPanel');

/** gameStore 와 같은 규칙(거부면 상태 안 바꿈)의 테스트 저장소 */
function store(s: GameState) {
  let cur = s;
  return {
    get: () => cur,
    set: (n: GameState | null) => void (cur = n!),
    dispatch(a: Action) {
      const r = reduce(cur, a);
      if (!r.reason) cur = r.state;
      return r;
    },
  };
}
const main = () => reduce(newGame(42, { nickname: 't', seat: '1' }), { type: 'START_MAIN' }).state;
const at = (port: GameState['location'], patch: Partial<GameState> = {}): GameState => ({
  ...main(),
  location: port,
  portCalls: 1,
  ...patch,
});
const done = (port: 'saudi' | 'singapore', good: Row['good'], dir: 'import' | 'export', wrong = 0): JudgmentSession => {
  const j = startJudgment({ port, good, dir, shuffle: createRng(1).shuffle, log: createLog() });
  if (!j.ok) throw new Error(j.reason);
  const s = j.session;
  s.step = 'done';
  s.retried = wrong > 0;
  s.delay = wrong > 1;
  return s;
};
const rowOf = (s: GameState, key: string) => portRows(s).find((r) => r.key === key)!;

describe('수량 스테퍼', () => {
  it('0 미만·상한 초과로 못 간다', () => {
    expect(clampQty(-1, 3)).toBe(0);
    expect(clampQty(9, 3)).toBe(3);
    expect(clampQty(1, 0)).toBe(0);
  });
  it('사기 상한 = 적재 여유 / 현금, 통관 지연이면 칸 -1', () => {
    const s = at('saudi', { cargo: [{ good: 'semiconductor', qty: 1, origin: 'busan' }] });
    const oil = rowOf(s, 'buy:crude-oil');
    expect(maxQty(s, oil, done('saudi', 'crude-oil', 'import'))).toBe(3);
    expect(maxQty(s, oil, done('saudi', 'crude-oil', 'import', 2))).toBe(2);
    expect(maxQty({ ...s, cash: 80 }, oil, done('saudi', 'crude-oil', 'import'))).toBe(2);
    // 수수료 10% 포함: 36x2 + 7 = 79 ≤ 80, 36x3 > 80
    expect(maxQty({ ...s, cash: 79 }, oil, done('saudi', 'crude-oil', 'import', 1))).toBe(2);
    expect(maxQty({ ...s, cash: 78 }, oil, done('saudi', 'crude-oil', 'import', 1))).toBe(1);
  });
  it('팔기 상한 = 배 수량, 싣기 상한 = 창고 수량과 적재 여유', () => {
    const s = at('saudi', { cargo: [{ good: 'car', qty: 2, origin: 'busan' }] });
    expect(maxQty(s, rowOf(s, 'sell:car'))).toBe(2);
    const b = at('busan', { cargo: [{ good: 'rice', qty: 3, origin: 'thai' }] });
    expect(maxQty(b, rowOf(b, 'load:semiconductor'))).toBe(1);
  });
});

describe('거래 액션·요약', () => {
  it('판정 결과의 수수료 비율·적재 칸이 BUY 에 실린다', () => {
    const s = at('saudi');
    const a = tradeAction(rowOf(s, 'buy:crude-oil'), 2, done('saudi', 'crude-oil', 'import', 2));
    expect(a).toEqual({ type: 'BUY', good: 'crude-oil', qty: 2, fee: 0.1, slots: 3 });
    const r = store(s).dispatch(a);
    expect(r.reason).toBeUndefined();
    expect(r.state.cash).toBe(1000 - 72 - 7);
  });
  it("수수료가 생기면 요약에 '통관 수수료 10%' 행, 없으면 없음", () => {
    expect(tradeSummary(2, 36, done('saudi', 'crude-oil', 'import', 1))).toEqual({ total: 72, fee: 7, feeLabel: '통관 수수료 10%' });
    expect(tradeSummary(2, 36, done('saudi', 'crude-oil', 'import'))).toEqual({ total: 72, fee: 0, feeLabel: null });
  });
});

describe('더블탭', () => {
  it('처리 중(pending)이면 두 번째 구매는 dispatch 되지 않는다', () => {
    const st = store(at('saudi'));
    const spy = vi.spyOn(st, 'dispatch');
    const g = createGuard();
    const buy = () => st.dispatch({ type: 'BUY', good: 'crude-oil', qty: 1 });
    expect(g.run(buy)).not.toBeNull();
    expect(g.pending).toBe(true);
    expect(g.run(buy)).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(st.get().cargo).toEqual([{ good: 'crude-oil', qty: 1, origin: 'saudi' }]);
    g.release();
    expect(g.run(buy)).not.toBeNull();
  });
});

describe('M2 원유·천연가스 수출', () => {
  it('부산 줄은 잠금(blocked) + 툴팁 문장, 눌러도 dispatch 없음 → export_attempt_blocked 0건(PRD S6)', () => {
    const s = at('busan');
    for (const g of ['crude-oil', 'natural-gas'] as const) {
      const r = rowOf(s, `blocked:${g}`);
      expect(r.mode).toBe('blocked');
      expect(maxQty(s, r)).toBe(0);
    }
    expect(M2_TIP).toBe('우리나라는 원유를 전량 수입합니다');
    // 행 클릭 처리(choose)는 blocked 면 store 를 건드리기 전에 끝난다
    expect(portSrc).toMatch(/if \(r\.mode === 'blocked'\) return;/);
    expect(portSrc).not.toMatch(/tryBlockedExport|type: 'LOAD'/);
    expect(s.log.filter((e) => e.type === 'export_attempt_blocked')).toHaveLength(0);
  });
});

describe('M7 한국 특산품 외국 구매', () => {
  it('경고 배너 문장이 붙고, 외국 특산은 배너 없음', () => {
    const s = at('saudi');
    expect(rowOf(s, 'buy:semiconductor').own).toBe('이미 우리나라가 잘 만드는 것입니다');
    expect(M7_BANNER).toBe('이미 우리나라가 잘 만드는 것입니다');
    expect(rowOf(s, 'buy:crude-oil').own).toBeNull();
  });
});

describe('시세표 줄', () => {
  it('외국: 파는 것은 수입, 배에 있고 그 항구 결핍인 것만 수출. 싱가포르는 배의 모든 상품', () => {
    const cargo = [{ good: 'car' as const, qty: 1, origin: 'busan' as const }, { good: 'rice' as const, qty: 1, origin: 'thai' as const }];
    const sa = portRows(at('saudi', { cargo }));
    expect(sa.filter((r) => r.mode === 'sell').map((r) => r.good)).toEqual(['car']);
    expect(sa.slice(0, 2).map((r) => r.good)).toEqual(['crude-oil', 'natural-gas']);
    const sg = portRows(at('singapore', { cargo }));
    expect(sg.filter((r) => r.mode === 'sell').map((r) => r.good)).toEqual(['car', 'rice']);
  });
});

describe('공장', () => {
  it('입력이 모자라면 잠금 + 모자란 품목 표시', () => {
    const v = recipeView(at('busan'));
    expect(v.map((r) => r.ok)).toEqual([false, false, false]);
    expect(v[1].inputs.filter((i) => i.lack).map((i) => i.name)).toEqual(['흑연', '니켈']);
    const w = recipeView(at('busan', { cargo: [{ good: 'graphite', qty: 1, origin: 'shanghai' }] }));
    expect(w[1].ok).toBe(false);
    expect(w[1].inputs.filter((i) => i.lack).map((i) => i.name)).toEqual(['니켈']);
    const ok = recipeView(at('busan', { cargo: [{ good: 'crude-oil', qty: 1, origin: 'saudi' }] }));
    expect(ok[0].ok).toBe(true);
  });
});

describe('급유', () => {
  it('탱크가 차 있으면 잠금', () => {
    expect(refuelView(at('saudi'))).toEqual({ fare: 100, disabled: true, tip: TIP_FULL });
  });
  it('코인이 요금보다 적으면 잠금 + 예인 안내', () => {
    expect(refuelView(at('saudi', { fuel: 10, cash: 99 }))).toEqual({ fare: 100, disabled: true, tip: TIP_NO_CASH });
    expect(TIP_NO_CASH).toContain('예인선');
    expect(refuelView(at('saudi', { fuel: 10, cash: 100 })).disabled).toBe(false);
  });
});

describe('예인 입항', () => {
  it('거래 줄 없음 → 급유 + 출항만', () => {
    const s = at('thai', { fuel: 0, flags: { ...main().flags, towedCall: true } });
    expect(portRows(s)).toEqual([]);
    expect(refuelView(s).disabled).toBe(false);
  });
});

describe('출항', () => {
  it('LEAVE_PORT → 화면 닫고 departPort 호출', () => {
    resume.mockClear();
    const st = store(at('saudi'));
    const close = vi.fn();
    const r = leavePort(st, close);
    expect(r.reason).toBeUndefined();
    expect(st.get().location).toBe('sea');
    expect(close).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledOnce();
  });
  it('departPort 가 쓰는 출항 지점은 항구 반경 밖(즉시 재입항 없음)', () => {
    const sea = { width: 1, height: 1, data: new Uint8Array(1) };
    const p = exitPoint(PORT_BY_ID.saudi, sea);
    expect(Math.hypot(p.x - 0.26, p.y - 0.46)).toBeGreaterThan(DOCK_RADIUS);
    expect(nearestPortWithin(p)).toBeNull();
  });
});
