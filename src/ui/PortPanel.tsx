import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { GOODS, GOOD_BY_ID } from '../content/goods';
import { PORT_BY_ID } from '../content/ports';
import type { GoodId } from '../content/types';
import { buyPrice, priceAt, qtyOf, sellsHere, withLog } from '../engine/economy';
import { canMove, flagOwnSpecialty, startJudgment, type JudgmentSession } from '../engine/judgment';
import type { Log } from '../engine/log';
import { createRng, type Rng } from '../engine/rng';
import type { GameState, LogInput, Result } from '../engine/types';
import { resumeSailing, type GameStore } from '../game/SailingScene';
import { FactoryPanel } from './FactoryPanel';
import { JudgmentDialog, priceLabel, type Entry } from './JudgmentDialog';
import { RefuelPanel } from './RefuelPanel';
import { TradePanel, type Row } from './TradePanel';
import './port.css';

export const M2_TIP = '우리나라는 원유를 전량 수입합니다';
export const M7_BANNER = '이미 우리나라가 잘 만드는 것입니다';

const uniq = (goods: GoodId[]) => [...new Set(goods)];

/** 시세표 줄. 예인 입항은 거래 없음. 부산 = 창고 싣기·특산 사기·결핍 자원(M2) 잠금. 외국 = 파는 것(수입)·배에 있고 그 항구가 사 주는 것(수출) */
export function portRows(state: GameState): Row[] {
  if (state.location === 'sea' || state.flags.towedCall) return [];
  const port = PORT_BY_ID[state.location];
  const f = state.flags.priceFactor;
  const row = (good: GoodId, dir: Row['dir'], mode: Row['mode'], price: number): Row => ({
    key: `${mode}:${good}`, good, dir, mode, price, own: null,
  });
  if (port.id === 'busan') {
    return [
      ...uniq(state.depot.map((i) => i.good)).map((g) => row(g, 'export', 'load', qtyOf(state.depot, g))),
      ...port.specialties.map((g) => row(g, 'export', 'buy', buyPrice(state, port, g))),
      ...port.shortages.map((s) => row(s.good, 'export', 'blocked', 0)),
    ];
  }
  const buys = GOODS.map((g) => g.id)
    .filter((g) => sellsHere(port, g))
    .sort((a, b) => Number(!port.specialties.includes(a)) - Number(!port.specialties.includes(b)))
    .map((g) => ({ ...row(g, 'import', 'buy', buyPrice(state, port, g)), own: flagOwnSpecialty(port.id, g) && M7_BANNER }));
  const sells = uniq(state.cargo.map((i) => i.good))
    .filter((g) => port.id === 'singapore' || port.shortages.some((s) => s.good === g))
    .map((g) => row(g, 'export', 'sell', priceAt(port, g, f)));
  return [...buys, ...sells];
}

/** 출항: LEAVE_PORT → 항구 화면 닫기 → 항해 재개(배는 항구 반경 바로 밖, SailingScene.resumeFromDialog) */
export function leavePort(store: Pick<GameStore, 'dispatch'>, close: () => void): Result {
  const r = store.dispatch({ type: 'LEAVE_PORT' });
  if (r.reason) return r;
  close();
  resumeSailing();
  return r;
}

/** 판정 로그를 한 판 상태 로그에 바로 붙이는 Log */
const storeLog = (store: GameStore): Log => ({
  events: [],
  push(evt) {
    const s = withLog(store.get()!, evt as LogInput);
    store.set(s);
    return s.log[s.log.length - 1] as ReturnType<Log['push']>;
  },
});

