import { describe, expect, it } from 'vitest';
import { EVENTS } from '../content/events';
import { PORTS } from '../content/ports';
import { newGame, nextEventFor } from '../engine/state';
import type { GameState } from '../engine/types';
import { ZONES, enteredZones, zoneAt } from './eventZones';
import zonesSrc from './eventZones.ts?raw';

const profile = { nickname: 't', seat: '1' };
const sea = (s: GameState, departures: number): GameState => ({ ...s, stage: 'main', location: 'sea', departures });

describe('eventZones', () => {
  it('every content zone id has exactly one zone, no extras', () => {
    const ids = [...new Set(EVENTS.map((e) => e.zone))].sort();
    expect(ZONES.map((z) => z.id).sort()).toEqual(ids);
  });
  it('zones do not overlap, stay in 0..1, and contain no port', () => {
    for (const a of ZONES) {
      expect(a.x - a.r).toBeGreaterThanOrEqual(0);
      expect(a.x + a.r).toBeLessThanOrEqual(1);
      expect(a.y - a.r).toBeGreaterThanOrEqual(0);
      expect(a.y + a.r).toBeLessThanOrEqual(1);
      for (const p of PORTS) expect(zoneAt(p.mapPos)).toBeNull();
      for (const b of ZONES) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r);
    }
  });
  it('zoneAt and enteredZones detect edges only', () => {
    const z = ZONES[0];
    const inside = { x: z.x, y: z.y };
    const outside = { x: 0.99, y: 0.99 };
    expect(zoneAt(inside)).toBe(z.id);
    expect(zoneAt(outside)).toBeNull();
    expect(enteredZones(outside, inside)).toEqual([z.id]);
    expect(enteredZones(inside, inside)).toEqual([]);
    expect(enteredZones(inside, outside)).toEqual([]);
    expect(enteredZones(outside, inside)).toEqual([z.id]); // 재진입은 다시 경계 통과
  });
  it('100 seeds: 5 required cards fire within 5 departures, no duplicates; optional fires in its zone', () => {
    const required = EVENTS.filter((e) => e.required).map((e) => e.id).sort();
    for (let seed = 1; seed <= 100; seed++) {
      let s = newGame(seed, profile);
      const drawn: string[] = [];
      for (let dep = 1; dep <= 6; dep++) {
        const st = sea({ ...s }, dep);
        const ev = nextEventFor(st, 'open-sea'); // 어느 선택 카드의 해역도 아닌 곳
        if (ev) {
          drawn.push(ev.id);
          s = { ...st, eventsDrawn: [...st.eventsDrawn, ev.id] };
          expect(nextEventFor(s, ev.zone)?.id).not.toBe(ev.id); // 재진입 재발동 없음
        } else s = st;
      }
      expect(new Set(drawn).size).toBe(drawn.length);
      expect(drawn.slice().sort()).toEqual(required);
      const opt = EVENTS.find((e) => e.id === s.eventQueue[5])!;
      expect(nextEventFor(s, opt.zone)?.id).toBe(opt.id);
      expect(nextEventFor({ ...s, eventsDrawn: [...s.eventsDrawn, opt.id] }, opt.zone)).toBeNull();
    }
  });
  it('required card n is not forced before the n-th departure', () => {
    const s = newGame(7, profile);
    expect(nextEventFor(sea(s, 0), 'open-sea')).toBeNull();
    expect(nextEventFor(sea(s, 1), 'open-sea')?.id).toBe(s.eventQueue[0]);
  });
  it('no Math.random in sources', () => {
    expect(zonesSrc).not.toMatch(/Math\.random/);
  });
});
