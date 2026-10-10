export const AXES = ['nature', 'resource', 'capital', 'tech', 'geo'] as const;
export type Axis = (typeof AXES)[number];

export const AXIS_LABEL: Record<Axis, string> = {
  nature: '자연환경',
  resource: '자원',
  capital: '자본',
  tech: '기술',
  geo: '지리적 위치',
};

export const GOOD_IDS = [
  'crude-oil', 'natural-gas', 'graphite', 'nickel', 'steel',
  'rice', 'sugar', 'grapes', 'cacao', 'seaweed',
  'petroleum', 'battery', 'car', 'semiconductor', 'phone',
  'cosmetics', 'drama', 'ott', 'vaccine', 'robot',
] as const;
export type GoodId = (typeof GOOD_IDS)[number];

export const PORT_IDS = [
  'busan', 'saudi', 'shanghai', 'japan', 'vietnam', 'singapore',
  'thai', 'indonesia', 'la', 'germany', 'brazil', 'chile',
] as const;
export type PortId = (typeof PORT_IDS)[number];

export type GoodKind = 'raw' | 'product' | 'service';
export type FareTier = 'home' | 'near' | 'mid' | 'far';

export type Good = {
  id: GoodId;
  nameKo: string;
  kind: GoodKind;
  basePrice: number;
  icon: string;
};

export type Port = {
  id: PortId;
  nameKo: string;
  hintKo: string;
  axes: Record<Axis, 0 | 1 | 2 | 3>;
  /** 수입 거래 까닭 판정 정답: axes 최댓값 축(동률이면 둘 다). 싱가포르는 ['geo'] 단독 */
  correctCauses: Axis[];
  /** 싸게 파는 상품(x0.6) */
  specialties: GoodId[];
  /** 비싸게 사는 상품(x1.6) + 수출 거래 까닭 판정 정답 축 */
  shortages: { good: GoodId; shortageAxis: Axis }[];
  fareTier: FareTier;
  background: string;
  mapPos: { x: number; y: number };
  /** 교과분석.md 의 [교과서 p.N] 형식 출처 */
  source: string;
};

export type Item = { good: GoodId; qty: number };

export type Recipe = {
  id: 'refine' | 'battery' | 'car';
  nameKo: string;
  inputs: Item[];
  output: GoodId;
  source: string;
};

export type Effect =
  | { type: 'price'; good: GoodId; factor: number }
  | { type: 'factoryLevel'; delta: number }
  | { type: 'refuelDiscount'; factor: number }
  | { type: 'reputation'; delta: number }
  | { type: 'none' };

export type EventChoice = {
  id: string;
  labelKo: string;
  plus: string;
  minus: string;
  effect: Effect;
  /** 선택 뒤에 보이는 교과서 문장 한 줄 */
  feedbackKo: string;
  source: string;
};

export type GameEvent = {
  id: string;
  /** 신문 헤드라인 한 줄 (본문 문단 없음) */
  titleKo: string;
  required: boolean;
  source: string;
  /** 항해 중 이 해역에 들어서면 카드가 뜬다 */
  zone: string;
  choices: EventChoice[];
};
