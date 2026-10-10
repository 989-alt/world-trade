export type MindmapSlot = { id: string; labelKo: string; accepted: string[] };

/** 공백·끝 문장부호 제거 후 비교 */
export function normalize(s: string): string {
  return s.replace(/\s+/g, '').replace(/[.,!?~。…]+$/u, '');
}

/** 단원 생각 그물 — 무역 가지 [교과서 pp.114~115] */
export const MINDMAP_SLOTS: MindmapSlot[] = [
  { id: 'meaning', labelKo: '나라와 나라 사이에 물자나 서비스를 사고파는 것', accepted: ['무역', '무역이란', '나라와나라사이에사고파는것'] },
  { id: 'import', labelKo: '다른 나라에서 사 오는 것', accepted: ['수입', '수입하는것', '사오는것'] },
  { id: 'export', labelKo: '다른 나라에 파는 것', accepted: ['수출', '수출하는것', '파는것'] },
  { id: 'cause', labelKo: '무역하는 까닭: 나라마다 자연환경·자원·자본·기술이 ○○', accepted: ['차이', '차이가있다', '차이가난다', '다르다', '다름', '다르기때문', '다르기때문에', '달라서', '서로다르다'] },
  { id: 'interdependence', labelKo: '서로 잘하는 것으로 협력하는 관계', accepted: ['상호의존', '서로의존', '의존', '서로의지한다'] },
];

export function isAccepted(slotId: string, answer: string): boolean {
  const slot = MINDMAP_SLOTS.find((x) => x.id === slotId);
  const n = normalize(answer);
  return !!slot && n !== '' && slot.accepted.map(normalize).includes(n);
}
