import { describe, expect, it, vi } from 'vitest';
import { PORT_BY_ID } from '../content/ports';
import { newGame, reduce } from '../engine/state';
import type { GameState } from '../engine/types';

vi.mock('../game/SailingScene', () => ({ requestDock: () => {} }));
const { dockPrompt } = await import('./Hud');

const sea = (port: keyof typeof PORT_BY_ID, refuelFactor = 1): GameState => {
  const s = reduce(newGame(42, { nickname: 't', seat: '1' }), { type: 'START_MAIN' }).state;
  return { ...s, location: 'sea', shipPos: { ...PORT_BY_ID[port].mapPos }, flags: { ...s.flags, refuelFactor } };
};

describe('R13 입항 프롬프트 급유 요금', () => {
  it('항구 반경 안이면 이름 + 그 항구 급유 요금(할인 반영), 부산 0 은 생략', () => {
    expect(dockPrompt(sea('saudi'))).toEqual({ name: '사우디아라비아', fare: 100 });
    expect(dockPrompt(sea('shanghai'))).toEqual({ name: '상하이', fare: 50 });
    expect(dockPrompt(sea('chile', 0.8))).toEqual({ name: '칠레', fare: 120 });
    expect(dockPrompt(sea('busan'))).toEqual({ name: '부산', fare: null });
  });
  it('반경 밖·정박 중이면 없음', () => {
    expect(dockPrompt({ ...sea('saudi'), shipPos: { x: 0.6, y: 0.9 } })).toBeNull();
    expect(dockPrompt({ ...sea('saudi'), location: 'saudi' })).toBeNull();
  });
});
