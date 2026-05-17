// Desktop-only keyboard shortcut reference. Opens with `?` (Shift+/) anywhere
// in the app, listing every shortcut that actually exists. We intentionally do
// not advertise this on mobile — no physical keys, no value.
import { useEffect, useState } from "react";
import { Dialog } from "./ui/Dialog";
import { useT } from "../lib/i18n";

type Shortcut = { keys: string[]; descKey: string };
type Group = { titleKey: string; items: Shortcut[] };

const GROUPS: Group[] = [
  {
    titleKey: "shortcuts.group_global",
    items: [
      { keys: ["?"], descKey: "shortcuts.global_help" },
      { keys: ["Esc"], descKey: "shortcuts.global_dismiss" },
    ],
  },
  {
    titleKey: "shortcuts.group_seating",
    items: [
      { keys: ["N"], descKey: "shortcuts.seating_new_table" },
      { keys: ["←", "→", "↑", "↓"], descKey: "shortcuts.seating_move" },
      { keys: ["Shift", "←"], descKey: "shortcuts.seating_fine" },
      { keys: ["[", "]"], descKey: "shortcuts.seating_seats" },
      { keys: ["Delete"], descKey: "shortcuts.seating_delete" },
    ],
  },
  {
    titleKey: "shortcuts.group_rsvp",
    items: [{ keys: ["Shift", "K"], descKey: "shortcuts.rsvp_keyboard_mode" }],
  },
];

export function KeyboardShortcutsSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useT();
  return (
    <Dialog
      open={open}
      title={t("shortcuts.title")}
      role="dialog"
      closeOnBackdrop={true}
      onClose={onClose}
      footer={
        <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
          {t("shortcuts.close")}
        </button>
      }
    >
      <p className="mb-4 text-xs text-ink-500 dark:text-umber-300">{t("shortcuts.hint")}</p>
      <div className="space-y-5">
        {GROUPS.map((g) => (
          <section key={g.titleKey}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
              {t(g.titleKey)}
            </h3>
            <ul className="divide-y divide-paper-200 dark:divide-umber-700">
              {g.items.map((it) => (
                <li
                  key={it.descKey}
                  className="flex items-center justify-between gap-4 py-2 text-sm"
                >
                  <span className="text-ink-700 dark:text-paper-100">{t(it.descKey)}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {it.keys.map((k, idx) => (
                      <kbd
                        key={`${k}-${idx}`}
                        className="inline-flex min-w-[1.75rem] items-center justify-center rounded-md border border-paper-300 bg-paper-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink-800 shadow-sm dark:border-umber-600 dark:bg-umber-700 dark:text-paper-100"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

/** Global `?` listener — opens the sheet from anywhere in /app. Ignores key
 *  events that originate inside form fields so typing "?" into a textarea
 *  doesn't trigger the modal. md:+ only — there's no point on touch devices. */
export function useShortcutsHotkey(): {
  open: boolean;
  setOpen: (v: boolean) => void;
} {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      // matchMedia gate — desktop-only. Touch devices have no `?` key anyway,
      // but a Bluetooth keyboard paired with a phone shouldn't pop the modal
      // because the layout assumes a desktop-width Dialog.
      if (typeof window.matchMedia === "function") {
        if (!window.matchMedia("(min-width: 768px)").matches) return;
      }
      e.preventDefault();
      setOpen((v) => !v);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return { open, setOpen };
}
