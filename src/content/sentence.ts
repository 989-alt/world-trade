import { AXES, AXIS_LABEL, type Axis } from './types';

/** 에필로그 ② 맺음말 보기. 'same' 은 오답(S4 의 다르/차이 가 없다) */
export const ENDINGS = [
  { id: 'differ', labelKo: '…이 나라마다 달라서 무역을 한다' },
  { id: 'gap', labelKo: '…에 차이가 있어서 무역을 한다' },
  { id: 'same', labelKo: '…이 모두 같아서 무역을 한다' },
] as const;
export type EndingId = (typeof ENDINGS)[number]['id'];

const iGa = (s: string) => ((s.charCodeAt(s.length - 1) - 0xac00) % 28 ? '이' : '가');

/** 고른 축(교과 순서로 '·' 연결)을 맺음말에 넣은 문장. 축이나 맺음말이 없으면 '' */
export function composeSentence(axes: Axis[], ending: EndingId | null): string {
  if (!axes.length || !ending) return '';
  const subj = AXES.filter((a) => axes.includes(a)).map((a) => AXIS_LABEL[a]).join('·');
  if (ending === 'gap') return `${subj}에 차이가 있어서 무역을 한다.`;
  return `${subj}${iGa(subj)} ${ending === 'differ' ? '나라마다 달라서' : '모두 같아서'} 무역을 한다.`;
}
