import { MINI_SIM } from '../content/prologue';
import './prologue.css';

export type SimChoice = 'each' | 'trade';

/** ㉮/㉯ 미니 시뮬 결과. 교환 쪽 합이 항상 더 크다 */
export function miniSimResult(choice: SimChoice): { a: number; b: number; total: number } {
  const r = choice === 'each' ? MINI_SIM.eachMakes : MINI_SIM.specializeAndTrade;
  return { a: r.a, b: r.b, total: r.a + r.b };
}

type Props = { picked: SimChoice | null; onPick: (c: SimChoice) => void };

const LABEL: Record<SimChoice, string> = { each: '각자 다 만들기', trade: '잘 만드는 것만 만들고 바꾸기' };

export function MiniSim({ picked, onPick }: Props) {
  return (
    <div class="pg-sim">
      {(['each', 'trade'] as const).map((c) => {
        const r = miniSimResult(c);
        return (
          <div key={c} class="pg-sim-col">
            <button type="button" class={`pg-btn${picked === c ? ' on' : ''}`} onClick={() => onPick(c)}>{LABEL[c]}</button>
            <div class={`pg-sim-num${c === 'trade' ? ' big' : ''}`}>
              {picked ? <>㉮ <b>{r.a}</b> + ㉯ <b>{r.b}</b> = <b>{r.total}</b></> : '?'}
            </div>
          </div>
        );
      })}
    </div>
  );
}
