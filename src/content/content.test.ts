import { describe, expect, it } from 'vitest';
import { AXES, GOOD_IDS, PORT_IDS, type Axis } from './types';
import { GOODS, EVENT_ONLY_GOODS } from './goods';
import { PORTS, START_DEPOT, START_CASH, REFUEL_PRICE } from './ports';
import { RECIPES } from './recipes';
import { EVENTS } from './events';
import { FEEDBACK, whyBuys, whyRelays, whySells, shortageOption } from './feedback';
import { MINDMAP_SLOTS, isAccepted, normalize, slotOptions } from './mindmap';
import { composeSentence } from './sentence';
import { checkResult } from '../engine/result';
import { PROLOGUE_STEPS, MINI_SIM } from './prologue';

const RAW_ENERGY = ['crude-oil', 'natural-gas', 'graphite', 'nickel'];

describe('goods / ports', () => {
  it('20 goods, 12 ports, ids unique and complete', () => {
    expect(GOODS.map((g) => g.id).sort()).toEqual([...GOOD_IDS].sort());
    expect(PORTS.map((p) => p.id).sort()).toEqual([...PORT_IDS].sort());
    expect(GOODS.every((g) => g.icon === `assets/img/goods/${g.id}.png`)).toBe(true);
  });

  it('base price ranges by kind', () => {
    const range = { raw: [40, 100], product: [100, 600], service: [120, 250] } as const;
    for (const g of GOODS) {
      expect(Number.isInteger(g.basePrice)).toBe(true);
      expect(g.basePrice).toBeGreaterThanOrEqual(range[g.kind][0]);
      expect(g.basePrice).toBeLessThanOrEqual(range[g.kind][1]);
    }
  });

  it('correctCauses equals argmax axes (1~2), singapore geo only', () => {
    for (const p of PORTS) {
      const max = Math.max(...AXES.map((a) => p.axes[a]));
      const top = AXES.filter((a) => p.axes[a] === max);
      expect(top.length).toBeGreaterThanOrEqual(1);
      expect(top.length).toBeLessThanOrEqual(2);
      expect([...p.correctCauses].sort()).toEqual([...top].sort());
      expect(AXES.every((a) => p.axes[a] >= 0 && p.axes[a] <= 3)).toBe(true);
    }
    const sg = PORTS.find((p) => p.id === 'singapore')!;
    expect(sg.correctCauses).toEqual(['geo']);
  });

  it('singapore has no specialties/shortages', () => {
    const sg = PORTS.find((p) => p.id === 'singapore')!;
    expect(sg.specialties).toEqual([]);
    expect(sg.shortages).toEqual([]);
  });

  it('every shortage has a valid shortageAxis; every port has fareTier', () => {
    for (const p of PORTS) {
      expect(['home', 'near', 'mid', 'far']).toContain(p.fareTier);
      for (const s of p.shortages) expect(AXES).toContain(s.shortageAxis as Axis);
    }
    expect(PORTS.find((p) => p.id === 'busan')!.fareTier).toBe('home');
    expect(REFUEL_PRICE).toEqual({ near: 50, mid: 100, far: 150 });
  });

  it('R3 결핍 축 ≠ 그 항구 최고 축(수입 정답과 수출 정답이 겹치지 않는다). 타이 김 = 기술', () => {
    for (const p of PORTS) for (const s of p.shortages) expect(p.correctCauses, `${p.id} ${s.good}`).not.toContain(s.shortageAxis);
    expect(PORTS.find((p) => p.id === 'thai')!.shortages).toEqual([{ good: 'seaweed', shortageAxis: 'tech' }]);
  });

  it('busan shortages are all resource (M2), specialties match PRD', () => {
    const b = PORTS.find((p) => p.id === 'busan')!;
    expect(b.shortages.every((s) => s.shortageAxis === 'resource')).toBe(true);
    expect(b.shortages.map((s) => s.good).sort()).toEqual([...RAW_ENERGY].sort());
    expect(b.specialties).toEqual(expect.arrayContaining(['semiconductor', 'phone', 'cosmetics', 'drama']));
  });

  it('startDepot has no raw energy goods; cash 1000', () => {
    for (const i of START_DEPOT) expect(RAW_ENERGY).not.toContain(i.good);
    expect(START_CASH).toBe(1000);
  });

  it('no orphan goods', () => {
    const made = new Set<string>([...PORTS.flatMap((p) => p.specialties), ...RECIPES.map((r) => r.output)]);
    expect(GOOD_IDS.filter((g) => !made.has(g) && !EVENT_ONLY_GOODS.includes(g))).toEqual([]);
    expect(EVENT_ONLY_GOODS.every((g) => !made.has(g))).toBe(true);
  });

  it('services >= 2 (drama, ott)', () => {
    const svc = GOODS.filter((g) => g.kind === 'service').map((g) => g.id);
    expect(svc.length).toBeGreaterThanOrEqual(2);
    expect(svc).toEqual(expect.arrayContaining(['drama', 'ott']));
  });

  it('mapPos fractions within 0..1', () => {
    for (const p of PORTS) {
      expect(p.mapPos.x).toBeGreaterThanOrEqual(0);
      expect(p.mapPos.x).toBeLessThanOrEqual(1);
      expect(p.mapPos.y).toBeGreaterThanOrEqual(0);
      expect(p.mapPos.y).toBeLessThanOrEqual(1);
    }
  });
});

