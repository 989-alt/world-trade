import { AXIS_LABEL, type Axis } from './types';

export type Misconception = 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6' | 'M7' | 'M8' | 'M9';

export const FEEDBACK: Record<Misconception, { textKo: string; source: string }> = {
  M1: { textKo: '다른 나라에서 사 오는 것은 수입, 다른 나라에 파는 것은 수출입니다.', source: '교과서 p.96' },
  M2: { textKo: '우리나라는 원유를 전량 수입합니다. 천연자원을 들여와 가공한 상품을 수출합니다.', source: '교과서 p.101 / p.111' },
  M3: { textKo: '각 나라가 더 잘 만드는 것에 집중해 서로 바꾸면 두 나라 모두 더 풍족해집니다.', source: '교과서 p.98 / 지도서 pp.222~223' },
  M4: { textKo: '나라마다 자연환경, 자원, 자본, 기술이 달라서 잘 만드는 것이 다르고, 그래서 무역을 합니다.', source: '교과서 p.99' },
  M5: { textKo: '한 나라 안에서 구할 수 있어도 더 좋거나 더 값싼 것은 다른 나라에서 수입하기도 합니다.', source: '교과서 p.98 / p.99' },
  M6: { textKo: '수입이 늘면 국내 기업이 피해를 입고 관련 산업의 성장이 어려워질 수 있습니다.', source: '교과서 p.108 / 지도서 p.246' },
  M7: { textKo: '잘 만드는 것은 수출하고, 만들지 못하거나 부족한 것은 수입합니다. 이미 잘 만드는 것입니다.', source: '교과서 p.99' },
  M8: { textKo: '원유는 자연 상태의 석유이고, 석유 제품은 원유를 분리해 만든 휘발유와 경유 같은 것입니다.', source: '교과서 p.100 / 지도서 p.230' },
  M9: { textKo: '기업의 해외 생산은 소득과 저렴한 제품이라는 좋은 점과 임금과 환경 문제라는 어려운 점이 함께 있습니다.', source: '교과서 p.109 / 지도서 p.247' },
};

const batchim = (s: string) => {
  const c = s.charCodeAt(s.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0;
};
const josa = (s: string, withB: string, noB: string) => s + (batchim(s) ? withB : noB);

/** 수입 거래 까닭 판정: 정답 = 항구의 최고 축 */
export const whySells = (portName: string, goodName: string) =>
  `${josa(portName, '이', '가')} ${josa(goodName, '을', '를')} 싸게 파는 까닭은?`;

/** 수출 거래 까닭 판정: 정답 = 항구의 결핍 축 */
export const whyBuys = (portName: string, goodName: string) =>
  `${josa(portName, '이', '가')} ${josa(goodName, '을', '를')} 사 오는 까닭은?`;

/** 싱가포르 까닭 판정(두 방향 공통): 정답 = 지리적 위치 */
export const whyRelays = (portName: string, goodName: string) =>
  `${josa(portName, '이', '가')} ${josa(goodName, '을', '를')} 사서 다시 파는 까닭은?`;

export const causeOption = (a: Axis) => AXIS_LABEL[a];
/** 수출 쪽 선택지: "기술이 부족해서" */
export const shortageOption = (a: Axis) => `${josa(AXIS_LABEL[a], '이', '가')} 부족해서`;
