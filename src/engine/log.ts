import type { Axis, GoodId, PortId, Recipe } from '../content/types';

/** PRD §9 LogEvent. towed·refuel 은 §4.7(예인·급유) 로그 */
export type LogEvent =
  | { t: number; type: 'judge_dir'; port: PortId; good: GoodId; answer: 'import' | 'export'; correct: boolean; attempt: 1 | 2 }
  | { t: number; type: 'judge_cause'; port: PortId; good: GoodId; answer: Axis; correct: boolean; attempt: 1 | 2 }
  | { t: number; type: 'trade'; from: PortId; to: PortId; good: GoodId; qty: number; price: number; dir: 'import' | 'export' | 'transit' }
  | { t: number; type: 'process'; recipe: Recipe['id']; inputsOrigin: PortId[] }
  | { t: number; type: 'event_choice'; event: string; choice: string }
  | { t: number; type: 'autarky'; turn: number }
  | { t: number; type: 'export_attempt_blocked'; good: GoodId }
  | { t: number; type: 'sentence'; text: string }
  | { t: number; type: 'mindmap'; slot: string; answer: string; correct: boolean }
  | { t: number; type: 'screen'; name: string }
  | { t: number; type: 'ledger_manual'; exporter: string; good: string; importer: string; correct: boolean }
  | { t: number; type: 'towed'; to: PortId }
  | { t: number; type: 'refuel'; port: PortId; fuel: number; cost: number };

/** t 를 뺀 입력 (유니언 각 갈래별로) */
export type LogInput = LogEvent extends infer E ? (E extends LogEvent ? Omit<E, 't'> : never) : never;

export type Log = { events: LogEvent[]; push: (evt: LogInput) => LogEvent };

/** t 는 1씩 증가하는 순번. 저장본을 넘기면 마지막 t 다음부터 잇는다 */
export function createLog(events: LogEvent[] = []): Log {
  let t = events.length ? events[events.length - 1].t : 0;
  return {
    events,
    push(evt) {
      const e = { ...evt, t: ++t } as LogEvent;
      events.push(e);
      return e;
    },
  };
}
