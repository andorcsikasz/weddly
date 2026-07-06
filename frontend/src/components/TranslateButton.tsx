// Small "translate from the other language" button for the bilingual vendor
// "Leírás" fields. Directional: on the English field it translates the Hungarian
// text into English (and vice versa). Self-hiding — it fetches the feature-flag
// once (translateApi.availability) and renders nothing when DeepL isn't
// configured server-side, so the field UI is unchanged in that case.
//
// Overwrite-safe: when the target field already has content, it asks for
// confirmation before replacing it (portal ConfirmDialog, not window.confirm).

import { Languages } from "lucide-react";
import { useEffect, useState } from "react";
import type { TranslateLang } from "@shared/translate";
import { translateApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useConfirm } from "./ui/ConfirmDialogProvider";
import { useToast } from "./ui/ToastProvider";

// Module-level so both buttons on the page share ONE availability probe rather
// than firing the request twice. Resolves to false on any error (feature simply
// stays hidden).
let availabilityProbe: Promise<boolean> | null = null;

function useTranslateAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!availabilityProbe) {
      availabilityProbe = translateApi
        .availability()
        .then((r) => r.available)
        .catch(() => false);
    }
    void availabilityProbe.then((v) => {
      if (alive) setAvailable(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return available;
}

export function TranslateButton({
  sourceText,
  source,
  target,
  hasExisting,
  disabled,
  onTranslated,
}: {
  /** The other language's current text — what gets translated. */
  sourceText: string;
  source: TranslateLang;
  target: TranslateLang;
  /** True when the target field already holds text (triggers overwrite confirm). */
  hasExisting: boolean;
  disabled?: boolean;
  onTranslated: (text: string) => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const available = useTranslateAvailable();
  const [busy, setBusy] = useState(false);

  if (!available) return null;

  const src = sourceText.trim();

  async function run() {
    if (!src || busy) return;
    if (hasExisting) {
      const ok = await confirm({
        title: t("translate.overwrite_title"),
        body: t("translate.overwrite_body"),
        confirmLabel: t("translate.overwrite_confirm"),
        cancelLabel: t("common.cancel"),
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await translateApi.translate({ text: src, source, target });
      onTranslated(res.text);
    } catch {
      toast.error(t("translate.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={disabled || busy || !src}
      title={!src ? t("translate.needs_source") : undefined}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-paper-100 px-3 py-1 text-[11px] font-medium normal-case tracking-normal text-ink-700 transition-colors hover:bg-paper-200 hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-umber-700 dark:text-paper-100 dark:hover:bg-umber-700/80"
    >
      <Languages size={13} aria-hidden="true" />
      <span>{busy ? t("translate.working") : t(`translate.from_${source.toLowerCase()}`)}</span>
    </button>
  );
}
