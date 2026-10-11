import { useState } from 'preact/hooks';
import { GOODS } from '../content/goods';
import { PORTS } from '../content/ports';
import { RECIPES } from '../content/recipes';
import { normalize } from '../content/mindmap';
import type { PortId } from '../content/types';
import { KOREA, buildLedger } from '../engine/result';
import type { GameState, LogInput } from '../engine/types';
import './epilogue.css';

const ALIAS: Record<string, PortId> = { 대한민국: 'busan', 한국: 'busan', 부산: 'busan', 미국: 'la', 중국: 'shanghai', 태국: 'thai' };
const country = (s: string) => {
  const n = normalize(s);
  return ALIAS[n] ?? PORTS.find((p) => normalize(p.nameKo) === n)?.id;
};

/** 수동 행 검증: 세 칸이 모두 차야 추가 가능(complete). correct = 수출국의 특산 품목(대한민국은 + 가공 출력품)이고 수입국이 다른 알려진 나라 */
export function checkManualRow(exporter: string, good: string, importer: string): { complete: boolean; correct: boolean } {
  const complete = [exporter, good, importer].every((x) => normalize(x) !== '');
  if (!complete) return { complete, correct: false };
  const ex = country(exporter);
  const im = country(importer);
  const g = GOODS.find((x) => normalize(x.nameKo) === normalize(good));
  const own = [...PORTS.find((p) => p.id === ex)?.specialties ?? [], ...(ex === 'busan' ? RECIPES.map((r) => r.output) : [])];
  const correct = !!(ex && im && g && ex !== im && own.includes(g.id));
  return { complete, correct };
}

/** 선택 상자 보기: 나라 = 대한민국 + 부산 밖 항구, 품목 = 상품 20 */
export const COUNTRIES = [KOREA, ...PORTS.filter((p) => p.id !== 'busan').map((p) => p.nameKo)];
export const GOOD_NAMES = GOODS.map((g) => g.nameKo);

type Props = { state: Pick<GameState, 'log'>; onLog: (e: LogInput) => void; onDone: () => void };

export function LedgerScreen({ state, onLog, onDone }: Props) {
  const rows = buildLedger(state);
  const [f, setF] = useState({ exporter: '', good: '', importer: '' });
  // 수동 행은 로그에서 읽는다 — 새로 고침·재진입에도 남고 다시 추가되지 않는다
  const manual = state.log.flatMap((e) => (e.type === 'ledger_manual' ? [e] : []));
  const chk = checkManualRow(f.exporter, f.good, f.importer);
  const add = () => {
    if (!chk.complete || manual.length >= 1) return;
    onLog({ type: 'ledger_manual', ...f, correct: chk.correct });
  };
  const bind = (k: keyof typeof f, label: string, opts: string[]) => (
    <select class="ep-in" aria-label={label} value={f[k]} disabled={manual.length > 0}
      onChange={(e) => setF({ ...f, [k]: e.currentTarget.value })}>
      <option value="" disabled>{label}</option>
      {opts.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
  return (
    <>
      <h2 class="ep-h"><img src="assets/ui/icon-ledger.png" alt="" />무역 일지</h2>
      <table class="ep-table">
        <thead><tr><th>입항</th><th>수출국</th><th>물자·서비스</th><th>수입국</th><th>까닭</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}><td>{r.portCall}</td><td>{r.exporter}</td><td>{r.good}</td><td>{r.importer}</td><td>{r.cause}</td></tr>
          ))}
          {manual.map((m, i) => (
            <tr key={`m${i}`} class={m.correct ? 'ok' : 'wrong'}><td>+</td><td>{m.exporter}</td><td>{m.good}</td><td>{m.importer}</td><td>{m.correct ? '✓' : '✕'}</td></tr>
          ))}
        </tbody>
      </table>
      <div class="ep-manual">
        {bind('exporter', '수출국', COUNTRIES)}{bind('good', '품목', GOOD_NAMES)}{bind('importer', '수입국', COUNTRIES)}
        <button type="button" class="ep-btn cream" disabled={!chk.complete || manual.length > 0} onClick={add}>추가</button>
      </div>
      <button type="button" class="ep-btn orange" onClick={onDone}>다음</button>
    </>
  );
}
