// Vendor clients list — couples that reached this vendor THROUGH Weddly (their
// Weddly-sourced bookings from `supplier_bookings`). The FREE tier sees the
// basic list (couple, event date, status) and a row link to the detail page;
// the CRM/payment columns (stage + balance) are PRO-gated and rendered locked
// behind an upgrade nudge for FREE vendors. Plan is read from the billing
// snapshot (vendorBillingApi.get) so the soft paywall matches the server gate.

import {
  ArrowRight,
  CircleCheck,
  CircleHelp,
  CircleX,
  Eye,
  Hourglass,
  Inbox,
  Lock,
  type LucideIcon,
  MailOpen,
  Search,
  Undo2,
  UserPlus,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Currency } from "@shared/types";
import type { VendorClientView } from "@shared/vendor_clients";
import { isVendorFeatureEnabled, type VendorPlan } from "@shared/vendor_plan";
import { Skeleton } from "../../components/ui";
import { vendorBillingApi, vendorClientsApi } from "../../lib/endpoints";
import { formatDate, formatMoney } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useDocumentTitle } from "../../lib/seo";

// Canonical inquiry-status ordering. Labels use the SAME vendor.clients
// namespace as the status select on the client detail form, so the badge, the
// filter pills and the form always agree; an unknown status falls back to its
// raw value so the list never breaks on new states.
const STATUS_ORDER = [
  "requested",
  "vendor_seen",
  "confirmed",
  "declined",
  "cancelled",
  "expired",
] as const;

/** Statuses that ended without money changing hands: their balance column is
 *  struck through so an abandoned contract value never reads as money owed. */
const VOID_STATUSES: ReadonlySet<string> = new Set(["declined", "cancelled", "expired"]);

// Icon + colour per status. The table shows just the coloured icon (labels
// live in an instant hover tooltip + sr-only text); below `sm` the grid stacks
// and there is no hover, so the label is rendered inline next to the icon.
const STATUS_ICON: Record<string, { Icon: LucideIcon; tone: string }> = {
  requested: { Icon: Inbox, tone: "text-amber-600 dark:text-amber-300" },
  vendor_seen: { Icon: Eye, tone: "text-steel-600 dark:text-steel-300" },
  confirmed: { Icon: CircleCheck, tone: "text-sage-700 dark:text-sage-300" },
  declined: { Icon: CircleX, tone: "text-red-600 dark:text-red-300" },
  cancelled: { Icon: Undo2, tone: "text-ink-400 dark:text-umber-400" },
  expired: { Icon: Hourglass, tone: "text-ink-400 dark:text-umber-400" },
};

function StatusBadge({ status }: { status: string }) {
  const { t } = useT();
  const known = (STATUS_ORDER as readonly string[]).includes(status);
  const label = known ? t(`vendor.clients.status_${status}`) : status;
  const { Icon, tone } = STATUS_ICON[status] ?? {
    Icon: CircleHelp,
    tone: "text-ink-400 dark:text-umber-400",
  };
  return (
    <span className="group relative inline-flex items-center gap-1.5">
      <Icon size={18} aria-hidden="true" className={tone} />
      <span className="sr-only">{label}</span>
      <span className={`text-xs font-medium sm:hidden ${tone}`} aria-hidden="true">
        {label}
      </span>
      {/* Instant hover tooltip (CSS only, no delay). Sits to the RIGHT of the
          icon so it never crosses the table container's overflow-hidden edge. */}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-full top-1/2 z-20 ml-1.5 hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-paper-200 bg-paper-50 px-2 py-1 text-[11px] font-medium text-ink-700 shadow-pop sm:group-hover:block dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
      >
        {label}
      </span>
    </span>
  );
}

// A PRO-only cell. On FREE it shows a muted lock instead of the value.
function ProCell({ locked, children }: { locked: boolean; children: React.ReactNode }) {
  const { t } = useT();
  if (locked) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-ink-400 dark:text-umber-400"
        title={t("vendor.upgrade.feature_locked")}
      >
        <Lock size={13} aria-hidden="true" />
        <span className="sr-only">{t("vendor.upgrade.feature_locked")}</span>
      </span>
    );
  }
  return <>{children}</>;
}