describe('recipes', () => {
  it('3 recipes with known goods', () => {
    expect(RECIPES).toHaveLength(3);
    for (const r of RECIPES) {
      expect(GOOD_IDS).toContain(r.output);
      for (const i of r.inputs) expect(GOOD_IDS).toContain(i.good);
      const price = (id: string) => GOODS.find((g) => g.id === id)!.basePrice;
      const expected = r.inputs.reduce((s, i) => s + price(i.good) * i.qty, 0) * r.valueMultiplier;
      expect(Math.abs(price(r.output) - expected) / expected).toBeLessThanOrEqual(0.05);
    }
  });
});

describe('events', () => {
  it('11 events, exactly 5 required, unique ids and zones', () => {
    expect(EVENTS).toHaveLength(11);
    expect(EVENTS.filter((e) => e.required)).toHaveLength(5);
    expect(EVENTS.filter((e) => e.required).map((e) => e.id).sort()).toEqual(
      ['domestic-vs-import', 'factory-relocation', 'fair-trade', 'low-tariff-promise', 'steel-dumping'],
    );
    expect(new Set(EVENTS.map((e) => e.id)).size).toBe(11);
    expect(new Set(EVENTS.map((e) => e.zone)).size).toBe(11);
  });

  it('every event has one-line title, source; choices 2~3 with feedback + source', () => {
    for (const e of EVENTS) {
      expect(e.titleKo.trim()).not.toBe('');
      expect(e.titleKo).not.toContain('\n');
      expect(e.source.trim()).not.toBe('');
      expect(e.choices.length).toBeGreaterThanOrEqual(2);
      expect(e.choices.length).toBeLessThanOrEqual(3);
      for (const c of e.choices) {
        expect(c.feedbackKo.trim()).not.toBe('');
        expect(c.source.trim()).not.toBe('');
        expect(c.source).toMatch(/p{1,2}\.\d+/);
      }
    }
  });

  it('R12 카드 글자 = 효과: 한류·박람회는 「○○ 시세가 오른다」, 박람회·자동화 항만엔 비용 문구 없음', () => {
    const ev = (id: string) => EVENTS.find((e) => e.id === id)!;
    const text = (id: string) => ev(id).choices.flatMap((c) => [c.labelKo, c.plus, c.minus]).join('\n');
    const priceUp = (id: string, choice: string) => {
      const c = ev(id).choices.find((x) => x.id === choice)!;
      const e = c.effect as { type: string; good: string; factor: number };
      expect(e.type).toBe('price');
      expect(e.factor).toBeGreaterThan(1);
      expect(c.plus).toBe(`${GOODS.find((g) => g.id === e.good)!.nameKo} 시세가 오른다`);
    };
    priceUp('hallyu', 'ship');
    expect(ev('hallyu').choices[0].plus).toBe('화장품 시세가 오른다');
    priceUp('expo', 'join');
    expect(text('expo')).not.toContain('비용');
    expect(text('port-automation')).not.toContain('투자 비용');
    expect(ev('port-automation').choices.find((c) => c.id === 'skip')!.plus).not.toContain('비용');
  });

  it('steel-dumping leave choice cites the 1970s steel case', () => {
    const leave = EVENTS.find((e) => e.id === 'steel-dumping')!.choices.find((c) => c.id === 'leave')!;
    expect(leave.feedbackKo).toContain('1970');
  });

  it('relocation and fair-trade choices have both plus and minus', () => {
    for (const id of ['factory-relocation', 'fair-trade']) {
      for (const c of EVENTS.find((e) => e.id === id)!.choices) {
        expect(c.plus.trim()).not.toBe('');
        expect(c.minus.trim()).not.toBe('');
      }
    }
  });

  it('FTA card uses "낮은 관세" and FTA only inside parentheses', () => {
    const e = EVENTS.find((x) => x.id === 'low-tariff-promise')!;
    expect(e.titleKo).toContain('낮은 관세를 부과하기로 약속');
    const all = [e.titleKo, ...e.choices.flatMap((c) => [c.labelKo, c.plus, c.minus, c.feedbackKo])].join('\n');
    expect(all.replace(/\([^)]*\)/g, '')).not.toContain('FTA');
    expect(e.titleKo).toMatch(/\(FTA\)/);
  });
});

