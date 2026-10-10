import { useState } from 'preact/hooks';
import { newGame } from '../engine/state';
import type { GameState } from '../engine/types';
import { MuteButton } from './Hud';
import './hud.css';
import './title.css';

/** ?seed=123 이 있으면 그 값, 없으면 지금 시각 */
export function seedFrom(search: string): number {
  const v = Number(new URLSearchParams(search).get('seed'));
  return Number.isInteger(v) && v > 0 ? v : Date.now();
}

const seatOk = (v: string) => /^\d{1,2}$/.test(v) && +v >= 1 && +v <= 40;

type Props = { hasSave: boolean; onStart: (state: GameState) => void; onContinue: () => void; onTeacher: () => void };

export function TitleScreen({ hasSave, onStart, onContinue, onTeacher }: Props) {
  const [nickname, setNickname] = useState('');
  const [seat, setSeat] = useState('');
  const ready = nickname.trim() !== '' && seatOk(seat);
  const start = () => ready && onStart(newGame(seedFrom(window.location.search), { nickname: nickname.trim(), seat }));
  return (
    <>
      <img class="art" src="assets/img/key-title.png" alt="" />
      <img class="logo" src="assets/ui/logo.png" alt="K-무역상" />
      <div class="corner">
        <MuteButton />
        <button class="btn sm cream" onClick={onTeacher}><span>교사용</span></button>
      </div>
      <div class="panel start">
        <div class="field">
          <input placeholder="닉네임" aria-label="닉네임" value={nickname} onInput={(e) => setNickname(e.currentTarget.value)} />
          <input
            placeholder="번호"
            aria-label="번호"
            inputMode="numeric"
            maxLength={2}
            value={seat}
            onInput={(e) => {
              const v = e.currentTarget.value.replace(/\D/g, '').slice(0, 2);
              e.currentTarget.value = v;
              setSeat(v);
            }}
          />
        </div>
        <button class="btn lg" disabled={!ready} onClick={start}><span>시작</span></button>
        <button class="btn cream" disabled={!hasSave} onClick={onContinue}><span>이어하기</span></button>
      </div>
    </>
  );
}
