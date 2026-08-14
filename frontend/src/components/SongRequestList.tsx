// Song-request editor: one row per song with an optional attached URL. The
// link input is hidden behind a chip so the default state stays tidy; clicking
// the chip reveals the URL field for that row only. Shared by the couple-side
// guest drawer (GuestsPage.tsx) and the guest-facing RSVP form
// (HouseholdRsvpForm.tsx) so both sides read/write the identical encoding.
import { Link2, Music, Plus, X } from "lucide-react";
import { useState } from "react";
import { useT } from "../lib/i18n";

export interface SongEntry {
  title: string;
  url: string;
}

// Each non-empty line is one song; if a line contains a URL we treat it as an
// attached link and the rest as the title. Backwards-compatible with the
// prior single-line free-text format (a line with no URL is just a title).
const SONG_URL_RE = /\bhttps?:\/\/\S+/i;

export function parseSongRequests(s: string | null): SongEntry[] {
  if (!s) return [];
  return s
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(SONG_URL_RE);
      if (!m) return { title: line, url: "" };
      const url = m[0];
      const title = line.replace(SONG_URL_RE, "").trim();
      return { title: title || url, url };
    });
}

export function serializeSongRequests(entries: SongEntry[]): string | null {
  const lines: string[] = [];
  for (const e of entries) {
    const title = e.title.trim();
    const url = e.url.trim();
    if (!title && !url) continue;
    if (title && url) lines.push(`${title} ${url}`);
    else lines.push(title || url);
  }
  return lines.length ? lines.join("\n") : null;
}

interface SongRow extends SongEntry {
  /** Stable React key. Local-only; stripped before bubbling up. */
  ui_key: string;
}

function makeSongKey(): string {
  return `s_${Math.random().toString(36).slice(2, 9)}`;
}

/** Collapse a doubled protocol prefix in a pasted URL. The link input is
 *  pre-seeded with "https://" when the user clicks the chain icon, so pasting
 *  a full URL ("https://www.youtube.com/...") used to produce
 *  "https://https://www.youtube.com/...". Match two or more consecutive
 *  http(s):// prefixes and keep only the LAST one — that way pasting an
 *  `http://...` URL into a `https://`-seeded field correctly downgrades to
 *  the user's intended protocol. Partial typing like "https://h" is left
 *  alone (regex requires two FULL prefixes). */
function normalizeSongUrl(raw: string): string {
  return raw.replace(/^(?:https?:\/\/){2,}/i, (m) => {
    const matches = m.match(/https?:\/\//gi);
    return matches ? (matches[matches.length - 1] as string) : m;
  });
}

export function SongRequestList({
  entries,
  onChange,
}: {
  entries: SongEntry[];
  onChange: (next: SongEntry[]) => void;
}) {
  const { t } = useT();
  // Owns the row array with stable ids. We seed once from `entries` on mount;
  // bubbling up via onChange is what keeps the parent state in sync. We
  // intentionally don't re-seed from `entries` after mount — neither caller
  // resets these rows from outside, and re-seeding would clobber typing.
  const [rows, setRows] = useState<SongRow[]>(() =>
    entries.length === 0
      ? [{ ui_key: makeSongKey(), title: "", url: "" }]
      : entries.map((e) => ({ ui_key: makeSongKey(), ...e })),
  );

  function bubble(next: SongRow[]) {
    setRows(next);
    onChange(next.map(({ ui_key: _, ...rest }) => rest));
  }
  function update(idx: number, patch: Partial<SongEntry>) {
    bubble(rows.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }
  function remove(idx: number) {
    const next = rows.filter((_, i) => i !== idx);
    bubble(next.length === 0 ? [{ ui_key: makeSongKey(), title: "", url: "" }] : next);
  }
  function add() {
    bubble([...rows, { ui_key: makeSongKey(), title: "", url: "" }]);
  }

  return (
    <div className="space-y-2">
      {rows.map((row, i) => {
        const hasLink = row.url.length > 0;
        return (
          <div
            key={row.ui_key}
            className="rounded-xl border border-paper-200 bg-paper-50 p-2 dark:border-umber-700 dark:bg-umber-800"
          >
            <div className="flex items-center gap-2">
              <Music size={14} aria-hidden className="shrink-0 text-ink-400 dark:text-umber-300" />
              <input
                className="input flex-1 border-0 bg-transparent px-1 py-1 focus:ring-0"
                type="text"
                value={row.title}
                onChange={(e) => update(i, { title: e.target.value })}
                placeholder={t("guests.song_title_placeholder")}
              />
              {!hasLink && (
                <button
                  type="button"
                  onClick={() => update(i, { url: "https://" })}
                  className="inline-flex items-center gap-1 rounded-full border border-paper-300 px-2 py-1 text-xs text-ink-600 hover:border-ink-400 dark:border-umber-700 dark:text-paper-100 dark:hover:border-umber-600"
                  aria-label={t("guests.song_add_link")}
                  title={t("guests.song_add_link")}
                >
                  <Link2 size={12} aria-hidden />
                </button>
              )}
              {rows.length > 1 || row.title || row.url ? (
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="inline-flex shrink-0 items-center justify-center rounded-full p-1 text-ink-400 hover:bg-paper-200 hover:text-ink-700 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-100"
                  aria-label={t("guests.song_remove")}
                  title={t("guests.song_remove")}
                >
                  <X size={14} aria-hidden />
                </button>
              ) : null}
            </div>
            {hasLink && (
              <div className="mt-1.5 flex items-center gap-2 pl-6">
                <Link2
                  size={12}
                  aria-hidden
                  className="shrink-0 text-ink-400 dark:text-umber-300"
                />
                <input
                  className="input flex-1 border-0 bg-transparent px-1 py-1 font-mono text-base focus:ring-0 sm:text-xs"
                  type="url"
                  value={row.url}
                  onChange={(e) => update(i, { url: normalizeSongUrl(e.target.value) })}
                  placeholder="https://"
                />
              </div>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-paper-300 px-3 py-1 text-xs text-ink-500 hover:border-ink-400 hover:text-ink-700 dark:border-umber-700 dark:text-umber-300 dark:hover:border-umber-600 dark:hover:text-paper-100"
      >
        <Plus size={12} aria-hidden /> {t("guests.song_add")}
      </button>
    </div>
  );
}
