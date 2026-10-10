#!/usr/bin/env node
// PRD §7 성공 판정식 S1~S9 — 학생 1명의 결과 JSON 을 오프라인으로 검사한다.
// 사용: node scripts/check-result.mjs <result.json>  → stdout JSON, 모두 통과면 exit 0, 아니면 1
// src/engine/result.ts 의 checkResult 와 같은 계산(TS 를 import 하지 않으려고 따로 둔다). result.test.ts 가 두 결과를 비교한다.
import { readFileSync } from 'node:fs';

const T = {
  S1_DIR_ACC: 0.9, S1_LAST_N: 5, S2_CAUSE_ACC: 0.7, S2_HALF: 3, S3_MIN_ROWS: 6,
  S5_SLOTS: 5, S5_MIN_CORRECT: 4, S6_GOODS: ['crude-oil', 'natural-gas'], S7_MAX_AUTARKY: 1,
  S8_MAX_SCREENS: 35, S8_MAX_JUDGE_DIALOGS: 14,
};
const KOREA = '대한민국';
const EPILOGUE_COMPARE_SCREEN = 'epilogue-compare';
const SENTENCE_KEYWORDS = /(자연환경|자원|자본|기술|지리)/g;
const SENTENCE_DIFF = /(다르|다른|다름|달라|차이)/;

const ratio = (n, d) => (d ? n / d : 0);
const complete = (r) => !!(r.exporter && r.good && r.importer);
const keywordCount = (text) => new Set(Array.from(text.matchAll(SENTENCE_KEYWORDS), (m) => m[1])).size;

export function check(r) {
  const log = Array.isArray(r.log) ? r.log : [];
  const ledger = Array.isArray(r.ledger) ? r.ledger : [];

  const dirs = log.filter((e) => e.type === 'judge_dir');
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

  const rows = ledger.filter(complete);
  const withKorea = rows.filter((x) => x.exporter === KOREA || x.importer === KOREA).length;

  const sentences = log.filter((e) => e.type === 'sentence');
  const text = sentences.length ? sentences[sentences.length - 1].text : '';
  const kw = keywordCount(text);
  const diff = SENTENCE_DIFF.test(text);

  const mind = {};
  for (const e of log) if (e.type === 'mindmap') mind[e.slot] = e.correct;
  const mindOk = Object.values(mind).filter(Boolean).length;

  const blocked = log.filter((e) => e.type === 'export_attempt_blocked' && T.S6_GOODS.includes(e.good)).length;
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

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/check-result.mjs <result.json>');
  process.exit(2);
}
let data;
try {
  data = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`cannot read ${file}: ${e.message}`);
  process.exit(2);
}
const out = check(data);
console.log(JSON.stringify(out, null, 2));
process.exit(Object.values(out).every((s) => s.pass) ? 0 : 1);
