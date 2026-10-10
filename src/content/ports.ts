import type { Axis, FareTier, GoodId, Item, Port, PortId } from './types';

/** 가격은 조건에서만 유도: 기준가 x 특산 0.6 / 결핍 1.6 / 보통 1.0 */
export const SPECIALTY_MULT = 0.6;
export const SHORTAGE_MULT = 1.6;

export const START_CASH = 1000;
/** 연료 단위 = 코인 급유가와 같은 눈금. 원거리(150) 왕복 = 300 */
export const START_FUEL = 300;
export const REFUEL_PRICE: Record<Exclude<FareTier, 'home'>, number> = { near: 50, mid: 100, far: 150 };

/** 부산 시작 창고. 원유·천연가스·흑연·니켈 없음(M2) */
export const START_DEPOT: Item[] = [
  { good: 'semiconductor', qty: 2 },
  { good: 'cosmetics', qty: 2 },
];

type A = [number, number, number, number, number]; // nature, resource, capital, tech, geo
const p = (
  id: PortId, nameKo: string, hintKo: string, a: A, correctCauses: Axis[],
  specialties: GoodId[], shortages: [GoodId, Axis][], fareTier: FareTier,
  x: number, y: number, source: string,
): Port => ({
  id, nameKo, hintKo,
  axes: { nature: a[0], resource: a[1], capital: a[2], tech: a[3], geo: a[4] } as Port['axes'],
  correctCauses, specialties,
  shortages: shortages.map(([good, shortageAxis]) => ({ good, shortageAxis })),
  fareTier, background: `assets/img/port-${id}.png`, mapPos: { x, y }, source,
});

export const PORTS: Port[] = [
  p('busan', '부산', '천연자원이 부족해 원료를 들여와 기술로 만든 상품을 수출한다.', [1, 0, 2, 3, 2], ['tech'],
    ['semiconductor', 'phone', 'cosmetics', 'drama', 'seaweed'],
    [['crude-oil', 'resource'], ['natural-gas', 'resource'], ['graphite', 'resource'], ['nickel', 'resource']],
    'home', 0.48, 0.33, '교과서 pp.100~102'),
  p('saudi', '사우디아라비아', '땅속에 풍부한 자원이 있는 나라다.', [0, 3, 2, 1, 1], ['resource'],
    ['crude-oil', 'natural-gas'], [['car', 'tech'], ['phone', 'tech']], 'mid', 0.26, 0.46, '교과서 pp.97, 103'),
  p('shanghai', '상하이', '자원이 많고 큰 항구와 공장을 갖춘 나라다.', [2, 3, 3, 2, 2], ['resource', 'capital'],
    ['graphite', 'steel'], [['semiconductor', 'tech']], 'near', 0.44, 0.37, '교과서 pp.99, 104, 108'),
  p('japan', '일본', '뛰어난 기술로 만든 상품을 수출한다.', [1, 0, 2, 3, 1], ['tech'],
    ['robot'], [['semiconductor', 'resource']], 'near', 0.53, 0.33, '교과서 p.103'),
  p('vietnam', '베트남', '일하는 사람의 임금이 낮아 생산 시설이 많이 옮겨 온다.', [2, 1, 3, 1, 1], ['capital'],
    ['phone'], [['semiconductor', 'tech']], 'mid', 0.40, 0.47, '교과서 p.106, p.109'),
  p('singapore', '싱가포르', '유럽과 아시아를 잇는 길목의 큰 항구에서 상품이 모였다 다시 팔린다.', [0, 0, 2, 2, 3], ['geo'],
    [], [], 'mid', 0.40, 0.55, '교과서 p.104'),
  p('thai', '타이', '따뜻하고 비가 많은 기후라 농사가 잘된다.', [3, 1, 1, 1, 2], ['nature'],
    ['rice'], [['seaweed', 'nature']], 'mid', 0.38, 0.49, '교과서 pp.102~103'),
  p('indonesia', '인도네시아', '땅속에 니켈과 주석 같은 광물이 많다.', [2, 3, 1, 0, 1], ['resource'],
    ['nickel'], [['sugar', 'nature']], 'mid', 0.45, 0.60, '교과서 p.106 / 지도서 pp.236~237'),
  p('la', '로스앤젤레스', '영화와 인터넷 서비스 같은 문화와 기술이 발달했고 자본도 풍부하다.', [2, 1, 3, 3, 2], ['capital', 'tech'],
    ['ott'], [['car', 'resource'], ['semiconductor', 'resource'], ['battery', 'resource']], 'far', 0.75, 0.36, '교과서 p.103, 105'),
  p('germany', '독일', '뛰어난 의약 기술로 만든 상품을 수출한다.', [1, 1, 2, 3, 2], ['tech'],
    ['vaccine'], [], 'far', 0.13, 0.22, '교과서 pp.103, 105'),
  p('brazil', '브라질', '넓은 땅과 알맞은 기후에서 농산물이 많이 난다.', [3, 2, 1, 1, 1], ['nature'],
    ['sugar', 'cacao'], [['phone', 'tech']], 'far', 0.92, 0.63, '교과서 p.103 / 지도서 pp.236~237'),
  p('chile', '칠레', '자연환경이 농사에 알맞아 농산물을 많이 수출한다.', [3, 2, 1, 1, 1], ['nature'],
    ['grapes'], [['phone', 'tech']], 'far', 0.86, 0.80, '교과서 p.103, 109 / 지도서 p.248'),
];

export const PORT_BY_ID = Object.fromEntries(PORTS.map((x) => [x.id, x])) as Record<PortId, Port>;
