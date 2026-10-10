import { describe, expect, it } from 'vitest';
import { FEEDBACK } from '../content/feedback';
import { PORT_BY_ID } from '../content/ports';
import { createLog } from '../engine/log';
import { createRng } from '../engine/rng';
import { startJudgment, type Dir } from '../engine/judgment';
import type { GoodId, PortId } from '../content/types';
import { applyCause, applyDir, judgmentView, priceLabel, type Entry } from './JudgmentDialog';

const entry = (port: PortId, good: GoodId, dir: Dir): Entry => {
  const j = startJudgment({ port, good, dir, shuffle: createRng(7).shuffle, log: createLog() });
  if (!j.ok) throw new Error(j.reason);
  return { session: j.session, last: null };
};

describe('시세 가림', () => {
  it("판정 완료 전 가격 칸은 '?', 완료 뒤 숫자", () => {
    const e = entry('saudi', 'crude-oil', 'import');
    expect(priceLabel(undefined, 36)).toBe('?');
    expect(priceLabel(e.session, 36)).toBe('?');
    applyDir(e, 'import');
    expect(priceLabel(e.session, 36)).toBe('?');
    applyCause(e, 'resource');
    expect(e.session.step).toBe('done');
    expect(priceLabel(e.session, 36)).toBe('36');
    expect(judgmentView(e, '사우디아라비아', '원유').done).toBe(true);
  });
  it('부산(판정 없음)은 바로 숫자', () => {
    expect(priceLabel(undefined, 210, true)).toBe('210');
  });
});

describe('오답 피드백 · 재선택 · 2차 오답 정답 공개', () => {
  it('방향 1차 오답: M1 문장과 출처, 같은 단계에서 재선택(오답 칸 표시)', () => {
    const e = entry('saudi', 'crude-oil', 'import');
    applyDir(e, 'export');
    const vm = judgmentView(e, '사우디아라비아', '원유');
    expect(e.session.step).toBe('dir');
    expect(vm.feedback).toEqual({ text: FEEDBACK.M1.textKo, source: FEEDBACK.M1.source });
    expect(vm.choices.find((c) => c.id === 'export')!.wrong).toBe(true);
    applyDir(e, 'import');
    expect(e.session.step).toBe('cause');
    expect(judgmentView(e, '사우디아라비아', '원유').feedback).toBeNull();
  });
  it('방향 2차 오답: 정답 방향 배지 강조(reveal) 후 까닭 단계로', () => {
    const e = entry('saudi', 'crude-oil', 'import');
    applyDir(e, 'export');
    applyDir(e, 'export');
    const vm = judgmentView(e, '사우디아라비아', '원유');
    expect(e.session.step).toBe('cause');
    expect(vm.badges[0]).toEqual({ text: '① 수입 ✓', state: 'reveal' });
    expect(vm.feedback!.text).toBe(FEEDBACK.M1.textKo);
  });
  it('까닭 1차 오답 → M4 문장, 2차 오답 → 정답 축·근거·쪽 공개, 시세 공개', () => {
    const e = entry('saudi', 'crude-oil', 'import');
    applyDir(e, 'import');
    applyCause(e, 'tech');
    let vm = judgmentView(e, '사우디아라비아', '원유');
    expect(vm.feedback).toEqual({ text: FEEDBACK.M4.textKo, source: FEEDBACK.M4.source });
    expect(e.session.step).toBe('cause');
    applyCause(e, 'geo');
    vm = judgmentView(e, '사우디아라비아', '원유');
    expect(vm.done).toBe(true);
    expect(vm.reveal).toEqual({ text: `자원 — ${PORT_BY_ID.saudi.hintKo}`, source: PORT_BY_ID.saudi.source });
    expect(vm.feedback).toEqual({ text: FEEDBACK.M4.textKo, source: FEEDBACK.M4.source });
    expect(vm.badges[1].state).toBe('reveal');
    expect(priceLabel(e.session, 36)).toBe('36');
  });
});

describe('질문 문구', () => {
  it("수입: '싸게 파는 까닭', 선택지 = 5축 이름", () => {
    const e = entry('saudi', 'crude-oil', 'import');
    expect(judgmentView(e, '사우디아라비아', '원유').question).toContain('사 오기');
    applyDir(e, 'import');
    const vm = judgmentView(e, '사우디아라비아', '원유');
    expect(vm.question).toContain('싸게 파는 까닭');
    expect(vm.choices.map((c) => c.label).sort()).toEqual(['기술', '자본', '자연환경', '자원', '지리적 위치'].sort());
  });
  it("수출: '사 가는 까닭', 선택지 = '○○이/가 부족해서'", () => {
    const e = entry('saudi', 'car', 'export');
    expect(judgmentView(e, '사우디아라비아', '자동차').question).toContain('팔기');
    applyDir(e, 'export');
    const vm = judgmentView(e, '사우디아라비아', '자동차');
    expect(vm.question).toContain('사 가는 까닭');
    expect(vm.choices).toHaveLength(5);
    for (const c of vm.choices) expect(c.label).toMatch(/[이가] 부족해서$/);
    expect(vm.choices.map((c) => c.label)).toContain('기술이 부족해서');
  });
  it('선택지 순서는 seed 셔플 — 같은 seed 같은 순서', () => {
    const a = entry('saudi', 'crude-oil', 'import').session.options.map((o) => o.axis);
    const b = entry('saudi', 'crude-oil', 'import').session.options.map((o) => o.axis);
    expect(a).toEqual(b);
  });
});