function PortCall({ store, state, close }: { store: GameStore; state: GameState; close: () => void }) {
  const port = PORT_BY_ID[state.location as Exclude<GameState['location'], 'sea'>];
  const home = port.id === 'busan';
  const entries = useRef(new Map<string, Entry>()).current;
  const rng = useRef<Rng>(createRng(state.seed + state.portCalls)).current;
  const [selected, setSelected] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [, bump] = useState(0);

  const rows = portRows(state);
  const row = rows.find((r) => r.key === selected) ?? null;
  const entryFor = (r: Row) => entries.get(`${r.dir}:${r.good}`);
  const session = (r: Row): JudgmentSession | undefined => entryFor(r)?.session;
  const pending = [...entries.values()].some((e) => !canMove(e.session).ok);

  const choose = (r: Row) => {
    setSelected(r.key);
    setBlocked(r.mode === 'blocked');
    // M2: 잠긴 줄은 툴팁 문장만. 아무것도 dispatch 하지 않는다(PRD S6 — 시도 로그 0 이 스펙)
    if (r.mode === 'blocked') return;
    if (home || entryFor(r)) return;
    const j = startJudgment({ port: port.id, good: r.good, dir: r.dir, shuffle: rng.shuffle, log: storeLog(store) });
    if (j.ok) entries.set(`${r.dir}:${r.good}`, { session: j.session, last: null });
  };

  const entry = row && entryFor(row);
  const stay = () => {
    const r = store.dispatch({ type: 'STAY_HOME' });
    if (!r.reason && r.state.stage !== 'main') close();
  };

  return (
    <>
      <div class="ribbon name"><span>{port.nameKo}</span></div>
      <div class="panel prices">
        <div class="rows">
          {rows.map((r) => {
            const s = session(r);
            const tagShown = home || (s && s.step !== 'dir');
            return (
              <button
                class={`row${r.key === selected ? ' on' : ''}${r.mode === 'blocked' ? ' off' : ''}`}
                aria-disabled={r.mode === 'blocked'}
                title={r.mode === 'blocked' ? M2_TIP : undefined}
                onClick={() => choose(r)}
              >
                {tagShown ? (
                  <span class={`tag ${r.dir === 'import' ? 'imp' : 'exp'}`}>
                    <img src={`assets/ui/icon-${r.dir}.png`} alt="" />{r.dir === 'import' ? '수입' : '수출'}
                  </span>
                ) : (
                  <span class="tag hid">?</span>
                )}
                <span class="n">{GOOD_BY_ID[r.good].nameKo}</span>
                <span class="p">{r.mode === 'blocked' ? '—' : r.mode === 'load' ? `×${r.price}` : priceLabel(s, r.price, home)}</span>
              </button>
            );
          })}
        </div>
        <RefuelPanel store={store} state={state} />
      </div>

      <div class="panel acts">
        {home && <button class="btn sm cream" onClick={stay}><span>머물기</span></button>}
        <span title={pending ? '판정을 마치세요' : undefined}>
          <button class="btn sm orange" disabled={pending} onClick={() => leavePort(store, close)}><span>출항</span></button>
        </span>
      </div>

      {home && !state.flags.towedCall && <FactoryPanel store={store} state={state} />}
      {home && row && (
        <div class="panel home-trade">
          {blocked ? <p class="warn">{M2_TIP}</p> : <TradePanel key={row.key} store={store} state={state} row={row} />}
        </div>
      )}
      {!home && row && entry && (
        <JudgmentDialog
          key={row.key}
          entry={entry}
          portName={port.nameKo}
          goodName={GOOD_BY_ID[row.good].nameKo}
          banner={row.own}
          onAnswer={() => bump((n) => n + 1)}
        >
          <TradePanel store={store} state={state} row={row} session={entry.session} />
        </JudgmentDialog>
      )}
    </>
  );
}

export function PortPanel({ store, close }: { store: GameStore; close: () => void }) {
  const [s, setS] = useState(store.get());
  useEffect(() => store.subscribe(setS), [store]);
  if (!s || s.stage !== 'main' || s.location === 'sea') return null;
  // 머물기로 입항 횟수가 바뀌면 판정·선택을 새로
  return <PortCall key={s.portCalls} store={store} state={s} close={close} />;
}

/** #ui 에 항구 화면을 붙인다: ktrade:docked 마다 열고, 출항하면 닫고 ktrade:undock(PortScene 정지)을 보낸다 */
export function mountPortUi(store: GameStore): () => void {
  const el = document.createElement('div');
  el.className = 'port-ui';
  const close = () => {
    render(null, el);
    el.remove();
    document.body.classList.remove('port-open');
    window.dispatchEvent(new CustomEvent('ktrade:undock'));
  };
  const open = () => {
    document.getElementById('ui')!.appendChild(el);
    document.body.classList.add('port-open');
    render(<PortPanel store={store} close={close} />, el);
  };
  window.addEventListener('ktrade:docked', open);
  return () => {
    window.removeEventListener('ktrade:docked', open);
    close();
  };
}
