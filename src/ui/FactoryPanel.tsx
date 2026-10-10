import { useRef, useState } from 'preact/hooks';
import { GOOD_BY_ID } from '../content/goods';
import { RECIPES } from '../content/recipes';
import { qtyOf } from '../engine/economy';
import type { GameState } from '../engine/types';
import type { GameStore } from '../game/SailingScene';
import { createGuard } from './TradePanel';

/** 레시피 3줄. 입력은 창고 + 배(엔진 process 와 같은 잣대). 모자란 입력은 lack */
export function recipeView(state: GameState) {
  return RECIPES.map((r) => {
    const inputs = r.inputs.map((i) => {
      const have = qtyOf(state.depot, i.good) + qtyOf(state.cargo, i.good);
      return { good: i.good, name: GOOD_BY_ID[i.good].nameKo, qty: i.qty, lack: have < i.qty };
    });
    return { id: r.id, inputs, output: r.output, outputName: GOOD_BY_ID[r.output].nameKo, ok: inputs.every((i) => !i.lack) };
  });
}

const Chip = ({ good, name, qty, lack }: { good: keyof typeof GOOD_BY_ID; name: string; qty: number; lack?: boolean }) => (
  <span class={`chip${lack ? ' lack' : ''}`}>
    <img src={GOOD_BY_ID[good].icon} alt="" />
    {name} ×{qty}
  </span>
);

export function FactoryPanel({ store, state }: { store: GameStore; state: GameState }) {
  const [busy, setBusy] = useState(false);
  const guard = useRef(createGuard()).current;
  const run = (recipe: (typeof RECIPES)[number]['id']) => {
    if (!guard.run(() => store.dispatch({ type: 'PROCESS', recipe }))) return;
    setBusy(true);
    setTimeout(() => {
      guard.release();
      setBusy(false);
    }, 300);
  };
  return (
    <div class="panel factory">
      <div class="head">
        <div class="ribbon"><span>부산 공장 Lv.{state.factoryLevel}</span></div>
        <span class="badge">고용 {state.employment}</span>
      </div>
      {recipeView(state).map((r) => (
        <div class={`recipe${r.ok ? '' : ' off'}`}>
          <span class="ins">
            {r.inputs.map((i, k) => (
              <>
                {k > 0 && ' + '}
                <Chip {...i} />
              </>
            ))}
          </span>
          <span class="arrow">→</span>
          <span><Chip good={r.output} name={r.outputName} qty={1} /></span>
          <button class={`btn sm${r.ok ? '' : ' cream'}`} disabled={!r.ok || busy} onClick={() => run(r.id)}>
            <span>{r.ok ? '가공' : '재료 부족'}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
