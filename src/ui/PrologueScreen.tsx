import { useEffect, useState } from 'preact/hooks';
import { PROLOGUE_STEPS } from '../content/prologue';
import type { Action } from '../engine/state';
import type { LogInput } from '../engine/types';
import { MiniSim, type SimChoice } from './MiniSim';
import './prologue.css';

/** 프롤로그 화면 순서. 4분 예산: 3화면 (≤4) */
export const PROLOGUE_FLOW = ['byeokran', 'minisim', 'busan'] as const;
export type PrologueStage = (typeof PROLOGUE_FLOW)[number];

const STEP = Object.fromEntries(PROLOGUE_STEPS.map((s) => [s.id, s]));
type Deal = 'buy-silk' | 'sell-ginseng';

/** 거래를 고른 뒤 용어 카드: 고른 쪽(수입/수출) 먼저, 나머지 하나, 무역. 고르기 전엔 없음 */
export function termCards(deal: Deal | null) {
  if (!deal) return [];
  const other: Deal = deal === 'buy-silk' ? 'sell-ginseng' : 'buy-silk';
  const kind = (d: Deal) => (d === 'buy-silk' ? 'import' : 'export');
  return [
    { ...STEP[deal].term!, kind: kind(deal) },
    { ...STEP[other].term!, kind: kind(other) },
    { ...STEP.trade.term!, kind: '' },
  ];
}

type Props = { dispatch: (a: Action) => void; onLog: (e: LogInput) => void; onDone: () => void };

export function PrologueScreen({ dispatch, onLog, onDone }: Props) {
  const [i, setI] = useState(0);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [sim, setSim] = useState<SimChoice | null>(null);
  const stage = PROLOGUE_FLOW[i];
  useEffect(() => { onLog({ type: 'screen', name: `prologue-${stage}` }); }, [stage]);
  const next = () => setI((n) => Math.min(n + 1, PROLOGUE_FLOW.length - 1));
  const start = () => { dispatch({ type: 'START_MAIN' }); onDone(); };

  if (stage === 'byeokran') {
    return (
      <div class="pg-root">
        <img class="pg-art" src="assets/img/scene-byeokran.png" alt="" />
        <div class="pg-speech">
          <div class="pg-face"><img src="assets/img/npc-manager-alpha.png" alt="" /></div>
          <div class="pg-body">
            <p class="pg-text">{deal ? STEP[deal].textKo : STEP.intro.textKo}</p>
            {deal && <div class="pg-terms">
              {termCards(deal).map((t) => <span class={`pg-term ${t.kind}`}><b>{t.wordKo}</b>{t.defKo}</span>)}
            </div>}
            <div class="pg-acts">
              {!deal && <>
                <button type="button" class="pg-btn orange" onClick={() => setDeal('buy-silk')}>비단을 산다</button>
                <button type="button" class="pg-btn orange" onClick={() => setDeal('sell-ginseng')}>인삼을 판다</button>
              </>}
              {deal && <button type="button" class="pg-btn blue" onClick={next}>다음</button>}
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (stage === 'minisim') {
    return (
      <div class="pg-root">
        <img class="pg-art" src="assets/img/key-title.png" alt="" />
        <div class="pg-panel">
          <h2 class="pg-title">어느 쪽이 더 많을까?</h2>
          <MiniSim picked={sim} onPick={setSim} />
          {sim && <button type="button" class="pg-btn blue" onClick={next}>다음</button>}
        </div>
      </div>
    );
  }
  return (
    <div class="pg-root">
      <img class="pg-art" src="assets/img/port-busan.png" alt="" />
      <div class="pg-speech">
        <div class="pg-face"><img src="assets/img/npc-customs-alpha.png" alt="" /></div>
        <div class="pg-body">
          <p class="pg-text">부산항입니다. 6번 입항해 무역을 해 봅시다.</p>
          <div class="pg-acts"><button type="button" class="pg-btn blue" onClick={start}>출항</button></div>
        </div>
      </div>
    </div>
  );
}
