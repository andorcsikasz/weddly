import { useId } from "react";
import { CURRENCIES, type Currency } from "@shared/types";
import { useT } from "../lib/i18n";
import { currencySymbol } from "../lib/format";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";

/** Pops on the first language switch where the user hasn't yet picked a
 *  display currency. Picking commits both the currency pref AND the pending
 *  locale switch in one step, so the visitor never sees a moment where the
 *  budget demo silently flipped from Ft to € just because they changed UI
 *  language. After the first pick, future language flips skip this dialog. */
export function CurrencyPrefDialog() {
  const { t, locale, pendingLocale, confirmCurrencyPref, cancelPendingLocale } = useT();
  const bodyId = useId();

  const open = pendingLocale !== null;
  // Use the about-to-be locale for label formatting — picking happens just
  // before the locale switch lands, but the user is mentally already there.
  const labelLocale = pendingLocale ?? locale;

  return (
    <Dialog
      open={open}
      title={t("currency_pref.title")}
      describedById={bodyId}
      onClose={cancelPendingLocale}
      role="dialog"
      closeOnBackdrop
      footer={
        <Button variant="outline" onClick={cancelPendingLocale}>
          {t("currency_pref.cancel")}
        </Button>
      }
    >
      <div id={bodyId} className="space-y-4">
        <p>{t("currency_pref.body")}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {CURRENCIES.map((c: Currency) => (
            <button
              key={c}
              type="button"
              onClick={() => confirmCurrencyPref(c)}
              className="flex flex-col items-center gap-1 rounded-xl border border-paper-300 bg-paper-50 px-4 py-3 text-ink-900 transition-colors hover:border-ink-700 hover:bg-paper-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 dark:border-umber-700 dark:bg-umber-900 dark:text-paper-50 dark:hover:border-paper-100 dark:hover:bg-umber-800"
            >
              <span className="font-serif text-2xl">{currencySymbol(c, labelLocale)}</span>
              <span className="text-xs uppercase tracking-wider text-ink-600 dark:text-umber-300">
                {c}
              </span>
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
