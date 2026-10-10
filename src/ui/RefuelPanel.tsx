import { PORT_BY_ID } from '../content/ports';
import { TANK, refuelFare } from '../engine/economy';
import type { GameState } from '../engine/types';
import type { GameStore } from '../game/SailingScene';

export const TIP_FULL = '연료가 가득합니다';
export const TIP_NO_CASH = '코인이 모자랍니다. 연료가 바닥나면 예인선이 가까운 항구로 끌어 갑니다';

/** 급유 = 그 항구 요금 정액으로 만탱크(엔진 refuel). 탱크가 차 있거나 코인이 모자라면 잠금 */
export function refuelView(state: GameState) {
  const fare = state.location === 'sea' ? 0 : refuelFare(state, PORT_BY_ID[state.location]);
  const tip = state.fuel >= TANK ? TIP_FULL : state.cash < fare ? TIP_NO_CASH : null;
  return { fare, disabled: tip !== null, tip };
}

export function RefuelPanel({ store, state }: { store: GameStore; state: GameState }) {
  const vm = refuelView(state);
  return (
    <div class="row">
      <img class="ic" src="assets/ui/icon-fuel.png" alt="" />
      <span class="n">급유</span>
      <span class="p">{vm.fare}</span>
      <span title={vm.tip ?? undefined}>
        <button class="btn sm cream" disabled={vm.disabled} onClick={() => store.dispatch({ type: 'REFUEL' })}>
          <span>급유</span>
        </button>
      </span>
      {vm.tip === TIP_NO_CASH && <small class="tip">{vm.tip}</small>}
    </div>
  );
}
