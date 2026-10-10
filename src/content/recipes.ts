import type { Recipe } from './types';

/** 가공하면 가치 2.5배 (가격 계산은 엔진 소관, 값만 여기서 고정) */
export const PROCESS_VALUE_MULTIPLIER = 2.5;

export const RECIPES: Recipe[] = [
  { id: 'refine', nameKo: '정유', inputs: [{ good: 'crude-oil', qty: 1 }], output: 'petroleum', source: '교과서 p.100 / 지도서 p.230' },
  { id: 'battery', nameKo: '배터리', inputs: [{ good: 'graphite', qty: 1 }, { good: 'nickel', qty: 1 }], output: 'battery', source: '교과서 p.99 / 지도서 p.224' },
  { id: 'car', nameKo: '자동차', inputs: [{ good: 'battery', qty: 1 }, { good: 'steel', qty: 1 }], output: 'car', source: '교과서 p.100' },
];
