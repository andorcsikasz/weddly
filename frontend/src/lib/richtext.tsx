// A minimal markdown-lite: `**bold**` and `*italic*`, nothing else. The
// couple's free-text guest-page fields (welcome note, "Good to know") are
// plain strings with no rich-text editor behind them — this lets a Bold/Italic
// toolbar button wrap the current selection in plain-text markers, and lets
// the render side turn those markers into <strong>/<em>. No markdown library:
// two marks are the whole feature.

import { Bold, Italic } from "lucide-react";
import { type ReactNode, type RefObject, useLayoutEffect, useRef } from "react";

const BOLD = "**";
const ITALIC = "*";

/** Turns `**bold**` / `*italic*` runs into <strong>/<em>; everything else
 *  (including newlines — callers keep `whitespace-pre-line`) passes through
 *  untouched. Bold is matched first so `**x**` isn't read as two italic runs
 *  around an empty string. */
export function renderFormatted(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      parts.push(<strong key={key++}>{m[1]}</strong>);
    } else {
      parts.push(<em key={key++}>{m[2]}</em>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Toggle `marker` on the current selection of `value` (start/end are
 *  character offsets, as read from an <input>/<textarea>'s selectionStart/
 *  End). Three cases: the selection IS exactly `marker…marker` → strip it;
 *  the selection sits directly inside a `marker…marker` pair → strip the
 *  surrounding pair; otherwise → wrap the selection (an empty selection wraps
 *  nothing, leaving the caret between the two markers to type into).
 *
 *  The neighbour-strip case excludes matches that are really the OTHER
 *  marker's edge (an italic toggle must not eat one star off a `**bold**`
 *  span it's sitting inside — that should nest, `**wo*rld*(...)`-style, not
 *  corrupt the bold). */
function wrapSelection(
  value: string,
  start: number,
  end: number,
  marker: string,
): { value: string; start: number; end: number } {
  const selected = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);
  const isBold = marker === BOLD;

  if (
    selected.length >= marker.length * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker) &&
    (isBold || (!selected.startsWith(BOLD) && !selected.endsWith(BOLD)))
  ) {
    const inner = selected.slice(marker.length, selected.length - marker.length);
    return { value: before + inner + after, start, end: start + inner.length };
  }

  const beforeIsMarker = before.endsWith(marker) && (isBold || !before.endsWith(BOLD));
  const afterIsMarker = after.startsWith(marker) && (isBold || !after.startsWith(BOLD));
  if (beforeIsMarker && afterIsMarker) {
    const nextBefore = before.slice(0, before.length - marker.length);
    const nextAfter = after.slice(marker.length);
    return {
      value: nextBefore + selected + nextAfter,
      start: start - marker.length,
      end: end - marker.length,
    };
  }

  const inserted = marker + selected + marker;
  return {
    value: before + inserted + after,
    start: start + marker.length,
    end: start + marker.length + selected.length,
  };
}

/** Bold/Italic buttons for a plain `<input>`/`<textarea>`. Wraps the current
 *  selection in `**`/`*` markers and restores focus + selection after the
 *  controlled value updates (a `useLayoutEffect` keyed on `value`, so it fires
 *  once React has committed the new value into the field — works whether the
 *  field is local draft state or a lifted parent state). Buttons take
 *  `onMouseDown` preventDefault so clicking one never blurs the field (which
 *  would otherwise commit/cancel an inline editor mid-edit). */
export function FormatToolbar({
  fieldRef,
  value,
  onChange,
  boldLabel,
  italicLabel,
  className = "",
}: {
  fieldRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
  boldLabel: string;
  italicLabel: string;
  className?: string;
}) {
  const pending = useRef<{ start: number; end: number } | null>(null);

  useLayoutEffect(() => {
    const sel = pending.current;
    if (!sel) return;
    pending.current = null;
    const el = fieldRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(sel.start, sel.end);
  }, [value, fieldRef]);

  function apply(marker: string) {
    const el = fieldRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const result = wrapSelection(el.value, start, end, marker);
    pending.current = { start: result.start, end: result.end };
    onChange(result.value);
  }

  const btnCls =
    "inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-paper-200 hover:text-ink-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-100 dark:focus-visible:ring-paper-100";

  return (
    <div className={`flex items-center gap-0.5 ${className}`}>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => apply(BOLD)}
        aria-label={boldLabel}
        title={boldLabel}
        className={btnCls}
      >
        <Bold size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => apply(ITALIC)}
        aria-label={italicLabel}
        title={italicLabel}
        className={btnCls}
      >
        <Italic size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
