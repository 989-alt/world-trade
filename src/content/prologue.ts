export type PrologueStep = {
  id: string;
  textKo: string;
  /** 용어 카드: 이 단계에서 보여 줄 낱말과 뜻 */
  term?: { wordKo: string; defKo: string };
  source: string;
};

/** 벽란도 프롤로그: 비단을 사 오고(수입) 인삼을 판다(수출) */
export const PROLOGUE_STEPS: PrologueStep[] = [
  { id: 'intro', textKo: '고려의 벽란도 항구. 송과 아라비아 상인들이 배를 대고 물건을 사고팝니다.', source: '교과서 p.95' },
  { id: 'buy-silk', textKo: '송나라 상인에게서 비단을 사 왔습니다.',
    term: { wordKo: '수입', defKo: '다른 나라에서 물자나 서비스를 사 오는 것' }, source: '교과서 p.96' },
  { id: 'sell-ginseng', textKo: '송나라 상인에게 인삼을 팔았습니다.',
    term: { wordKo: '수출', defKo: '다른 나라에 물자나 서비스를 파는 것' }, source: '교과서 p.96' },
  { id: 'trade', textKo: '이렇게 나라와 나라 사이에 사고파는 일을 무역이라고 합니다.',
    term: { wordKo: '무역', defKo: '나라와 나라 사이에 물자나 서비스를 사고팔거나 교환하는 활동' }, source: '교과서 p.96' },
];

/** ㉮/㉯ 미니 시뮬. 교과서는 수치 없이 서술형이라 숫자는 게임용(교과서 p.98 구조) */
export const MINI_SIM = {
  eachMakes: { a: 2, b: 2 },
  specializeAndTrade: { a: 3, b: 3 },
  source: '교과서 p.98 / 지도서 pp.222~223',
} as const;
