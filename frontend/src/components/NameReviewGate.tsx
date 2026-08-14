// The two couple-facing halves of the real-name rule, for workspaces that were
// created before the gate existed.
//
//   - inside the 3-day window: a notice band at the top of the app, naming the
//     deadline and linking to the fix.
//   - past it: a blocking card. The workspace is read-only on the server
//     (409 name_review_required), so an app that still looked editable would be
//     lying; this is the screen that explains the refusal and takes the fix.
//
// Both read `couple.name_review`, which the server recomputes from the LIVE
// names on every response. Saving real names therefore clears the band and the
// card in the same round trip, with nothing cached to invalidate.

import { AlertCircle } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { checkRealName } from "@shared/real_names";
import type { Couple } from "@shared/types";
import { useAuth } from "../lib/auth";
import { coupleApi } from "../lib/endpoints";
import { intlLocale } from "../lib/format";
import { useT } from "../lib/i18n";
import { realNameErrorKey } from "../lib/real_names";

export function NameReviewGate() {
  const { user } = useAuth();
  const { t, locale } = useT();
  const [couple, setCouple] = useState<Couple | null>(null);

  useEffect(() => {
    if (!user) {
      setCouple(null);
      return;
    }
    let alive = true;
    coupleApi
      .current()
      .then((r) => {
        if (alive) setCouple(r.couple);
      })
      .catch(() => {
        if (alive) setCouple(null);
      });
    return () => {
      alive = false;
    };
  }, [user]);

  const review = couple?.name_review ?? null;
  if (!couple || !review) return null;

  const deadline = new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(review.deadline));

  if (review.locked) {
    return <NameFixCard couple={couple} onFixed={setCouple} />;
  }

  return (
    <div
      data-banner
      className="relative border-b border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-xs sm:gap-x-4 sm:gap-y-2 sm:px-6 sm:py-2 sm:text-sm lg:px-8 xl:max-w-screen-2xl xl:px-10">
        <AlertCircle size={14} className="shrink-0 sm:h-4 sm:w-4" aria-hidden="true" />
        <p className="min-w-0 flex-1 sm:min-w-[14rem]">
          <span className="font-semibold">{t("real_names.notice_title")}</span>{" "}
          <span className="hidden text-amber-800 dark:text-amber-200 sm:inline">
            {t("real_names.notice_body", {
              names: `${couple.bride_name} & ${couple.groom_name}`,
            })}{" "}
            {t("real_names.notice_deadline", { date: deadline })}
          </span>
        </p>
        <Link to="/app/profile" className="btn-primary btn-sm">
          {t("real_names.notice_cta")}
        </Link>
      </div>
    </div>
  );
}

/** The two inputs and the save, as the blocking card. The pre-deadline notice
 *  sends the couple to Profile instead, where the same two fields already live
 *  next to everything else about the workspace. */
function NameFixCard({
  couple,
  onFixed,
}: {
  couple: Couple;
  onFixed: (couple: Couple) => void;
}) {
  const { t } = useT();
  const [bride, setBride] = useState(couple.bride_name);
  const [groom, setGroom] = useState(couple.groom_name);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const brideVerdict = checkRealName(bride);
  const groomVerdict = checkRealName(groom);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (brideVerdict || groomVerdict) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    setFailed(false);
    try {
      const r = await coupleApi.update({ bride_name: bride.trim(), groom_name: groom.trim() });
      onFixed(r.couple);
    } catch {
      // The server runs the same rule, so a refusal here means the names are
      // still not real. Show the fields' own errors rather than a toast.
      setFailed(true);
      setShowErrors(true);
    } finally {
      setSaving(false);
    }
  }

  const form = (
    <form onSubmit={onSubmit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="nr_bride" className="field-label">
            {t("real_names.bride_label")}
          </label>
          <input
            id="nr_bride"
            className="input"
            value={bride}
            onChange={(e) => setBride(e.target.value)}
            onBlur={() => setShowErrors(true)}
            aria-invalid={showErrors && brideVerdict !== null}
          />
          {showErrors && brideVerdict && (
            <p className="mt-1.5 text-sm text-blush-700 dark:text-blush-300">
              {t(realNameErrorKey(brideVerdict.reason))}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="nr_groom" className="field-label">
            {t("real_names.groom_label")}
          </label>
          <input
            id="nr_groom"
            className="input"
            value={groom}
            onChange={(e) => setGroom(e.target.value)}
            onBlur={() => setShowErrors(true)}
            aria-invalid={showErrors && groomVerdict !== null}
          />
          {showErrors && groomVerdict && (
            <p className="mt-1.5 text-sm text-blush-700 dark:text-blush-300">
              {t(realNameErrorKey(groomVerdict.reason))}
            </p>
          )}
        </div>
      </div>
      {failed && (
        <p className="mt-3 text-sm text-blush-700 dark:text-blush-300">
          {t("common.error_generic")}
        </p>
      )}
      <button type="submit" className="btn-primary mt-6 w-full" disabled={saving}>
        {saving ? t("real_names.locked_saving") : t("real_names.locked_save")}
      </button>
    </form>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-review-title"
        className="card w-full max-w-lg sm:p-8"
      >
        <h1 id="name-review-title" className="font-serif text-2xl italic text-ink-900">
          {t("real_names.locked_title")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-600">{t("real_names.locked_body")}</p>
        <div className="mt-6">{form}</div>
      </div>
    </div>
  );
}
