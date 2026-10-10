import { AXIS_LABEL, type PortId } from '../content/types';
import { GOOD_BY_ID } from '../content/goods';
import { PORT_BY_ID } from '../content/ports';
import type { GameState, LogEvent } from './types';

/* PRD §4.6 등급·§7 판정식 수치. scripts/check-result.mjs 가 같은 값을 따로 들고 있다(테스트로 동기 확인) */
export const THRESHOLDS = {
  S1_DIR_ACC: 0.9,
  S1_LAST_N: 5,
  S2_CAUSE_ACC: 0.7,
  /** 전반 = 입항 1~3, 후반 = 입항 4~6 */
  S2_HALF: 3,
  S3_MIN_ROWS: 6,
  S5_SLOTS: 5,
  S5_MIN_CORRECT: 4,
  S6_GOODS: ['crude-oil', 'natural-gas'],
  S7_MAX_AUTARKY: 1,
  S8_MAX_SCREENS: 35,
  S8_MAX_JUDGE_DIALOGS: 14,
  A_CAUSE_ACC: 0.8,
  A_ROWS: 6,
  A_KEYWORDS: 2,
  B_CAUSE_ACC: 0.6,
  B_ROWS: 4,
} as const;

/** 에필로그 ② 비교 막대 화면의 screen 로그 이름(S7). UI 가 이 이름으로 남긴다 */
export const EPILOGUE_COMPARE_SCREEN = 'epilogue-compare';
export const KOREA = '대한민국';

/** S4. PRD 의 /(다르|차이)/ 에 활용형(다른·다름·달라)을 더했다 — '달라서' 가 통과해야 한다(계약 edge case) */
export const SENTENCE_KEYWORDS = /(자연환경|자원|자본|기술|지리)/g;
export const SENTENCE_DIFF = /(다르|다른|다름|달라|차이)/;

export type LedgerRow = { portCall: number; exporter: string; good: string; importer: string; cause: string };

const place = (p: PortId) => (p === 'busan' ? KOREA : PORT_BY_ID[p].nameKo);

