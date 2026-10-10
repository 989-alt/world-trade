import { useState } from 'preact/hooks';
import type { GameEvent } from '../content/types';
import './events.css';

export type EventCardView = {
  headline: string;
  choices: { id: string; label: string; plus: string; minus: string; chosen: boolean }[];
  /** 선택 뒤에만 채워진다 */
  feedback: { text: string; source: string } | null;
  showContinue: boolean;
};

export function viewModel(event: GameEvent, chosenId: string | null): EventCardView {
  const picked = event.choices.find((c) => c.id === chosenId) ?? null;
  return {
    headline: event.titleKo,
    choices: event.choices.map((c) => ({ id: c.id, label: c.labelKo, plus: c.plus, minus: c.minus, chosen: c.id === picked?.id })),
    feedback: picked ? { text: picked.feedbackKo, source: picked.source } : null,
    showContinue: picked !== null,
  };
}

type Props = { event: GameEvent; onChoose: (choiceId: string) => void; reduceMotion: boolean };

export function EventCard({ event, onChoose, reduceMotion }: Props) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const vm = viewModel(event, chosen);
  const proceed = () => {
    if (chosen === null || sent) return;
    setSent(true);
    onChoose(chosen);
  };
  return (
    <div class={`ev-card${reduceMotion ? ' ev-still' : ''}`} role="dialog" aria-modal="true" aria-label="무전">
      <span class="ev-tag">무전</span>
      <h2 class="ev-title">{vm.headline}</h2>
      <div class="ev-opts">
        {vm.choices.map((c) => (
          <button
            key={c.id}
            type="button"
            class={`ev-opt${c.chosen ? ' on' : ''}`}
            disabled={chosen !== null}
            onClick={() => setChosen(c.id)}
          >
            <span class="ev-label">{c.label}</span>
            <span class="ev-plus">{c.plus}</span>
            <span class="ev-minus">{c.minus}</span>
          </button>
        ))}
      </div>
      {vm.feedback && (
        <p class="ev-feedback">
          {vm.feedback.text} <small>({vm.feedback.source})</small>
        </p>
      )}
      {vm.showContinue && (
        <button type="button" class="ev-go" disabled={sent} onClick={proceed}>
          계속
        </button>
      )}
    </div>
  );
}
