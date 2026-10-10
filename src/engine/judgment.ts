import { AXES, AXIS_LABEL, type Axis, type GoodId, type PortId } from '../content/types';
import { PORT_BY_ID } from '../content/ports';
import { GOOD_BY_ID } from '../content/goods';
import { FEEDBACK, shortageOption, whyBuys, whySells } from '../content/feedback';
import type { Log } from './log';

/** 한국 회사 기준: 외국 항구에서 사면 import, 팔면 export (싱가포르 중계도 거래마다 이 둘 중 하나) */
export type Dir = 'import' | 'export';
export type Shuffle = <T>(xs: readonly T[]) => T[];

export type JudgmentSession = {
  port: PortId;
  good: GoodId;
  dir: Dir;
  step: 'dir' | 'cause' | 'done';
  dirAttempts: number;
  causeAttempts: number;
  /** 어느 단계든 2차 시도까지 갔으면 true → 수수료 10% */
  retried: boolean;
  /** 까닭 2차 오답 → 통관 지연 */
  delay: boolean;
  correctCauses: Axis[];
  questionKey: 'why_sells' | 'why_buys';
  question: string;
  /** 5축, 주입된 seed 셔플 순서 */
  options: { axis: Axis; label: string }[];
  log: Log;
};

export type AnswerResult<A> = {
  correct: boolean;
  attempt: 1 | 2;
  /** 오답일 때 교과서 문장 */
  feedback?: string;
  /** 2차 오답일 때 정답 공개 */
  revealed?: A;
};

export const MAX_ATTEMPTS = 2;
export const RETRY_FEE_RATE = 0.1;

export function startJudgment(args: {
  port: PortId;
  good: GoodId;
  dir: Dir;
  shuffle: Shuffle;
  log: Log;
}): { ok: true; session: JudgmentSession } | { ok: false; reason: 'home_port' | 'no_shortage_axis' } {
  const { port, good, dir, shuffle, log } = args;
  if (port === 'busan') return { ok: false, reason: 'home_port' };
  const p = PORT_BY_ID[port];
  let correctCauses: Axis[];
  if (port === 'singapore') correctCauses = ['geo'];
  else if (dir === 'import') correctCauses = p.correctCauses;
  else {
    const s = p.shortages.find((x) => x.good === good);
    // 결핍 축이 지정되지 않은 상품을 파는 경우 — 콘텐츠에 정답이 없어 발명하지 않는다
    if (!s) return { ok: false, reason: 'no_shortage_axis' };
    correctCauses = [s.shortageAxis];
  }
  const goodName = GOOD_BY_ID[good].nameKo;
  return {
    ok: true,
    session: {
      port, good, dir,
      step: 'dir',
      dirAttempts: 0,
      causeAttempts: 0,
      retried: false,
      delay: false,
      correctCauses,
      questionKey: dir === 'import' ? 'why_sells' : 'why_buys',
      question: dir === 'import' ? whySells(p.nameKo, goodName) : whyBuys(p.nameKo, goodName),
      options: shuffle(AXES).map((axis) => ({
        axis,
        label: dir === 'import' ? AXIS_LABEL[axis] : shortageOption(axis),
      })),
      log,
    },
  };
}

export function answerDir(s: JudgmentSession, answer: Dir): AnswerResult<Dir> {
  if (s.step !== 'dir') throw new Error(`answerDir: step is ${s.step}`);
  const attempt = ++s.dirAttempts as 1 | 2;
  const correct = answer === s.dir;
  s.log.push({ type: 'judge_dir', port: s.port, good: s.good, answer, correct, attempt });
  if (attempt === 2) s.retried = true;
  if (correct) {
    s.step = 'cause';
    return { correct, attempt };
  }
  if (attempt < MAX_ATTEMPTS) return { correct, attempt, feedback: FEEDBACK.M1.textKo };
  s.step = 'cause';
  return { correct, attempt, feedback: FEEDBACK.M1.textKo, revealed: s.dir };
}

export function answerCause(
  s: JudgmentSession,
  answer: Axis,
): AnswerResult<{ axes: Axis[]; hintKo: string; source: string }> {
  if (s.step !== 'cause') throw new Error(`answerCause: step is ${s.step}`);
  const attempt = ++s.causeAttempts as 1 | 2;
  const correct = s.correctCauses.includes(answer);
  s.log.push({ type: 'judge_cause', port: s.port, good: s.good, answer, correct, attempt });
  if (attempt === 2) s.retried = true;
  if (correct) {
    s.step = 'done';
    return { correct, attempt };
  }
  if (attempt < MAX_ATTEMPTS) return { correct, attempt, feedback: FEEDBACK.M4.textKo };
  s.step = 'done';
  s.delay = true;
  const p = PORT_BY_ID[s.port];
  return {
    correct,
    attempt,
    feedback: FEEDBACK.M4.textKo,
    revealed: { axes: s.correctCauses, hintKo: p.hintKo, source: p.source },
  };
}

/** 판정이 끝난 뒤의 통관 결과. 거래는 언제나 열린다 */
export function judgmentResult(s: JudgmentSession): { feeRate: 0 | 0.1; delay: boolean } {
  if (s.step !== 'done') throw new Error('judgment not complete');
  return { feeRate: s.retried ? RETRY_FEE_RATE : 0, delay: s.delay };
}

/** 통관 수수료 = 거래액 x feeRate */
export const customsFee = (tradeValue: number, s: JudgmentSession) =>
  Math.round(tradeValue * judgmentResult(s).feeRate);

/** 통관 지연이면 그 입항의 거래 칸 -1, 최소 1 */
export const tradeSlots = (slots: number, s: JudgmentSession) =>
  Math.max(1, slots - (judgmentResult(s).delay ? 1 : 0));

/** 시세는 판정 완료 뒤에만 */
export function revealPrices<T>(s: JudgmentSession, prices: () => T): T {
  if (s.step !== 'done') throw new Error('revealPrices: judgment not complete');
  return prices();
}

export function canMove(s: JudgmentSession | null): { ok: true } | { ok: false; reason: 'judgment_pending' } {
  return s && s.step !== 'done' ? { ok: false, reason: 'judgment_pending' } : { ok: true };
}

/** M7: 한국 특산품을 외국에서 사 오려 할 때의 경고 문장, 아니면 null */
export function flagOwnSpecialty(port: PortId, good: GoodId): string | null {
  return port !== 'busan' && PORT_BY_ID.busan.specialties.includes(good) ? FEEDBACK.M7.textKo : null;
}
