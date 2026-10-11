import { useState } from 'preact/hooks';
import { MINDMAP_SLOTS, isAccepted, normalize, slotOptions } from '../content/mindmap';
import type { LogEvent, LogInput } from '../engine/types';
import './epilogue.css';

export type SlotScore = { id: string; answer: string; correct: boolean; reveal: string | null };

/** 순수 채점: 정오는 isAccepted(normalize 적용), 틀린 칸은 첫 정답을 공개 */
export function scoreMindmap(answers: Record<string, string>): SlotScore[] {
  return MINDMAP_SLOTS.map((s) => {
    const answer = answers[s.id] ?? '';
    const correct = normalize(answer) !== '' && isAccepted(s.id, answer);
    return { id: s.id, answer, correct, reveal: correct ? null : s.accepted[0] };
  });
}

/** 저장 로그에서 복원: 칸별 첫 mindmap 로그 = 답. 5칸 모두 있으면 채점·정답 공개 상태로 잠금 */
export function mindInit(log: LogEvent[]): { answers: Record<string, string>; scores: SlotScore[] | null } {
  const first: Record<string, { answer: string; correct: boolean }> = {};
  for (const e of log) if (e.type === 'mindmap' && !(e.slot in first)) first[e.slot] = e;
  const answers = Object.fromEntries(Object.entries(first).map(([k, v]) => [k, v.answer]));
  if (!MINDMAP_SLOTS.every((s) => s.id in first)) return { answers, scores: null };
  const scores = MINDMAP_SLOTS.map((s) => {
    const { answer, correct } = first[s.id];
    return { id: s.id, answer, correct, reveal: correct ? null : s.accepted[0] };
  });
  return { answers, scores };
}

type Props = { seed: number; log: LogEvent[]; onLog: (e: LogInput) => void; onDone: () => void };

export function MindmapForm({ seed, log, onLog, onDone }: Props) {
  const [init] = useState(() => mindInit(log));
  const [answers, setAnswers] = useState<Record<string, string>>(init.answers);
  const [scores, setScores] = useState<SlotScore[] | null>(init.scores);
  const submit = () => {
    if (scores) return;
    const s = scoreMindmap(answers);
    for (const x of s) onLog({ type: 'mindmap', slot: x.id, answer: x.answer, correct: x.correct });
    setScores(s);
  };
  return (
    <>
      <h2 class="ep-h"><img src="assets/ui/icon-map.png" alt="" />생각 그물</h2>
      <div class="ep-mind">
        {MINDMAP_SLOTS.map((s, i) => {
          const sc = scores?.[i];
          return (
            <div key={s.id} class={`ep-slot${sc ? (sc.correct ? ' ok' : ' wrong') : ''}`}>
              <span>{s.labelKo}</span>
              <div role="radiogroup" aria-label={s.labelKo} class="ep-chips col">
                {slotOptions(seed, i).map((o) => (
                  <label key={o} class="ep-chip">
                    <input type="radio" name={`mind-${s.id}`} checked={answers[s.id] === o} disabled={!!scores}
                      onChange={() => setAnswers({ ...answers, [s.id]: o })} />
                    {o}
                  </label>
                ))}
              </div>
              {sc && !sc.correct && <span class="ep-reveal">{sc.reveal}</span>}
            </div>
          );
        })}
      </div>
      <div class="ep-acts">
        {!scores && <button type="button" class="ep-btn" disabled={MINDMAP_SLOTS.some((s) => !answers[s.id])} onClick={submit}>확인</button>}
        {scores && <button type="button" class="ep-btn orange" onClick={onDone}>결과 보기</button>}
      </div>
    </>
  );
}
