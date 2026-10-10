import { AXES, AXIS_LABEL, type Axis, type GoodId, type PortId } from '../content/types';
import { PORT_BY_ID } from '../content/ports';
import { GOOD_BY_ID } from '../content/goods';
import { FEEDBACK, shortageOption, whyBuys, whyRelays, whySells } from '../content/feedback';
import type { Log } from './log';
import type { LogEvent } from './types';

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
  /** 방향·까닭 어느 쪽이든 2차 오답 → 통관 지연(그 입항 전체, tradeSlots) */
  delay: boolean;
  correctCauses: Axis[];
  questionKey: 'why_sells' | 'why_buys' | 'why_relays';
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
  // 싱가포르는 두 방향 모두 중계 질문, 선택지는 축 이름 그대로(「…이 부족해서」 꼴이 아니다)
  const relay = port === 'singapore';
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
      questionKey: relay ? 'why_relays' : dir === 'import' ? 'why_sells' : 'why_buys',
      question: relay ? whyRelays(p.nameKo, goodName) : dir === 'import' ? whySells(p.nameKo, goodName) : whyBuys(p.nameKo, goodName),
      options: shuffle(AXES).map((axis) => ({
        axis,
        label: relay || dir === 'import' ? AXIS_LABEL[axis] : shortageOption(axis),
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
  s.delay = true;
  return { correct, attempt, feedback: FEEDBACK.M1.textKo, revealed: s.dir };
}

export function answerCause(
  s: JudgmentSession,
  answer: Axis,
): AnswerResult<{ axes: Axis[]; hintKo: string; source: string }> {
  if (s.step !== 'cause') throw new Error(`answerCause: step is ${s.step}`);
  const attempt = ++s.causeAttempts as 1 | 2;
  const correct = s.correctCauses.includes(answer);
  s.log.push({ type: 'judge_cause', port: s.port, good: s.good, answer, correct, attempt, dir: s.dir });
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

/** 새로 고침·이어하기 복원: 마지막 port_call 뒤 judge_dir/judge_cause 를 로그 순서대로 재생해 이번 입항의 판정 세션을 되살린다.
 *  세션은 첫 judge_dir 순서대로 startJudgment(같은 seed rng 소비 순서), 답은 다시 로그하지 않는다. 키 = `${dir}:${good}` (PortPanel entries 와 같음).
 *  까닭 로그의 dir 로 귀속(구 저장본은 휴리스틱) */
export function restoreSessions(events: readonly LogEvent[], shuffle: Shuffle, log: Log): Map<string, JudgmentSession> {
  const sessions = new Map<string, JudgmentSession>();
  let from = 0;
  events.forEach((e, i) => { if (e.type === 'port_call') from = i + 1; });
  const quiet: Log = { events: [], push: (e) => e as ReturnType<Log['push']> };
  for (const e of events.slice(from)) {
    if (e.type === 'judge_dir') {
      const dir: Dir = e.correct ? e.answer : e.answer === 'import' ? 'export' : 'import';
      const key = `${dir}:${e.good}`;
      if (!sessions.has(key)) {
        const j = startJudgment({ port: e.port, good: e.good, dir, shuffle, log: quiet });
        if (!j.ok) continue;
        sessions.set(key, j.session);
      }
      const s = sessions.get(key)!;
      if (s.step === 'dir') answerDir(s, e.answer);
    } else if (e.type === 'judge_cause') {
      // dir 가 있으면 그 세션에 직접 귀속, 없는 구 저장본만 같은 상품의 까닭 단계 세션 중 가장 늦게 연 것
      const s = e.dir
        ? sessions.get(`${e.dir}:${e.good}`)
        : [...sessions.values()].reverse().find((x) => x.good === e.good && x.step === 'cause');
      if (s?.step === 'cause') answerCause(s, e.answer);
    }
  }
  for (const s of sessions.values()) s.log = log;
  return sessions;
}

/** 판정이 끝난 뒤의 통관 결과. 거래는 언제나 열린다 */
export function judgmentResult(s: JudgmentSession): { feeRate: 0 | 0.1; delay: boolean } {
  if (s.step !== 'done') throw new Error('judgment not complete');
  return { feeRate: s.retried ? RETRY_FEE_RATE : 0, delay: s.delay };
}

/** 통관 수수료 = 거래액 x feeRate */
export const customsFee = (tradeValue: number, s: JudgmentSession) =>
  Math.round(tradeValue * judgmentResult(s).feeRate);

/** 통관 지연은 그 입항(턴) 전체: 그 입항의 판정 중 하나라도 delay 면 거래 칸 -1, 최소 1 */
export const turnDelay = (sessions: Iterable<JudgmentSession>) => [...sessions].some((s) => s.delay);
export const tradeSlots = (slots: number, delay: boolean) => Math.max(1, slots - (delay ? 1 : 0));

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
