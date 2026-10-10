import type { Axis, GoodId, Item as ContentItem, PortId, Recipe } from '../content/types';

/** 화물 한 묶음. origin = 산 항구(부산 창고·공장 출력은 'busan'). 가공 inputsOrigin 추적용 */
export type Item = ContentItem & { origin?: PortId };

export type EventId = string;
export type Stage = 'prologue' | 'main' | 'epilogue' | 'done';
export type Location = PortId | 'sea';

/** PRD §9 LogEvent + 엔진이 남기는 항해·입항 로그. log.ts(T04) 갈래와 같은 모양 */
export type LogEvent =
  | { t: number; type: 'judge_dir'; port: PortId; good: GoodId; answer: 'import' | 'export'; correct: boolean; attempt: 1 | 2 }
  | { t: number; type: 'judge_cause'; port: PortId; good: GoodId; answer: Axis; correct: boolean; attempt: 1 | 2 }
  | { t: number; type: 'trade'; from: PortId; to: PortId; good: GoodId; qty: number; price: number; dir: 'import' | 'export' | 'transit'; fee?: number; flag?: 'buying_own_specialty' }
  | { t: number; type: 'process'; recipe: Recipe['id']; inputsOrigin: PortId[] }
  | { t: number; type: 'event_choice'; event: EventId; choice: string }
  | { t: number; type: 'autarky'; turn: number }
  | { t: number; type: 'export_attempt_blocked'; good: GoodId }
  | { t: number; type: 'sentence'; text: string }
  | { t: number; type: 'mindmap'; slot: string; answer: string; correct: boolean }
  | { t: number; type: 'screen'; name: string }
  /** 에필로그 ① 수동 일지 1행(학생이 쓴 세 칸 그대로) */
  | { t: number; type: 'ledger_manual'; exporter: string; good: string; importer: string; correct: boolean }
  | { t: number; type: 'towed'; to: PortId }
  | { t: number; type: 'refuel'; port: PortId; fuel: number; cost: number }
  | { t: number; type: 'port_call'; port: PortId; turn: number }
  | { t: number; type: 'depart'; port: PortId; departure: number }
  | { t: number; type: 'stage'; stage: Stage }
  | { t: number; type: 'load'; good: GoodId; qty: number }
  | { t: number; type: 'buy_home'; good: GoodId; qty: number; price: number };

export type LogInput = LogEvent extends infer E ? (E extends LogEvent ? Omit<E, 't'> : never) : never;

export type GameState = {
  version: 1;
  seed: number;
  profile: { nickname: string; seat: string };
  cash: number;
  fuel: number;
  /** 배. 수량 합 ≤ CARGO_CAP */
  cargo: Item[];
  /** 부산 창고 */
  depot: Item[];
  factoryLevel: number;
  /** 고용 수치(표시용) = EMPLOYMENT_PER_LEVEL × factoryLevel */
  employment: number;
  reputation: number;
  location: Location;
  /** 지도 비율 좌표(0~1) */
  shipPos: { x: number; y: number };
  /** 입항 횟수 0~6 (머물기·예인 포함) */
  portCalls: number;
  /** 출항 횟수. 필수 이벤트 n번째 = n번째 출항 */
  departures: number;
  stage: Stage;
  /** 이번 판 6장: 앞 5장 = 필수(seed 순서), 마지막 = 선택 1장 */
  eventQueue: EventId[];
  eventsDrawn: EventId[];
  log: LogEvent[];
  flags: {
    /** 급유 단가 배수(자동화 항만 0.8) */
    refuelFactor: number;
    /** 누적 수출액(공장 레벨 임계값) */
    exportValue: number;
    /** 이벤트로 바뀐 공장 레벨 증감 */
    factoryDelta: number;
    /** 이벤트로 바뀐 상품 시세 배수 */
    priceFactor: Partial<Record<GoodId, number>>;
    /** 이번 입항이 예인 입항(거래 불가·급유만) */
    towedCall: boolean;
  };
};

export type Reason =
  | 'cargo_full' | 'no_cash' | 'not_in_depot' | 'not_in_cargo' | 'missing_inputs'
  | 'not_sold_here' | 'not_in_port' | 'not_at_sea' | 'not_at_busan' | 'towed_no_trade'
  | 'no_fuel' | 'has_fuel' | 'tank_full' | 'bad_qty' | 'game_over' | 'wrong_stage'
  | 'unknown_event' | 'unknown_choice' | 'already_drawn';

export type Result = { state: GameState; reason?: Reason; flag?: 'buying_own_specialty' };
