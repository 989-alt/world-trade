import type { Recipe } from './types';

export const RECIPES: Recipe[] = [
  { id: 'refine', nameKo: '정유', inputs: [{ good: 'crude-oil', qty: 1 }], output: 'petroleum', valueMultiplier: 2.5, source: '교과서 p.100 / 지도서 p.230' },
  { id: 'battery', nameKo: '배터리', inputs: [{ good: 'graphite', qty: 1 }, { good: 'nickel', qty: 1 }], output: 'battery', valueMultiplier: 2.5, source: '교과서 p.99 / 지도서 p.224' },
  { id: 'car', nameKo: '자동차', inputs: [{ good: 'battery', qty: 1 }, { good: 'steel', qty: 1 }], output: 'car', valueMultiplier: 1.5, source: '교과서 p.100' },
];
