import type { Good, GoodId } from './types';

const g = (id: GoodId, nameKo: string, kind: Good['kind'], basePrice: number): Good => ({
  id, nameKo, kind, basePrice, icon: `assets/img/goods/${id}.png`,
});

export const GOODS: Good[] = [
  g('crude-oil', '원유', 'raw', 60),
  g('natural-gas', '천연가스', 'raw', 70),
  g('graphite', '흑연', 'raw', 50),
  g('nickel', '니켈', 'raw', 90),
  g('steel', '철강', 'product', 150),
  g('rice', '쌀', 'raw', 40),
  g('sugar', '설탕', 'raw', 45),
  g('grapes', '청포도', 'raw', 55),
  g('cacao', '카카오', 'raw', 65),
  g('seaweed', '김', 'raw', 40),
  g('petroleum', '석유 제품', 'product', 160),
  g('battery', '배터리', 'product', 250),
  g('car', '자동차', 'product', 400),
  g('semiconductor', '반도체', 'product', 350),
  g('phone', '무선 통신 기기', 'product', 300),
  g('cosmetics', '화장품', 'product', 200),
  g('drama', '드라마', 'service', 160),
  g('ott', '온라인 동영상 서비스', 'service', 220),
  g('vaccine', '백신', 'product', 320),
  g('robot', '로봇', 'product', 380),
];

export const GOOD_BY_ID = Object.fromEntries(GOODS.map((x) => [x.id, x])) as Record<GoodId, Good>;
