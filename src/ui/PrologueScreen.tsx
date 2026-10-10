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

type Props = { dispatch: (a: Action) => void; onLog: (e: LogInput) => void; onDone: () => void };

export function PrologueScreen({ dispatch, onLog, onDone }: Props) {
  const [i, setI] = useState(0);
  const [deal, setDeal] = useState<'buy-silk' | 'sell-ginseng' | null>(null);
  const [sim, setSim] = useState<SimChoice | null>(null);
  const stage = PROLOGUE_FLOW[i];
  useEffect(() => { onLog({ type: 'screen', name: `prologue-${stage}` }); }, [stage]);
  const next = () => setI((n) => Math.min(n + 1, PROLOGUE_FLOW.length - 1));
  const start = () => { dispatch({ type: 'START_MAIN' }); onDone(); };

  if (stage === 'byeokran') {
    const term = deal ? STEP[deal].term! : null;
    return (
      <div class="pg-root">
        <img class="pg-art" src="assets/img/scene-byeokran.png" alt="" />
        <div class="pg-speech">
          <div class="pg-face"><img src="assets/img/npc-manager-alpha.png" alt="" /></div>
          <div class="pg-body">
            <p class="pg-text">{deal ? STEP[deal].textKo : STEP.intro.textKo}</p>
            {term && <div class="pg-terms">
              <span class={`pg-term ${deal === 'buy-silk' ? 'import' : 'export'}`}><b>{term.wordKo}</b>{term.defKo}</span>
              <span class="pg-term"><b>{STEP.trade.term!.wordKo}</b>{STEP.trade.term!.defKo}</span>
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