function UpgradeNudge() {
  const { t } = useT();
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-steel-200 bg-steel-50 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-steel-600/30 dark:bg-steel-600/15">
      <div className="min-w-0">
        <p className="font-grotesk text-sm font-semibold text-ink-900 dark:text-paper-50">
          {t("vendor.upgrade.title")}
        </p>
        <p className="mt-0.5 text-xs text-ink-600 dark:text-paper-300">
          {t("vendor.upgrade.body")}
        </p>
      </div>
      <Link
        to="/vendor/billing"
        className="btn btn-sm shrink-0 self-start bg-steel-600 text-white hover:bg-steel-700 sm:self-auto"
      >
        {t("vendor.upgrade.cta")}
      </Link>
    </div>
  );
}

// Ghost version of the real table: same column header + 4 placeholder rows
// built on the shared grid template, so the structure is legible from the
// first paint instead of three anonymous pills.
function GhostTable() {
  const { t } = useT();
  return (
    <div
      className="overflow-hidden rounded-xl border border-steel-200 dark:border-steel-800"
      aria-hidden="true"
    >
      <div className="hidden grid-cols-[2fr_1.2fr_1.2fr_1fr_1fr] gap-3 border-b border-steel-200 bg-steel-100 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-steel-800 sm:grid dark:border-steel-800 dark:bg-steel-900 dark:text-steel-200">
        <span>{t("vendor.clients.col_couple")}</span>
        <span>{t("vendor.clients.col_event_date")}</span>
        <span className="text-center">{t("vendor.clients.col_status")}</span>
        <span>{t("vendor.clients.col_stage")}</span>
        <span className="text-right">{t("vendor.clients.col_balance")}</span>
      </div>
      <div className="divide-y divide-paper-200 bg-white dark:divide-umber-700 dark:bg-umber-800">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="grid grid-cols-1 gap-2 px-4 py-3.5 sm:grid-cols-[2fr_1.2fr_1.2fr_1fr_1fr] sm:items-center sm:gap-3"
          >
            <Skeleton variant="line" height={14} width="70%" />
            <Skeleton variant="line" height={12} width="55%" />
            <div className="flex sm:justify-center">
              <Skeleton height={18} width={18} rounded="full" />
            </div>
            <Skeleton variant="line" height={12} width="45%" />
            <div className="flex sm:justify-end">
              <Skeleton variant="line" height={12} width={64} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Zero-clients state: a warm causal mini-flow (listing -> inquiry -> client)
// plus a single CTA back to the listing editor. There is no public listing URL
// to share (the supplier page is auth-gated under /app), so no copy-link here.
function EmptyClients() {
  const { t } = useT();
  const steps = [
    { Icon: Search, label: t("vendor.clients.empty_step_1") },
    { Icon: MailOpen, label: t("vendor.clients.empty_step_2") },
    { Icon: UserPlus, label: t("vendor.clients.empty_step_3") },
  ];
  return (
    <div className="rounded-xl border border-paper-300 bg-paper-50 p-8 text-center dark:border-umber-600 dark:bg-umber-900">
      <p className="font-grotesk text-base font-semibold text-ink-900 dark:text-paper-50">
        {t("vendor.clients.empty_title_new")}
      </p>

      <div className="mx-auto mt-6 flex max-w-xl flex-col items-stretch gap-2 sm:flex-row sm:items-start sm:justify-center sm:gap-2">
        {steps.map(({ Icon, label }, i) => (
          <Fragment key={label}>
            <div className="flex items-center gap-3 sm:w-32 sm:flex-col sm:gap-2 sm:text-center">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center">
                <Icon size={20} aria-hidden="true" className="text-steel-700 dark:text-steel-300" />
              </span>
              <span className="text-sm text-ink-700 dark:text-paper-200">{label}</span>
            </div>
            {i < steps.length - 1 && (
              <span className="flex h-8 items-center justify-center text-steel-400 dark:text-steel-500">
                <ArrowRight size={16} aria-hidden="true" className="rotate-90 sm:rotate-0" />
              </span>
            )}
          </Fragment>
        ))}
      </div>

      <Link
        to="/vendor/listing"
        className="btn btn-sm mt-6 inline-flex items-center gap-1.5 bg-steel-600 text-white hover:bg-steel-700"
      >
        {t("vendor.clients.empty_cta_listing")}
        <ArrowRight size={15} aria-hidden="true" />
      </Link>
    </div>
  );
}

export default function VendorClientsPage() {
  const { t, locale } = useT();
  useDocumentTitle(t("vendor.clients.page_title"));
  const [clients, setClients] = useState<VendorClientView[]>([]);
  // `null` = billing not loaded yet (or the billing fetch failed). The paywall
  // (upgrade nudge + locked CRM columns) is decided ONLY once we positively
  // know the plan, so a paying vendor never flashes — or gets stranded on — the
  // free-tier locked view. The server is the real gate on the data itself.
  const [plan, setPlan] = useState<VendorPlan | null>(null);
  const [currency, setCurrency] = useState<Currency>("HUF");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // The status filter lives in the URL (?status=confirmed) so the stats page
  // KPI cards and donut legend can deep-link into a pre-filtered list.
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get("status") ?? "all";
  const setStatusFilter = (s: string) => {
    setSearchParams(s === "all" ? {} : { status: s }, { replace: true });
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    // The clients list and the billing/plan load INDEPENDENTLY: a hiccup on one
    // must never corrupt the other. (A previous `Promise.all` rejected the whole
    // pair when the clients call failed, discarding a successful Pro plan and
    // wrongly locking a paying vendor onto the free-tier view.) `loading` and
    // `failed` track only the clients list — the primary content of the page.
    vendorClientsApi
      .list()
      .then((res) => {
        if (!cancelled) setClients(res.clients);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    vendorBillingApi
      .get()
      .then((res) => {
        if (cancelled) return;
        setPlan(res.plan);
        setCurrency(res.billing.currency);
      })
      .catch(() => {
        // Plan stays unknown → no upgrade nudge, no locks. The server still
        // enforces the real entitlement gate on the underlying data.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Lock the PRO-only CRM columns (+ show the upgrade nudge) only once billing
  // has loaded AND the plan genuinely lacks the feature. While the plan is
  // unknown, nothing locks — the paywall is never shown on a guess.
  const crmLocked = plan !== null && !isVendorFeatureEnabled(plan, "client_crm_detail");

  // Status pills: "all" plus EVERY canonical status (each with its count), so
  // the filter row always mirrors the status options on the detail form,
  // plus any unknown extras actually present in the data.
  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of clients) counts.set(c.status, (counts.get(c.status) ?? 0) + 1);
    return counts;
  }, [clients]);
  const pillStatuses = useMemo(() => {
    const extra = [...statusCounts.keys()]
      .filter((s) => !(STATUS_ORDER as readonly string[]).includes(s))
      .sort();
    return [...STATUS_ORDER, ...extra];
  }, [statusCounts]);

  const filtered = useMemo(
    () => (statusFilter === "all" ? clients : clients.filter((c) => c.status === statusFilter)),
    [clients, statusFilter],
  );

  const pillBase =
    "rounded-full border border-paper-300 px-3 py-1 text-xs transition-colors dark:border-umber-700";
  const pillActive =
    "bg-steel-600 text-white border-steel-600 hover:bg-steel-700 dark:border-steel-600";
  const pillInactive =
    "text-ink-700 hover:bg-paper-100 dark:text-paper-200 dark:hover:bg-umber-800";

  return (
    <div>
      <header className="mb-4">
        <h1 className="font-grotesk text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl dark:text-paper-50">
          {t("vendor.clients.page_title")}
        </h1>
        <p className="mt-1 text-sm text-ink-600 dark:text-paper-300">
          {t("vendor.clients.page_body")}
        </p>
      </header>

      {crmLocked && <UpgradeNudge />}

      {loading ? (
        <GhostTable />
      ) : failed ? (
        <p className="rounded-xl border border-paper-300 bg-paper-50 p-4 text-sm text-ink-600 dark:border-umber-600 dark:bg-umber-900 dark:text-paper-300">
          {t("vendor.clients.load_failed")}
        </p>
      ) : clients.length === 0 ? (
        <EmptyClients />
      ) : (
        <>
          {/* Status filter */}
          <div className="mb-4 flex flex-wrap gap-2">
            <button
              type="button"
              className={`${pillBase} ${statusFilter === "all" ? pillActive : pillInactive}`}
              onClick={() => setStatusFilter("all")}
            >
              {t("suppliers.filter_all")} ({clients.length})
            </button>
            {pillStatuses.map((s) => {
              const known = (STATUS_ORDER as readonly string[]).includes(s);
              const count = statusCounts.get(s) ?? 0;
              return (
                <button
                  key={s}
                  type="button"
                  className={`${pillBase} ${statusFilter === s ? pillActive : pillInactive}`}
                  onClick={() => setStatusFilter(s)}
                >
                  {known ? t(`vendor.clients.status_${s}`) : s} ({count})
                </button>
              );
            })}
          </div>

          {/* Grid "table" — header on sm+, Link rows that navigate to detail. */}
          <div className="overflow-hidden rounded-xl border border-steel-200 dark:border-steel-800">
            <div className="hidden grid-cols-[2fr_1.2fr_1.2fr_1fr_1fr] gap-3 border-b border-steel-200 bg-steel-100 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-steel-800 sm:grid dark:border-steel-800 dark:bg-steel-900 dark:text-steel-200">
              <span>{t("vendor.clients.col_couple")}</span>
              <span>{t("vendor.clients.col_event_date")}</span>
              <span className="text-center">{t("vendor.clients.col_status")}</span>
              <span>{t("vendor.clients.col_stage")}</span>
              <span className="text-right">{t("vendor.clients.col_balance")}</span>
            </div>

            <ul className="divide-y divide-paper-200 bg-white dark:divide-umber-700 dark:bg-umber-800">
              {filtered.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/vendor/clients/${c.id}`}
                    className="grid grid-cols-1 gap-1 px-4 py-3 transition-colors hover:bg-steel-50 focus:outline-none focus-visible:bg-steel-50 sm:grid-cols-[2fr_1.2fr_1.2fr_1fr_1fr] sm:items-center sm:gap-3 dark:hover:bg-umber-700 dark:focus-visible:bg-umber-700"
                  >
                    <span
                      className="truncate font-medium text-ink-900 dark:text-paper-50"
                      title={c.couple_display_name}
                    >
                      {c.couple_display_name}
                    </span>
                    <span className="text-sm text-ink-600 dark:text-paper-300">
                      {c.event_date
                        ? formatDate(c.event_date, locale)
                        : t("vendor.clients.no_event_date")}
                    </span>
                    <span className="sm:text-center">
                      <StatusBadge status={c.status} />
                    </span>
                    <span className="text-sm text-ink-600 dark:text-paper-300">
                      <ProCell locked={crmLocked}>
                        {c.stage ? c.stage : <span className="text-ink-400">-</span>}
                      </ProCell>
                    </span>
                    <span className="text-sm tabular-nums text-ink-700 sm:text-right dark:text-paper-200">
                      <ProCell locked={crmLocked}>
                        {c.balance !== null ? (
                          VOID_STATUSES.has(c.status) ? (
                            <span
                              className="text-ink-400 line-through dark:text-umber-400"
                              title={t(`vendor.clients.status_${c.status}`)}
                            >
                              {formatMoney(c.balance, currency, locale)}
                            </span>
                          ) : (
                            formatMoney(c.balance, currency, locale)
                          )
                        ) : (
                          <span className="text-ink-400">-</span>
                        )}
                      </ProCell>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {filtered.length === 0 && (
            <p className="mt-3 text-center text-sm text-ink-500 dark:text-umber-300">
              {t("vendor.clients.empty_body")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
