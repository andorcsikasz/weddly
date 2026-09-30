// "Your wedding moved. Move your open deadlines too?"
//
// The server keeps the question open (`couple.deadline_shift_from`) from the
// moment the date moves until someone answers it, so it survives a reload and
// reaches whichever partner opens the app next. Closing the dialog without
// answering only hides it for this visit; both buttons answer it for good.

import type { Couple } from "@shared/types";
import { useEffect, useState } from "react";
import { ApiError } from "../lib/api";
import { coupleApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { Dialog, useToast } from "./ui";

type Offer = { from: string; to: string; days: number; count: number };

export function DeadlineShiftPrompt({
  couple,
  onCoupleChange,
  onShifted,
}: {
  couple: Couple;
  onCoupleChange: (couple: Couple) => void;
  /** Called after deadlines actually moved, so the host can reload its tasks. */
  onShifted?: () => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = couple.deadline_shift_from;

  useEffect(() => {
    if (!pending || couple.archived_at) {
      setOffer(null);
      return;
    }
    let cancelled = false;
    coupleApi
      .deadlineShift()
      .then((r) => {
        if (cancelled) return;
        // Nothing left to move (every task got ticked meanwhile, or the date
        // went back): close the question quietly rather than ask about zero.
        if (!r.shift || r.shift.count === 0) {
          void coupleApi
            .answerDeadlineShift(false)
            .then((a) => {
              if (!cancelled) onCoupleChange(a.couple);
            })
            .catch(() => {});
          return;
        }
        setOffer(r.shift);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Re-check only when the question itself changes, not on every couple edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, couple.wedding_date, couple.archived_at]);

  async function answer(apply: boolean) {
    setBusy(true);
    try {
      const r = await coupleApi.answerDeadlineShift(apply);
      onCoupleChange(r.couple);
      setOffer(null);
      if (apply) {
        toast.success(t("dashboard.deadline_shift_done", { count: r.moved }));
        onShifted?.();
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  if (!offer) return null;
  const days = Math.abs(offer.days);
  return (
    <Dialog
      open
      role="dialog"
      title={t("dashboard.deadline_shift_title")}
      onClose={() => {
        if (!busy) setOffer(null);
      }}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={() => answer(false)} disabled={busy}>
            {t("dashboard.deadline_shift_keep")}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => answer(true)}
            disabled={busy}
          >
            {t("dashboard.deadline_shift_apply")}
          </button>
        </>
      }
    >
      <p>
        {offer.days > 0
          ? t("dashboard.deadline_shift_body_later", { days, count: offer.count })
          : t("dashboard.deadline_shift_body_earlier", { days, count: offer.count })}
      </p>
    </Dialog>
  );
}
