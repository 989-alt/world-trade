import { describe, expect, it, vi } from 'vitest';
import { NICKNAMES } from '../content/nicknames';

vi.mock('../game/SailingScene', () => ({ requestDock: () => {} }));
const { canStart } = await import('./TitleScreen');

describe('C1 타이틀 선택', () => {
  it('바다 동물 24개, 둘 다 골라야 시작', () => {
    expect(new Set(NICKNAMES).size).toBe(24);
    expect(canStart('', '3')).toBe(false);
    expect(canStart('고래', '')).toBe(false);
    expect(canStart('고래', '3')).toBe(true);
  });
});
