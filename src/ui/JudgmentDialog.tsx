import type { ComponentChildren } from 'preact';
import { FEEDBACK } from '../content/feedback';
import { AXIS_LABEL, type Axis } from '../content/types';
import { answerCause, answerDir, type Dir, type JudgmentSession } from '../engine/judgment';

const DIR_LABEL: Record<Dir, string> = { import: '수입', export: '수출' };

/** 마지막 답의 결과(오답 피드백·2차 오답 정답 공개). 정답이면 null */
export type Last = {
  feedback: string;
  source: string;
  wrong: string;
  revealDir?: Dir;
  revealAxes?: Axis[];
  hint?: string;
  hintSource?: string;
} | null;

/** 판정 + 그 결과 화면 상태. 항구 한 번 입항 동안 (방향, 상품) 하나에 하나 */
export type Entry = { session: JudgmentSession; last: Last };

export function applyDir(e: Entry, answer: Dir): void {
  const r = answerDir(e.session, answer);
  e.last = r.correct ? null : { feedback: r.feedback!, source: FEEDBACK.M1.source, wrong: answer, revealDir: r.revealed };
}

export function applyCause(e: Entry, answer: Axis): void {
  const r = answerCause(e.session, answer);
  e.last = r.correct
    ? null
    : {
        feedback: r.feedback!,
        source: FEEDBACK.M4.source,
        wrong: answer,
        revealAxes: r.revealed?.axes,
        hint: r.revealed?.hintKo,
        hintSource: r.revealed?.source,
      };
}

/** 시세 칸: 판정이 끝나기 전엔 '?' (부산은 판정 없음) */
export const priceLabel = (session: JudgmentSession | undefined, price: number, home = false) =>
  home || session?.step === 'done' ? price.toLocaleString('ko-KR') : '?';

export function judgmentView(e: Entry, portName: string, goodName: string) {
  const s = e.session;
  const last = e.last;
  const dirStep = s.step === 'dir';
  return {
    badges: [
      { text: dirStep ? '① 수입/수출' : `① ${DIR_LABEL[s.dir]} ✓`, state: dirStep ? 'now' : last?.revealDir ? 'reveal' : 'ok' },
      { text: s.step === 'done' ? '② 까닭 ✓' : '② 까닭', state: s.step === 'cause' ? 'now' : s.step === 'done' ? (last?.revealAxes ? 'reveal' : 'ok') : 'wait' },
    ],
    question: dirStep
      ? s.dir === 'import' ? `${portName}에서 「${goodName}」 사 오기는?` : `${portName}에 「${goodName}」 팔기는?`
      : s.question,
    choices: dirStep
      ? (['import', 'export'] as const).map((d) => ({ id: d, label: DIR_LABEL[d], icon: `assets/ui/icon-${d}.png`, wrong: last?.wrong === d }))
      : s.options.map((o) => ({
          id: o.axis,
          label: o.label,
          icon: `assets/ui/icon-axis-${o.axis}.png`,
          wrong: last?.wrong === o.axis,
        })),
    feedback: last ? { text: last.feedback, source: last.source } : null,
    reveal: last?.revealAxes ? { text: `${last.revealAxes.map((a) => AXIS_LABEL[a]).join('·')} — ${last.hint}`, source: last.hintSource! } : null,
    done: s.step === 'done',
  };
}

type Props = {
  entry: Entry;
  portName: string;
  goodName: string;
  /** M7 경고 배너 */
  banner: string | null;
  onAnswer: () => void;
  /** 판정이 끝나면 보일 거래 칸 */
  children?: ComponentChildren;
};

export function JudgmentDialog({ entry, portName, goodName, banner, onAnswer, children }: Props) {
  const vm = judgmentView(entry, portName, goodName);
  const pick = (id: string) => {
    if (entry.session.step === 'dir') applyDir(entry, id as Dir);
    else if (entry.session.step === 'cause') applyCause(entry, id as Axis);
    onAnswer();
  };
  return (
    <div class="speech" role="dialog" aria-label="통관">
      <img class="face" src="assets/img/npc-customs-alpha.png" alt="" />
      <div class="body">
        <div class="tags">
          {vm.badges.map((b) => <span class={`tag ${b.state}`}>{b.text}</span>)}
        </div>
        {banner && <p class="warn">{banner}</p>}
        {!vm.done && <p class="q">{vm.question}</p>}
        {vm.feedback && (
          <p class="fb">
            {vm.feedback.text} <small>({vm.feedback.source})</small>
          </p>
        )}
        {vm.reveal && (
          <p class="fb">
            <b>{vm.reveal.text}</b> <small>({vm.reveal.source})</small>
          </p>
        )}
        {vm.done ? (
          children
        ) : (
          <div class={`choices n${vm.choices.length}`}>
            {vm.choices.map((c) => (
              <button class={`btn cream tile${c.wrong ? ' wrong' : ''}`} disabled={c.wrong} onClick={() => pick(c.id)}>
                <span><img src={c.icon} alt="" />{c.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
