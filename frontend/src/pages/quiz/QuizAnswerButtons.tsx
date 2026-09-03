// Shared A/B/C/D and A-or-B answer buttons — same Kahoot-flavoured colour +
// shape convention as the /games marketing preview (GamesPage.tsx's
// ANSWER_STYLES/Shape), lifted into the real product's own QuizPlay.css scope.

import { Check, X } from "lucide-react";

const STYLES = ["qz-answer-red", "qz-answer-blue", "qz-answer-yellow", "qz-answer-green"];
const SHAPES = ["triangle", "diamond", "circle", "square"] as const;

function Shape({ type }: { type: (typeof SHAPES)[number] }) {
  return <span className={`qz-shape qz-shape-${type}`} />;
}

export function QuizAnswerButtons({
  options,
  correctIndex,
  chosenIndex,
  disabled,
  onSelect,
}: {
  options: string[];
  /** Present only once the slide is revealed. */
  correctIndex?: number | null;
  chosenIndex?: number | null;
  disabled?: boolean;
  onSelect?: (index: number) => void;
}) {
  const revealing = correctIndex !== undefined;
  return (
    <div className="qz-answers-grid">
      {options.map((label, index) => {
        const chosen = chosenIndex === index;
        const correct = revealing && correctIndex === index;
        const muted = revealing && correctIndex !== null && !correct;
        return (
          <button
            key={`${index}-${label}`}
            type="button"
            disabled={disabled || revealing}
            onClick={() => onSelect?.(index)}
            className={`${STYLES[index % STYLES.length]} ${chosen ? "is-chosen" : ""} ${muted ? "is-muted" : ""}`}
          >
            <Shape type={SHAPES[index % SHAPES.length]!} />
            <span>{label}</span>
            {correct && <Check className="ml-auto" size={22} strokeWidth={3} aria-hidden />}
            {chosen && !correct && revealing && (
              <X className="ml-auto" size={22} strokeWidth={3} aria-hidden />
            )}
          </button>
        );
      })}
    </div>
  );
}
