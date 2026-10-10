import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { GOOD_BY_ID } from '../content/goods';
import type { GameEvent } from '../content/types';
import { CARGO_CAP, PORT_CALLS, TANK } from '../engine/economy';
import type { GameState } from '../engine/types';
import { requestDock, type GameStore } from '../game/SailingScene';
import { nearestPortWithin } from '../game/ports-layout';
import { isMuted, setMuted } from '../audio/audio';
import './hud.css';

const icon = (name: string) => `assets/ui/icon-${name}.png`;

/** 작은 크림 버튼(타이틀·HUD). 음소거면 「소리」에 줄이 그어진다(상태는 localStorage 'ktrade.mute') */
export function MuteButton() {
  const [muted, set] = useState(isMuted);
  const toggle = () => {
    setMuted(!muted);
    set(!muted);
  };
  return (
    <button class={`btn sm cream mute${muted ? ' off' : ''}`} aria-pressed={muted} aria-label="소리 끄기" onClick={toggle}>
      <span>소리</span>
    </button>
  );
}

export function Hud({ store }: { store: GameStore }) {
  const [s, setS] = useState<GameState | null>(store.get());
  const [radio, setRadio] = useState<GameEvent | null>(null);
  useEffect(() => store.subscribe(setS), [store]);
  useEffect(() => {
    const on = (e: Event) => setRadio((e as CustomEvent<{ event: GameEvent }>).detail.event);
    window.addEventListener('ktrade:event', on);
    return () => window.removeEventListener('ktrade:event', on);
  }, []);
  if (!s) return null;

  const slots = s.cargo.flatMap((i) => Array<string>(i.qty).fill(GOOD_BY_ID[i.good].nameKo));
  const port = s.stage === 'main' && s.location === 'sea' ? nearestPortWithin(s.shipPos) : null;

  return (
    <>
      <div class="panel hud">
        <span class="s"><img src={icon('coin')} alt="코인" /><b>{s.cash.toLocaleString('ko-KR')}</b></span>
        <span class="s"><img src={icon('cargo')} alt="적재" /><b>{slots.length}/{CARGO_CAP}</b></span>
        <span class="s"><img src={icon('anchor')} alt="입항" /><b>{s.portCalls}/{PORT_CALLS}</b></span>
        <span class="s">
          <img src={icon('fuel')} alt="연료" />
          <span class="gauge" role="meter" aria-label="연료" aria-valuemin={0} aria-valuemax={TANK} aria-valuenow={Math.round(s.fuel)}>
            <i style={{ width: `${Math.max(0, Math.min(100, (s.fuel / TANK) * 100))}%` }} />
          </span>
        </span>
        <span class="spacer" />
        <MuteButton />
        <button class="btn sm cream" onClick={() => window.dispatchEvent(new CustomEvent('ktrade:log'))}><span>일지</span></button>
      </div>
      {radio && !s.eventsDrawn.includes(radio.id) && (
        <div class="panel radio">
          <span class="tag imp"><img src={icon('speech')} alt="" />무전</span>
          <h2>{radio.titleKo}</h2>
        </div>
      )}
      {port && (
        <div class="panel prompt">
          <div class="name"><img src={icon('anchor')} alt="" />{port.nameKo}</div>
          <button class="btn orange lg" onClick={requestDock}><span>입항</span></button>
        </div>
      )}
      <div class="panel cargo">
        <div class="slots">
          {Array.from({ length: CARGO_CAP }, (_, i) => (
            <div class={slots[i] ? 'slot full' : 'slot'}>{slots[i] ?? ''}</div>
          ))}
        </div>
      </div>
    </>
  );
}

/** #ui 안에 항해 HUD 를 붙인다. 떼는 함수를 돌려준다 */
export function mountSailingUi(store: GameStore): () => void {
  const el = document.createElement('div');
  el.className = 'sail-ui';
  document.getElementById('ui')!.appendChild(el);
  render(<Hud store={store} />, el);
  return () => {
    render(null, el);
    el.remove();
  };
}
