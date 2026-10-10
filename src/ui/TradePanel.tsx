import { useRef, useState } from 'preact/hooks';
import { GOOD_BY_ID } from '../content/goods';
import type { GoodId } from '../content/types';
import { CARGO_CAP, qtyOf } from '../engine/economy';
import { customsFee, judgmentResult, tradeSlots, type Dir, type JudgmentSession } from '../engine/judgment';
import type { Action } from '../engine/state';
import type { GameState, Result } from '../engine/types';
import type { GameStore } from '../game/SailingScene';

/** 시세표 한 줄. buy·sell 은 외국(부산 buy 는 판정 없음), load 는 부산 창고 → 배, blocked 는 M2 */
export type Row = {
  key: string;
  good: GoodId;
  dir: Dir;
  mode: 'buy' | 'sell' | 'load' | 'blocked';
  price: number;
  /** M7 경고 배너 문장(한국 특산을 외국에서 살 때) */
  own: string | null;
};

const ACTION_LABEL = { buy: '사기', sell: '팔기', load: '싣기' } as const;
export const FEE_LABEL = '통관 수수료 10%';

const feeRate = (s?: JudgmentSession) => (s ? judgmentResult(s).feeRate : 0);

/** 스테퍼 상한: 사기 = 적재 여유(통관 지연 반영)·현금, 팔기 = 배 수량, 싣기 = 창고 수량·적재 여유 */
export function maxQty(state: GameState, row: Row, session?: JudgmentSession): number {
  const room = (cap: number) => Math.max(0, cap - qtyOf(state.cargo));
  if (row.mode === 'sell') return qtyOf(state.cargo, row.good);
  if (row.mode === 'load') return Math.min(qtyOf(state.depot, row.good), room(CARGO_CAP));
  if (row.mode === 'blocked') return 0;
  const fee = feeRate(session);
  let n = room(Math.min(CARGO_CAP, session ? tradeSlots(CARGO_CAP, session) : CARGO_CAP));
  while (n > 0 && row.price * n + Math.round(row.price * n * fee) > state.cash) n--;
  return n;
}

export const clampQty = (q: number, max: number) => Math.max(0, Math.min(max, q));

export function tradeSummary(qty: number, price: number, session?: JudgmentSession) {
  const total = qty * price;
  const fee = session ? customsFee(total, session) : 0;
  return { total, fee, feeLabel: fee > 0 ? FEE_LABEL : null };
}

/** 엔진 fee 는 비율(0 / 0.1), slots 는 통관 지연 반영 적재 칸 */
export function tradeAction(row: Row, qty: number, session?: JudgmentSession): Action {
  if (row.mode === 'buy') return { type: 'BUY', good: row.good, qty, ...(session ? { fee: feeRate(session), slots: tradeSlots(CARGO_CAP, session) } : {}) };
  if (row.mode === 'sell') return { type: 'SELL', good: row.good, qty, ...(session ? { fee: feeRate(session) } : {}) };
  return { type: 'LOAD', good: row.good, qty };
}

/** 더블탭 막기: 처리 중(pending)이면 두 번째 실행은 null */
export function createGuard() {
  let pending = false;
  return {
    get pending() {
      return pending;
    },
    run<T>(fn: () => T): T | null {
      if (pending) return null;
      pending = true;
      return fn();
    },
    release() {
      pending = false;
    },
  };
}

/**
 * M2: 부산 창고에 없는 결핍 자원 수출 시도 → 엔진 LOAD 가 export_attempt_blocked 를 남기고 거부한다.
 * gameStore.dispatch 는 거부 결과를 버리므로 로그가 붙은 상태만 직접 넣는다.
 */
export function tryBlockedExport(store: Pick<GameStore, 'get' | 'set' | 'dispatch'>, good: GoodId): Result {
  const before = store.get();
  const r = store.dispatch({ type: 'LOAD', good, qty: 1 });
  if (r.reason && r.state !== before) store.set(r.state);
  return r;
}

type Props = { store: GameStore; state: GameState; row: Row; session?: JudgmentSession };

export function TradePanel({ store, state, row, session }: Props) {
  const max = maxQty(state, row, session);
  const [want, setWant] = useState(1);
  const [busy, setBusy] = useState(false);
  const guard = useRef(createGuard()).current;
  const qty = clampQty(want, max);
  const sum = tradeSummary(qty, row.price, session);
  const mode = row.mode === 'blocked' ? 'load' : row.mode;

  const go = () => {
    if (qty < 1) return;
    const r = guard.run(() => store.dispatch(tradeAction(row, qty, session)));
    if (!r) return;
    setBusy(true);
    setWant(1);
    setTimeout(() => {
      guard.release();
      setBusy(false);
    }, 300);
  };

  return (
    <div class="trade">
      <img class="good-ic" src={GOOD_BY_ID[row.good].icon} alt="" />
      <div class="stepper">
        <button class="step" aria-label="줄이기" disabled={qty <= 0} onClick={() => setWant(clampQty(qty - 1, max))}>−</button>
        <b aria-live="polite">{qty}</b>
        <button class="step" aria-label="늘리기" disabled={qty >= max} onClick={() => setWant(clampQty(qty + 1, max))}>+</button>
      </div>
      {mode !== 'load' && (
        <div class="sum">
          <span><img src="assets/ui/icon-coin.png" alt="코인" />{sum.total.toLocaleString('ko-KR')}</span>
          {sum.feeLabel && <small>{sum.feeLabel} {sum.fee.toLocaleString('ko-KR')}</small>}
        </div>
      )}
      <button class={`btn ${mode === 'sell' ? 'orange' : ''}`} disabled={busy || qty < 1} onClick={go}>
        <span>{ACTION_LABEL[mode]}</span>
      </button>
    </div>
  );
}