/** 무역 일지: trade 로그 → (입항, 수출국, 물자·서비스, 수입국, 까닭). 부산에서 되판 것(국내 거래)·같은 나라끼리는 행이 아니다 */
export function buildLedger(state: Pick<GameState, 'log'>): LedgerRow[] {
  const rows: LedgerRow[] = [];
  const seen = new Set<string>();
  let here: PortId | 'sea' = 'busan';
  let portCall = 0;
  let causes: Record<string, string> = {};
  for (const e of state.log) {
    if (e.type === 'port_call' || e.type === 'towed') {
      here = e.type === 'port_call' ? e.port : e.to;
      if (e.type === 'port_call') portCall = e.turn;
      causes = {};
    } else if (e.type === 'depart') here = 'sea';
    else if (e.type === 'judge_cause') causes[e.good] = `${AXIS_LABEL[e.answer]} ${e.correct ? '✓' : '✕'}`;
    else if (e.type === 'trade' && here !== 'busan') {
      const row = { portCall, exporter: place(e.from), good: GOOD_BY_ID[e.good].nameKo, importer: place(e.to), cause: causes[e.good] ?? '' };
      const key = `${row.portCall}|${row.exporter}|${row.good}|${row.importer}`;
      if (row.exporter === row.importer || seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }
  return rows;
}

const complete = (r: LedgerRow) => !!(r.exporter && r.good && r.importer);
const ratio = (n: number, d: number) => (d ? n / d : 0);
const keywordCount = (text: string) => new Set(Array.from(text.matchAll(SENTENCE_KEYWORDS), (m) => m[1])).size;
const lastSentence = (log: LogEvent[]) => {
  const s = log.filter((e) => e.type === 'sentence');
  return s.length ? (s[s.length - 1] as Extract<LogEvent, { type: 'sentence' }>).text : '';
};
const firstTryCause = (log: LogEvent[]) => {
  const first = log.filter((e): e is Extract<LogEvent, { type: 'judge_cause' }> => e.type === 'judge_cause' && e.attempt === 1);
  return { correct: first.filter((e) => e.correct).length, total: first.length };
};

export type Grade = {
  grade: 'A' | 'B' | 'C';
  nameKo: '대상단' | '상단' | '견습';
  causeAccuracy: number;
  ledgerRows: number;
  sentenceOk: boolean;
};

/** PRD §4.6. 자산(cash)은 보지 않는다 — 판정·일지·문장으로만 잠근다 */
export function computeGrade(state: Pick<GameState, 'log'>): Grade {
  const fc = firstTryCause(state.log);
  const causeAccuracy = ratio(fc.correct, fc.total);
  const ledgerRows = buildLedger(state).filter(complete).length;
  const text = lastSentence(state.log).trim();
  const sentenceOk = keywordCount(text) >= THRESHOLDS.A_KEYWORDS;
  const T = THRESHOLDS;
  if (causeAccuracy >= T.A_CAUSE_ACC && ledgerRows >= T.A_ROWS && sentenceOk) return { grade: 'A', nameKo: '대상단', causeAccuracy, ledgerRows, sentenceOk };
  if (causeAccuracy >= T.B_CAUSE_ACC && ledgerRows >= T.B_ROWS && text !== '') return { grade: 'B', nameKo: '상단', causeAccuracy, ledgerRows, sentenceOk };
  return { grade: 'C', nameKo: '견습', causeAccuracy, ledgerRows, sentenceOk };
}

export type Invariants = { cashStart: number; maxRefuel: number; portCalls: number; tank: number; maxLegFuel: number };
export type ResultJson = { log: LogEvent[]; ledger: LedgerRow[]; invariants: Invariants };
export type Check = { pass: boolean; value: unknown; detail: string };
export type Checks = Record<'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8' | 'S9', Check>;

/** PRD §7 S1~S9 (S8 항해 시간·S9 e2e 재현은 로그로 못 재서 e2e 소관). scripts/check-result.mjs 와 같은 계산 */
export function checkResult(r: ResultJson): Checks {
  const T = THRESHOLDS;
  const log = r.log;

  const dirs = log.filter((e) => e.type === 'judge_dir') as Extract<LogEvent, { type: 'judge_dir' }>[];
  const dirAcc = ratio(dirs.filter((e) => e.correct).length, dirs.length);
  const lastWrong = dirs.slice(-T.S1_LAST_N).filter((e) => !e.correct).length;

  let turn = 0;
  const half = { early: { c: 0, n: 0 }, late: { c: 0, n: 0 } };
  for (const e of log) {
    if (e.type === 'port_call') turn = e.turn;
    if (e.type === 'judge_cause' && e.attempt === 1) {
      const h = turn > T.S2_HALF ? half.late : half.early;
      h.n++;
      if (e.correct) h.c++;
    }
  }
  const early = ratio(half.early.c, half.early.n);
  const late = ratio(half.late.c, half.late.n);
  const causeAcc = ratio(half.early.c + half.late.c, half.early.n + half.late.n);

  const rows = r.ledger.filter(complete);
  const withKorea = rows.filter((x) => x.exporter === KOREA || x.importer === KOREA).length;

  const text = lastSentence(log);
  const kw = keywordCount(text);
  const diff = SENTENCE_DIFF.test(text);

  const mind: Record<string, boolean> = {};
  for (const e of log) if (e.type === 'mindmap') mind[e.slot] = e.correct;
  const mindOk = Object.values(mind).filter(Boolean).length;

  const blocked = log.filter((e) => e.type === 'export_attempt_blocked' && (T.S6_GOODS as readonly string[]).includes(e.good)).length;
  const autarky = log.filter((e) => e.type === 'autarky').length;
  const compare = log.some((e) => e.type === 'screen' && e.name === EPILOGUE_COMPARE_SCREEN);
  const screens = log.filter((e) => e.type === 'screen').length;
  const dialogs = dirs.filter((e) => e.attempt === 1).length;
  const v = r.invariants;

  return {
    S1: { pass: dirs.length > 0 && dirAcc >= T.S1_DIR_ACC && lastWrong === 0, value: dirAcc, detail: `judge_dir ${dirs.length}건, 마지막 ${T.S1_LAST_N}건 오답 ${lastWrong}` },
    S2: { pass: late >= early && causeAcc >= T.S2_CAUSE_ACC, value: causeAcc, detail: `첫 시도 전반 ${early} 후반 ${late}` },
    S3: { pass: rows.length >= T.S3_MIN_ROWS && withKorea >= 1 && rows.length - withKorea >= 1, value: rows.length, detail: `한국 포함 ${withKorea}, 미포함 ${rows.length - withKorea}` },
    S4: { pass: kw >= 2 && diff, value: kw, detail: `키워드 ${kw}개, 다르/차이 ${diff}` },
    S5: { pass: mindOk >= T.S5_MIN_CORRECT, value: mindOk, detail: `${T.S5_SLOTS}칸 중 정답 ${mindOk}` },
    S6: { pass: blocked === 0, value: blocked, detail: '원유·천연가스 수출 시도 로그' },
    S7: { pass: autarky <= T.S7_MAX_AUTARKY && compare, value: autarky, detail: `비교 화면 열람 ${compare}` },
    S8: { pass: screens <= T.S8_MAX_SCREENS && dialogs <= T.S8_MAX_JUDGE_DIALOGS, value: screens, detail: `판정 다이얼로그 ${dialogs}` },
    S9: { pass: !!v && v.cashStart >= v.maxRefuel * v.portCalls && v.tank >= v.maxLegFuel, value: v ?? null, detail: 'cashStart ≥ maxRefuel × portCalls ∧ tank ≥ maxLegFuel' },
  };
}