describe('mindmap / feedback / prologue', () => {
  it('normalize trims, removes spaces and trailing punctuation', () => {
    expect(normalize('수입 ')).toBe('수입');
    expect(normalize(' 상호 의존.')).toBe('상호의존');
    expect(MINDMAP_SLOTS).toHaveLength(5);
    expect(isAccepted('import', ' 수입하는 것. ')).toBe(true);
    expect(isAccepted('cause', '다르다')).toBe(true);
    expect(isAccepted('import', '수출')).toBe(false);
    expect(isAccepted('import', '')).toBe(false);
    // R14 첫 칸 라벨은 '뜻' 이 아니라 무역의 뜻 문장(답 = 무역)
    expect(MINDMAP_SLOTS[0].labelKo).toBe('나라와 나라 사이에 물자나 서비스를 사고파는 것');
    expect(isAccepted('meaning', '무역')).toBe(true);
  });

  it('feedback M1..M9 have text and source', () => {
    expect(Object.keys(FEEDBACK).sort()).toEqual(['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9']);
    for (const f of Object.values(FEEDBACK)) {
      expect(f.textKo).not.toBe('');
      expect(f.source).toMatch(/p{1,2}\.\d+/);
    }
  });

  it('question text helpers', () => {
    expect(whySells('타이', '쌀')).toBe('타이가 쌀을 싸게 파는 까닭은?');
    expect(whySells('사우디아라비아', '원유')).toBe('사우디아라비아가 원유를 싸게 파는 까닭은?');
    expect(whyBuys('칠레', '무선 통신 기기')).toBe('칠레가 무선 통신 기기를 사 오는 까닭은?');
    expect(whyBuys('타이', '김')).toBe('타이가 김을 사 오는 까닭은?');
    expect(shortageOption('tech')).toBe('기술이 부족해서');
    expect(shortageOption('geo')).toBe('지리적 위치가 부족해서');
    expect(whyRelays('싱가포르', '화장품')).toBe('싱가포르가 화장품을 사서 다시 파는 까닭은?');
    expect(whyRelays('싱가포르', '화장품')).not.toContain('싸게');
  });

  it('prologue has 수입/수출 term cards and mini-sim 2+2 vs 3+3', () => {
    const words = PROLOGUE_STEPS.flatMap((s) => (s.term ? [s.term.wordKo] : []));
    expect(words).toEqual(expect.arrayContaining(['수입', '수출']));
    expect(MINI_SIM.eachMakes).toEqual({ a: 2, b: 2 });
    expect(MINI_SIM.specializeAndTrade).toEqual({ a: 3, b: 3 });
  });
});

describe('C3·C4 보기 조합', () => {
  const s4 = (text: string) =>
    checkResult({ log: [{ t: 1, type: 'sentence', text }], ledger: [], invariants: { cashStart: 1, maxRefuel: 0, portCalls: 0, tank: 1, maxLegFuel: 0 } }).S4.pass;
  it('C3 축은 교과 순서로 · 연결, 맺음말에 넣는다. 정답 조합은 S4 통과, 오답 맺음말·축 1개는 실패', () => {
    expect(composeSentence(['tech', 'resource'], 'differ')).toBe('자원·기술이 나라마다 달라서 무역을 한다.');
    expect(composeSentence(['nature', 'geo'], 'differ')).toBe('자연환경·지리적 위치가 나라마다 달라서 무역을 한다.');
    expect(composeSentence(['capital', 'tech'], 'gap')).toBe('자본·기술에 차이가 있어서 무역을 한다.');
    expect(composeSentence([], 'differ')).toBe('');
    expect(composeSentence(['tech'], null)).toBe('');
    expect(s4(composeSentence(['resource', 'tech'], 'differ'))).toBe(true);
    expect(s4(composeSentence(['nature', 'capital', 'geo'], 'gap'))).toBe(true);
    expect(s4(composeSentence(['resource', 'tech'], 'same'))).toBe(false);
    expect(s4(composeSentence(['tech'], 'differ'))).toBe(false);
  });
  it('C4 칸마다 보기 4개(서로 다름, 정답 정확히 1개), seed 셔플은 결정적', () => {
    MINDMAP_SLOTS.forEach((slot, i) => {
      const o = slotOptions(42, i);
      expect(new Set(o).size).toBe(4);
      expect(o.filter((x) => isAccepted(slot.id, x))).toEqual([slot.accepted[0]]);
      expect(slotOptions(42, i)).toEqual(o);
      expect([...o].sort()).toEqual([...slot.options].sort());
    });
    expect(MINDMAP_SLOTS.map((_, i) => slotOptions(1, i).join())).not.toEqual(MINDMAP_SLOTS.map((_, i) => slotOptions(2, i).join()));
  });
});
