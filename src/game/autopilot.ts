import type { PortId } from '../content/types';
import type { GameState } from '../engine/types';

export type Autopilot = { sailTo(port: PortId): Promise<void>; dock(): void; state(): GameState | null };

/** e2e 전용 자동 조타는 URL ?e2e=1 일 때만 */
export const shouldExposeAutopilot = (search: string) => new URLSearchParams(search).get('e2e') === '1';

export function installAutopilot(api: Autopilot): void {
  if (shouldExposeAutopilot(window.location.search)) (window as unknown as { __ktrade: Autopilot }).__ktrade = api;
}
