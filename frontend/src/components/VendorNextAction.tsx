// Next Best Action + the attention band, the two renderings of one derivation.
//
// Neither component decides anything: the verdict arrives on the client payload
// already computed by `shared/vendor_next_action.ts`, and this file only picks
// the copy, the icon and where the CTA lands. That is deliberate — the moment a
// screen re-derives "is this urgent" from raw fields, the list and the detail
// start disagreeing about the same lead.
//
// Colour follows the vendor-portal rule: blush is the one interactive colour
// (the primary CTA), amber carries the warning (the reason chip), everything
// else is the neutral paper/ink scale. Icons are drawn bare on the surface —
// no tinted medallion.

import {
  ArrowRight,
  BellOff,
  CalendarClock,
  CircleDollarSign,
  Clock,
  FileText,
  Inbox,
  ListChecks,
  MessageSquare,
  Star,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { VendorClientView } from "@shared/vendor_clients";
import type { VendorActionKey, VendorAttention } from "@shared/vendor_next_action";
import { ATTENTION_BAND_MAX, PASSIVE_ACTIONS, compareAttention } from "@shared/vendor_next_action";
import { useT } from "../lib/i18n";

/** Where on the client detail each action's work actually happens. The list
 *  band links to `/vendor/clients/:id#<anchor>`; the detail page scrolls to the
 *  same anchor rather than navigating. A passive action has no target, which is
 *  what makes it render as a label instead of a button. */
export const ACTION_ANCHOR: Partial<Record<VendorActionKey, string>> = {
  reply: "vc-thread",
  follow_up: "vc-thread",
  request_review: "vc-thread",
  record_contract: "vc-crm",
  add_schedule: "vc-payments",
  chase_payment: "vc-payments",
  release_or_extend: "vc-hold",
};

const ACTION_ICON: Record<VendorActionKey, LucideIcon> = {
  open: Inbox,
  reply: MessageSquare,
  follow_up: MessageSquare,
  await: Clock,
  record_contract: FileText,
  add_schedule: ListChecks,
  chase_payment: CircleDollarSign,
  release_or_extend: Timer,
  request_review: Star,
  prepare: CalendarClock,
  none: Clock,
};

/** Scroll the detail page to the section an action belongs to, and put focus on
 *  the first thing there so a keyboard user lands where the mouse user looks. */
export function scrollToActionTarget(anchor: string): void {
  const el = document.getElementById(anchor);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  const focusable = el.querySelector<HTMLElement>(
    "textarea, input:not([type=hidden]), select, button:not([disabled])",
  );
  focusable?.focus({ preventScroll: true });
}

/** "3 hours" / "4 days" for an elapsed condition. Days once it has been longer
 *  than a day, because "31h" is a number a vendor has to convert in their head. */
function useAgeLabel() {
  const { t } = useT();
  return (a: VendorAttention): string =>
    a.days >= 1
      ? t("vendor.attention.age_days", { count: a.days })
      : t("vendor.attention.age_hours", { count: a.hours });
}

/** The human sentence behind an attention row. Every rule says WHY, with its
 *  own number in it — a band that just says "needs attention" is a badge, and a
 *  badge is what the vendor learns to ignore. */
export function useAttentionReason(): (a: VendorAttention) => string {
  const { t } = useT();
  const age = useAgeLabel();
  return (a: VendorAttention): string => {
    // `date_soon` is anchored on the event, so its `days` counts FORWARD and the
    // elapsed-age formatting would read backwards.
    if (a.key === "date_soon") return t("vendor.attention.reason_date_soon", { count: a.days });
    if (a.key === "review_due") return t("vendor.attention.reason_review_due");
    // Forward-anchored too: `hours` is the time LEFT on the hold, so the
    // elapsed-age formatting would read backwards here as well.
    if (a.key === "hold_expiring") {
      return t("vendor.attention.reason_hold_expiring", { count: a.hours });
    }
    return t(`vendor.attention.reason_${a.key}`, { age: age(a) });
  };
}

/** The primary-CTA label for an action. */
export function useActionLabel(): (key: VendorActionKey) => string {
  const { t } = useT();
  return (key: VendorActionKey) => t(`vendor.next.action_${key}`);
}

/** The one-line explanation under the CTA on the detail page. */
export function useActionHint(): (key: VendorActionKey) => string {
  const { t } = useT();
  return (key: VendorActionKey) => t(`vendor.next.hint_${key}`);
}

/** The Next Best Action bar at the top of a client detail. One primary control,
 *  or a quiet line when nothing is owed — `await` and `prepare` are real
 *  answers, and inventing a button for them would be the "four equal buttons"
 *  problem again in a new costume. */
export function NextActionBar({ client }: { client: VendorClientView }) {
  const { t } = useT();
  const label = useActionLabel();
  const hint = useActionHint();
  const reason = useAttentionReason();
  const action = client.next_action;
  const Icon = ACTION_ICON[action];
  const anchor = ACTION_ANCHOR[action];
  const passive = PASSIVE_ACTIONS.has(action);
  if (action === "none") return null;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-paper-300 bg-paper-50 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-umber-700 dark:bg-umber-900">
      <div className="flex min-w-0 items-start gap-3">
        <Icon
          size={20}
          strokeWidth={1.5}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-steel-600 dark:text-steel-300"
        />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-paper-400">
            {t("vendor.next.title")}
          </p>
          <p className="font-grotesk text-base font-semibold text-ink-900 dark:text-paper-50">
            {label(action)}
          </p>
          <p className="mt-0.5 text-sm text-ink-600 dark:text-paper-300">
            {client.attention ? reason(client.attention) : hint(action)}
          </p>
        </div>
      </div>
      {!passive && anchor ? (
        <button
          type="button"
          onClick={() => scrollToActionTarget(anchor)}
          className="btn btn-sm shrink-0 self-start bg-blush-500 text-white hover:bg-blush-600 sm:self-auto"
        >
          {label(action)}
          <ArrowRight size={15} aria-hidden="true" className="ml-1.5" />
        </button>
      ) : null}
    </section>
  );
}

