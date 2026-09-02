// Language switcher: an icon button that opens a small menu of every UI locale
// so the user PICKS the language to switch to, rather than blind-cycling through
// them (which got confusing once a third language shipped). Closes on an outside
// click or Escape, same pattern as NotificationBell.

import { Check, Languages } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { matchToolLangPath, toolPathFor } from "@shared/tool_faq";
import { LOCALE_NAMES, LOCALES, useT } from "../lib/i18n";

/** Default top-bar icon-button styling; overridable per shell via
 *  `buttonClassName` so the trigger matches its surroundings. */
const DEFAULT_BUTTON =
  "inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-700 transition-colors hover:bg-paper-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 dark:text-paper-200 dark:hover:bg-umber-800 dark:focus-visible:ring-paper-100";

export function LocaleSwitcher({
  buttonClassName = DEFAULT_BUTTON,
  className = "",
  align = "right",
  dataNavIcon = false,
  showCode = false,
}: {
  buttonClassName?: string;
  /** Applied to the positioning wrapper — use for responsive visibility
   *  (e.g. `hidden sm:block`). */
  className?: string;
  /** Which edge the menu hangs from. Right for top bars; left when the trigger
   *  sits on the left of its row. */
  align?: "left" | "right";
  /** Tags the trigger with `data-nav-icon` so the public header's over-hero CSS
   *  (index.css) recolors it white like the sibling icons. */
  dataNavIcon?: boolean;
  /** Show the active locale code beside the globe so language selection is
   *  discoverable without relying on icon recognition alone. */
  showCode?: boolean;
}) {
  const { t, locale, setLocale } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // On a `/{lang}/tools/{slug}` page the URL itself names the language, so
  // picking a new one from the switcher has to move to that tool's URL in
  // the new language, not just relabel the current URL's content. Every
  // other page keeps the plain setLocale-only behaviour below.
  const toolLangMatch = matchToolLangPath(pathname);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        className={buttonClassName}
        onClick={() => setOpen((o) => !o)}
        aria-label={t("nav.switch_language")}
        title={t("nav.switch_language")}
        aria-haspopup="menu"
        aria-expanded={open}
        {...(dataNavIcon ? { "data-nav-icon": "" } : {})}
      >
        <Languages size={18} aria-hidden="true" />
        {showCode && <span className="text-xs font-semibold uppercase">{locale}</span>}
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute z-50 mt-2 min-w-[168px] overflow-hidden rounded-xl border border-paper-300 bg-paper-50 py-1 shadow-pop dark:border-umber-700 dark:bg-umber-800 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-400 dark:text-umber-400">
            {t("nav.switch_language")}
          </p>
          {LOCALES.map((l) => (
            <button
              key={l}
              type="button"
              role="menuitemradio"
              aria-checked={l === locale}
              onClick={() => {
                if (l !== locale) {
                  setLocale(l);
                  if (toolLangMatch) navigate(toolPathFor(l, toolLangMatch.key));
                }
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-paper-100 dark:hover:bg-umber-900/50 ${
                l === locale
                  ? "font-semibold text-ink-900 dark:text-paper-50"
                  : "text-ink-700 dark:text-paper-200"
              }`}
            >
              <span>{LOCALE_NAMES[l]}</span>
              {l === locale && <Check size={15} aria-hidden="true" className="shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
