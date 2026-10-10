import { useState } from 'preact/hooks';
import { NICKNAMES } from '../content/nicknames';
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

const SEATS = Array.from({ length: 40 }, (_, i) => String(i + 1));

/** 닉네임·번호 둘 다 골라야 시작 */
export const canStart = (nickname: string, seat: string) => nickname !== '' && seat !== '';

type Props = { hasSave: boolean; onStart: (state: GameState) => void; onContinue: () => void; onTeacher: () => void };

export function TitleScreen({ hasSave, onStart, onContinue, onTeacher }: Props) {
  const [nickname, setNickname] = useState('');
  const [seat, setSeat] = useState('');
  const ready = canStart(nickname, seat);
  const start = () => ready && onStart(newGame(seedFrom(window.location.search), { nickname, seat }));
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
          <select aria-label="닉네임" value={nickname} onChange={(e) => setNickname(e.currentTarget.value)}>
            <option value="" disabled>닉네임</option>
            {NICKNAMES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <select aria-label="번호" value={seat} onChange={(e) => setSeat(e.currentTarget.value)}>
            <option value="" disabled>번호</option>
            {SEATS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <button class="btn lg" disabled={!ready} onClick={start}><span>시작</span></button>
        <button class="btn cream" disabled={!hasSave} onClick={onContinue}><span>이어하기</span></button>
      </div>
    </>
  );
}
