import { describe, expect, it } from 'vitest';
import { AXES, GOOD_IDS, PORT_IDS, type Axis } from './types';
import { GOODS, EVENT_ONLY_GOODS } from './goods';
import { PORTS, START_DEPOT, START_CASH, REFUEL_PRICE } from './ports';
import { RECIPES } from './recipes';
import { EVENTS } from './events';
import { FEEDBACK, whyBuys, whySells, shortageOption } from './feedback';
import { MINDMAP_SLOTS, isAccepted, normalize } from './mindmap';
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
  });

  it('feedback M1..M9 have text and source', () => {
    expect(Object.keys(FEEDBACK).sort()).toEqual(['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9']);
    for (const f of Object.values(FEEDBACK)) {
      expect(f.textKo).not.toBe('');
      expect(f.source).toMatch(/p{1,2}\.\d+/);
    }
  });

  it('question text helpers', () => {
    expect(whySells('타이', '쌀')).toBe('타이에서 쌀을 싸게 파는 까닭은 무엇일까요?');
    expect(whyBuys('칠레', '무선 통신 기기')).toBe('칠레가 무선 통신 기기를 사 오는 까닭은?');
    expect(whyBuys('타이', '김')).toBe('타이가 김을 사 오는 까닭은?');
    expect(shortageOption('tech')).toBe('기술이 부족해서');
    expect(shortageOption('geo')).toBe('지리적 위치가 부족해서');
  });

  it('prologue has 수입/수출 term cards and mini-sim 2+2 vs 3+3', () => {
    const words = PROLOGUE_STEPS.flatMap((s) => (s.term ? [s.term.wordKo] : []));
    expect(words).toEqual(expect.arrayContaining(['수입', '수출']));
    expect(MINI_SIM.eachMakes).toEqual({ a: 2, b: 2 });
    expect(MINI_SIM.specializeAndTrade).toEqual({ a: 3, b: 3 });
  });
});