/** The "needs attention" band above the clients table. Hidden entirely when
 *  nothing qualifies, which is the normal state and the point: a band that is
 *  always there is a header, not a signal. */
export function AttentionBand({
  clients,
  onSnooze,
}: {
  clients: VendorClientView[];
  onSnooze: (client: VendorClientView) => void;
}) {
  const { t } = useT();
  const label = useActionLabel();
  const reason = useAttentionReason();

  const rows = clients
    .filter((c): c is VendorClientView & { attention: VendorAttention } => c.attention !== null)
    .sort((a, b) => compareAttention(a.attention, b.attention));
  if (rows.length === 0) return null;
  const shown = rows.slice(0, ATTENTION_BAND_MAX);
  const hidden = rows.length - shown.length;

  return (
    <section
      className="mb-4 overflow-hidden rounded-xl border border-amber-300 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-500/10"
      aria-labelledby="vendor-attention-title"
    >
      <h2
        id="vendor-attention-title"
        className="border-b border-amber-300 px-4 py-2.5 font-grotesk text-xs font-semibold uppercase tracking-wide text-ink-700 dark:border-amber-500/40 dark:text-paper-200"
      >
        {t("vendor.attention.title", { count: rows.length })}
      </h2>
      <ul className="divide-y divide-amber-200 dark:divide-amber-500/25">
        {shown.map((c) => {
          const anchor = ACTION_ANCHOR[c.next_action];
          const href = `/vendor/clients/${c.id}${anchor ? `#${anchor}` : ""}`;
          return (
            <li
              key={c.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap"
            >
              <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                <Link
                  to={href}
                  className="truncate font-medium text-ink-900 underline-offset-2 hover:underline dark:text-paper-50"
                >
                  {c.couple_display_name}
                </Link>
                <p className="truncate text-xs text-ink-600 dark:text-paper-300">
                  {reason(c.attention)}
                </p>
              </div>
              <Link
                to={href}
                className="btn btn-sm shrink-0 bg-blush-500 text-white hover:bg-blush-600"
              >
                {label(c.next_action)}
              </Link>
              <button
                type="button"
                onClick={() => onSnooze(c)}
                aria-label={t("vendor.attention.snooze")}
                title={t("vendor.attention.snooze")}
                className="shrink-0 rounded-lg p-2 text-ink-500 transition-colors hover:bg-amber-100 hover:text-ink-800 dark:text-paper-400 dark:hover:bg-amber-500/20 dark:hover:text-paper-100"
              >
                <BellOff size={16} strokeWidth={1.5} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      {hidden > 0 ? (
        <p className="border-t border-amber-200 px-4 py-2 text-xs text-ink-600 dark:border-amber-500/25 dark:text-paper-300">
          {t("vendor.attention.more", { count: hidden })}
        </p>
      ) : null}
    </section>
  );
}
