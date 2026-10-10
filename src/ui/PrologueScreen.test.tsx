import { describe, expect, it } from 'vitest';
import { termCards } from './PrologueScreen';

describe('R8 프롤로그 용어 카드', () => {
  it('고르기 전엔 없음, 고른 뒤엔 수입·수출·무역 셋 다(고른 것 먼저)', () => {
    expect(termCards(null)).toEqual([]);
    expect(termCards('buy-silk').map((t) => [t.wordKo, t.kind])).toEqual([['수입', 'import'], ['수출', 'export'], ['무역', '']]);
    expect(termCards('sell-ginseng').map((t) => t.wordKo)).toEqual(['수출', '수입', '무역']);
    expect(termCards('buy-silk').every((t) => t.defKo.length > 0)).toBe(true);
  });
});
