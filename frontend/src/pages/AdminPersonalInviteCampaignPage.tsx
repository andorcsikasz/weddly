// Admin console for the personal-invite campaign: the founder's own contacts
// (CSV import), told about Weddly with a register CTA. Wears the SAME shell as
// the two vendor campaign consoles — create row + campaign chips + the selected
// campaign's funnel on the left, the live outbound email pinned to the 380px
// right rail, the per-address lists full width underneath — so all three tabs of
// KEZELÉS → Kampányok read identically. What differs is only the audience: a
// fixed imported list rather than a live directory query, so where the vendor
// consoles show a "targets" query this one shows a CSV import plus the contacts
// it produced. Launching stays a deliberate second step (Start), and pacing
// beyond a supervised send-batch belongs to the worker.

import type {
  PersonalInviteCampaign,
  PersonalInviteCampaignSend,
  PersonalInviteCampaignStats,
  PersonalInviteImportResult,
} from "@shared/personal_invite_campaign";
import {
  PERSONAL_INVITE_DEFAULT_DAILY_CAP,
  PERSONAL_INVITE_MAX_DAILY_CAP,
} from "@shared/personal_invite_campaign";
import { FileUp, Pause, Play, Send, Sparkles, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminEmptyState, AdminPageHeader, Pill } from "../components/admin";
import { Button, Skeleton, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { adminEmailPreviewApi, adminPersonalInviteCampaignApi as api } from "../lib/endpoints";
import { intlLocale } from "../lib/format";
import { type Locale, useT } from "../lib/i18n";

const MANUAL_BATCH_SIZE = 25;
/** How many contact rows the table renders before it stops and just counts the
 *  rest — a 700-address import would otherwise paint 700 table rows. */
const CONTACT_ROWS = 200;
const DAY_MS = 86_400_000;

/** Suggested handle: month-stamped, so a second list in the same month is the
 *  only case that needs a manual edit. Mirrors the vendor consoles. */
function suggestSlug(): string {
  const d = new Date();
  return `friends-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function daysToSend(n: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.ceil(n / cap);
}

/** Short launched/ended stamp. `withTime` for the exact launch moment, date-only
 *  for the (approximate) projected finish. */
function fmtStamp(ms: number, locale: Locale, withTime: boolean): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(ms));
}

// ── Client-side CSV preview + cleanup ───────────────────────────────────────
// The server already skips already-registered / opted-out / duplicate / invalid
// rows on import; this mirrors the objective checks (email format + in-file
// duplicates) plus an obvious test-account heuristic so the admin can SEE and
// strip the junk before importing. `ok` rows are the ones that survive Clean.
type RowStatus = "ok" | "duplicate" | "invalid" | "suspicious";
interface PreviewRow {
  name: string;
  email: string;
  status: RowStatus;
}
// Same shape the backend accepts, so the "valid" count reflects reality.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Obvious test/demo accounts (by name or the test app's domain) — outliers.
const TEST_RE = /\b(teszt|test|demo)\b|colibriapp/i;

function parseContacts(csv: string): PreviewRow[] {
  const rows: PreviewRow[] = [];
  const seen = new Set<string>();
  for (const raw of csv.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.replace(/["\s]/g, "").toLowerCase() === "name,email") continue; // header
    const m = line.match(/^\s*"?(.*?)"?\s*,\s*"?([^",]*)"?\s*$/);
    const name = (m?.[1] ?? "").trim();
    const email = (m?.[2] ?? line.replace(/"/g, "")).trim();
    const lc = email.toLowerCase();
    let status: RowStatus;
    if (!EMAIL_RE.test(email)) status = "invalid";
    else if (seen.has(lc)) status = "duplicate";
    else {
      seen.add(lc);
      status = TEST_RE.test(email) || TEST_RE.test(name) ? "suspicious" : "ok";
    }
    rows.push({ name, email, status });
  }
  return rows;
}

function Stat({ value, label, muted }: { value: number | string; label: string; muted?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className={`font-grotesk text-xl font-semibold leading-none tabular-nums ${
          muted ? "text-neutral-400 dark:text-umber-400" : ""
        }`}
      >
        {value}
      </span>
      <span className="text-[11px] leading-tight text-neutral-500 dark:text-umber-300">
        {label}
      </span>
    </div>
  );
}

/** Live render of the actual outbound invite, from the same template builders
 *  that ship, via the admin preview endpoint — so the console can never show
 *  copy that differs from what sends. Same iframe-write approach the vendor
 *  campaign consoles use. The personal-invite campaign has a single email kind
 *  (`personal_invite`), so this only toggles locale. */
function EmailPreview({ locale }: { locale: "hu" | "en" }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [subject, setSubject] = useState("");

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    adminEmailPreviewApi
      .render("personal_invite", locale)
      .then((r) => {
        if (cancelled) return;
        setHtml(r.html);
        setSubject(r.subject);
      })
      .catch(() => {
        if (!cancelled)
          setHtml("<p style='padding:16px;font-family:sans-serif;color:#7a7065'>?</p>");
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  useEffect(() => {
    const doc = frame.current?.contentDocument;
    if (!doc || html == null) return;
    doc.open();
    doc.write(html);
    doc.close();
  }, [html]);

  return (
    <div className="flex flex-col gap-2">
      <p className="truncate font-mono text-[11px] text-neutral-500 dark:text-umber-300">
        {subject}
      </p>
      <div className="relative h-[420px] overflow-hidden rounded-xl ring-1 ring-ink-100 dark:ring-umber-700">
        {html == null && <Skeleton variant="block" height={420} rounded="lg" />}
        <iframe
          ref={frame}
          title="preview"
          className="h-full w-full border-0"
          sandbox="allow-same-origin"
        />
      </div>
    </div>
  );
}

export default function AdminPersonalInviteCampaignPage() {
  const { t, locale } = useT();
  const toast = useToast();
  const confirm = useConfirm();

  const [campaigns, setCampaigns] = useState<PersonalInviteCampaign[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [stats, setStats] = useState<PersonalInviteCampaignStats | null>(null);
  const [sends, setSends] = useState<PersonalInviteCampaignSend[] | null>(null);
  const [busy, setBusy] = useState(false);

  const [slug, setSlug] = useState(suggestSlug);
  const [dailyCap, setDailyCap] = useState(String(PERSONAL_INVITE_DEFAULT_DAILY_CAP));
  const [previewLocale, setPreviewLocale] = useState<"hu" | "en">("hu");

  const refreshList = useCallback(async () => {
    const list = await api.list();
    setCampaigns(list.campaigns);
    setSelectedId((prev) => prev ?? list.campaigns[0]?.id ?? null);
  }, []);

  const refreshDetail = useCallback(async (id: number) => {
    const [d, sd] = await Promise.all([api.detail(id), api.sends(id)]);
    setStats(d.stats);
    setSends(sd.sends);
  }, []);

  useEffect(() => {
    void refreshList().catch(() => toast.error(t("common.error_generic")));
  }, [refreshList, toast, t]);

  useEffect(() => {
    if (selectedId == null) return;
    setStats(null);
    setSends(null);
    void refreshDetail(selectedId).catch(() => toast.error(t("common.error_generic")));
  }, [selectedId, refreshDetail, toast, t]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await refreshList();
      if (selectedId != null) await refreshDetail(selectedId);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  const cap = Number.parseInt(dailyCap, 10);

  async function onCreate() {
    if (!Number.isInteger(cap) || cap < 1 || cap > PERSONAL_INVITE_MAX_DAILY_CAP) {
      toast.error(t("admin.campaign_err_cap"));
      return;
    }
    await run(async () => {
      const r = await api.create({ slug: slug.trim(), daily_cap: cap });
      setSelectedId(r.campaign.id);
      setSlug(suggestSlug());
      toast.success(t("admin.campaign_created"));
    });
  }

  async function onToggleStatus(campaign: PersonalInviteCampaign) {
    const next = campaign.status === "running" ? "paused" : "running";
    if (next === "running") {
      const ok = await confirm({
        title: t("admin.campaign_start_confirm_title"),
        body: t("admin.pinvite_start_confirm_body", {
          n: stats?.queued ?? 0,
          cap: campaign.daily_cap,
        }),
        confirmLabel: t("admin.campaign_start_confirm_cta"),
        cancelLabel: t("common.cancel"),
      });
      if (!ok) return;
    }
    await run(() => api.update(campaign.id, { status: next }));
  }

  async function onSendBatch(campaign: PersonalInviteCampaign) {
    const ok = await confirm({
      title: t("admin.campaign_batch_confirm_title"),
      body: t("admin.campaign_batch_confirm_body", { n: MANUAL_BATCH_SIZE }),
      confirmLabel: t("admin.campaign_batch_confirm_cta"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    await run(async () => {
      const r = await api.sendBatch(campaign.id, MANUAL_BATCH_SIZE);
      toast.success(t("admin.campaign_batch_sent", { n: r.sent }));
    });
  }

  const selected = campaigns?.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <AdminPageHeader title={t("admin.pinvite_title")} subtitle={t("admin.pinvite_subtitle")} />

      {/* `min-w-0` on both columns is load-bearing: the preview's subject line is
          `truncate` (white-space: nowrap), so its min-content is the full subject.
          Without the override a long subject sizes the single mobile column wider
          than the viewport and clips the Create button off-screen. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[190px] flex-1">
              <label className="field-label" htmlFor="pi-slug">
                {t("admin.campaign_slug")}
              </label>
              <input
                id="pi-slug"
                className="input"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                maxLength={61}
              />
            </div>
            <div className="w-[104px]">
              <label className="field-label" htmlFor="pi-cap">
                {t("admin.campaign_daily_cap")}
              </label>
              <input
                id="pi-cap"
                className="input tabular-nums"
                type="number"
                min={1}
                max={PERSONAL_INVITE_MAX_DAILY_CAP}
                value={dailyCap}
                onChange={(e) => setDailyCap(e.target.value)}
              />
            </div>
            <Button onClick={() => void onCreate()} disabled={busy || slug.trim().length < 2}>
              {t("admin.campaign_create")}
            </Button>
          </div>

          {/* The audience is whatever was imported, so the pacing line only has
              something to say once contacts are queued. */}
          {stats != null && stats.queued > 0 && selected != null && (
            <p className="text-sm text-neutral-500 dark:text-umber-300">
              {t("admin.campaign_plan", {
                n: stats.queued,
                cap: selected.daily_cap,
                days: daysToSend(stats.queued, selected.daily_cap),
              })}
            </p>
          )}

          {campaigns == null ? (
            <Skeleton variant="block" height={34} rounded="lg" />
          ) : campaigns.length === 0 ? (
            <AdminEmptyState title={t("admin.campaign_empty")} />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {campaigns.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={`rounded-full px-3 py-1 text-[13px] ring-1 transition ${
                    c.id === selectedId
                      ? "bg-neutral-900 text-paper-50 ring-neutral-900 dark:bg-paper-100 dark:text-umber-900 dark:ring-paper-100"
                      : "text-ink-700 ring-ink-100 dark:text-paper-100 dark:ring-umber-700"
                  }`}
                >
                  {c.slug}
                </button>
              ))}
            </div>
          )}

          {selected != null && (
            <div className="flex flex-col gap-4 rounded-2xl bg-paper-200 p-4 ring-2 ring-ink-900 dark:bg-umber-800 dark:ring-umber-600">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{selected.slug}</span>
                  <Pill
                    tone={
                      selected.status === "running"
                        ? "sage"
                        : selected.status === "done"
                          ? "muted"
                          : "violet"
                    }
                  >
                    {t(`admin.campaign_status_${selected.status}`)}
                  </Pill>
                </div>
                {selected.status !== "done" && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void onSendBatch(selected)}
                    >
                      <Send size={14} aria-hidden />
                      {t("admin.campaign_send_batch", { n: MANUAL_BATCH_SIZE })}
                    </Button>
                    <Button disabled={busy} onClick={() => void onToggleStatus(selected)}>
                      {selected.status === "running" ? (
                        <>
                          <Pause size={14} aria-hidden />
                          {t("admin.campaign_pause")}
                        </>
                      ) : (
                        <>
                          <Play size={14} aria-hidden />
                          {t("admin.campaign_start")}
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>

              {/* When it launched, and when it ends (actual once Done, else a
                  projection from queued ÷ daily cap). */}
              <p className="text-xs text-neutral-500 dark:text-umber-300">
                {selected.started_at
                  ? t("admin.campaign_launched", {
                      date: fmtStamp(selected.started_at, locale, true),
                    })
                  : t("admin.campaign_not_launched")}
                {selected.ended_at
                  ? ` · ${t("admin.campaign_ended", { date: fmtStamp(selected.ended_at, locale, true) })}`
                  : selected.status === "running" && stats != null && stats.queued > 0
                    ? ` · ${t("admin.campaign_ends_est", {
                        date: fmtStamp(
                          Date.now() + daysToSend(stats.queued, selected.daily_cap) * DAY_MS,
                          locale,
                          false,
                        ),
                      })}`
                    : ""}
              </p>

              {stats == null ? (
                <Skeleton variant="block" height={44} rounded="md" />
              ) : (
                <>
                  {/* Sent → opened → clicked → registered, left to right: the
                      funnel reads in one pass, and the two middle numbers are
                      what separate a subject-line problem from a landing-page
                      one. */}
                  <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-8">
                    <Stat value={stats.total} label={t("admin.pinvite_stat_total")} />
                    <Stat value={stats.queued} label={t("admin.pinvite_stat_queued")} />
                    <Stat value={stats.sent} label={t("admin.campaign_stat_sent")} />
                    <Stat value={stats.opened} label={t("admin.campaign_stat_opened")} />
                    <Stat value={stats.clicked} label={t("admin.campaign_stat_clicked")} />
                    <Stat value={stats.registered} label={t("admin.pinvite_stat_registered")} />
                    <Stat
                      value={`${stats.hu} / ${stats.en}`}
                      label={t("admin.pinvite_stat_lang")}
                    />
                    <Stat value={stats.failed} label={t("admin.campaign_stat_failed")} muted />
                  </div>
                  <p className="text-xs text-neutral-500 dark:text-umber-300">
                    {t("admin.campaign_stat_today", {
                      n: stats.sent_last_24h,
                      cap: selected.daily_cap,
                    })}
                  </p>
                </>
              )}
            </div>
          )}
        </section>

        <section className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(["hu", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setPreviewLocale(l)}
                className={`rounded-full px-2.5 py-1 text-[11px] uppercase tracking-wide ring-1 transition ${
                  previewLocale === l
                    ? "bg-neutral-900 text-paper-50 ring-neutral-900 dark:bg-paper-100 dark:text-umber-900 dark:ring-paper-100"
                    : "text-neutral-500 ring-ink-100 dark:text-umber-300 dark:ring-umber-700"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
          <EmailPreview locale={previewLocale} />
        </section>
      </div>

      {selected != null && (
        <ContactImport
          key={selected.id}
          campaignId={selected.id}
          busy={busy}
          // The import already ran inside the child; this just re-pulls the
          // funnel + contact table through the shared refresh path.
          onImported={() => run(async () => {})}
        />
      )}

      {selected != null && (
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium">{t("admin.pinvite_contacts")}</h2>
            <p className="text-xs text-neutral-500 dark:text-umber-300">
              {t("admin.pinvite_contacts_hint")}
            </p>
          </div>
          {sends == null ? (
            <Skeleton variant="block" height={110} rounded="lg" />
          ) : sends.length === 0 ? (
            <AdminEmptyState title={t("admin.pinvite_contacts_empty")} />
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl ring-1 ring-ink-100 dark:ring-umber-700">
                <table className="w-full text-[13px]">
                  <tbody>
                    {sends.slice(0, CONTACT_ROWS).map((s) => (
                      <tr
                        key={s.id}
                        className="border-b border-ink-100 last:border-0 dark:border-umber-700"
                      >
                        <td className="px-3 py-1.5 font-medium">{s.name || "—"}</td>
                        <td className="px-3 py-1.5 text-neutral-500 dark:text-umber-300">
                          {s.email}
                        </td>
                        <td className="px-3 py-1.5">
                          {s.registered ? (
                            <Pill tone="sage">{t("admin.pinvite_stat_registered")}</Pill>
                          ) : s.status === "failed" ? (
                            <Pill tone="blush">{t("admin.campaign_send_failed")}</Pill>
                          ) : s.status === "skipped" ? (
                            <Pill tone="muted">{t("admin.pinvite_send_skipped")}</Pill>
                          ) : s.status === "sent" ? (
                            <Pill tone="violet">{t("admin.campaign_send_sent")}</Pill>
                          ) : (
                            <Pill tone="muted">{t("admin.pinvite_stat_queued")}</Pill>
                          )}
                        </td>
                        <td className="px-3 py-1.5 uppercase text-neutral-400 dark:text-umber-400">
                          {s.locale}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {sends.length > CONTACT_ROWS && (
                <p className="text-xs text-neutral-500 dark:text-umber-300">
                  {t("admin.pinvite_contacts_more", { n: sends.length - CONTACT_ROWS })}
                </p>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

/** The import step, scoped to one campaign (remount on switch via `key`) so a
 *  half-pasted list can never land on a campaign the admin moved away from. */
function ContactImport({
  campaignId,
  busy,
  onImported,
}: {
  campaignId: number;
  busy: boolean;
  onImported: () => Promise<void>;
}) {
  const { t } = useT();
  const toast = useToast();
  const [csv, setCsv] = useState("");
  const [importing, setImporting] = useState(false);
  const [lastImport, setLastImport] = useState<PersonalInviteImportResult | null>(null);

  const preview = useMemo(() => parseContacts(csv), [csv]);
  const counts = useMemo(() => {
    const c = { ok: 0, duplicate: 0, invalid: 0, suspicious: 0 };
    for (const r of preview) c[r.status] += 1;
    return c;
  }, [preview]);
  const flagged = preview.filter((r) => r.status !== "ok");

  // Rewrite the textarea to only the clean rows (with header), so the very next
  // Import sends nothing the server would reject anyway.
  function cleanList() {
    const removed = preview.length - counts.ok;
    if (removed === 0) return;
    const body = preview
      .filter((r) => r.status === "ok")
      .map((r) => `"${r.name.replace(/"/g, '""')}","${r.email}"`)
      .join("\n");
    setCsv(`name,email\n${body}\n`);
    toast.success(t("admin.pinvite_clean_done", { n: removed }));
  }

  function statusLabel(s: Exclude<RowStatus, "ok">): string {
    if (s === "duplicate") return t("admin.pinvite_duplicate");
    if (s === "invalid") return t("admin.pinvite_invalid");
    return t("admin.pinvite_suspicious");
  }

  // Load a picked .csv file into the same textarea, so the admin can eyeball it
  // before importing. Reuses the whole paste-import flow — the file just fills
  // `csv`. Reset the input value so re-picking the same file fires onChange.
  function loadFile(file: File | undefined, reset: () => void) {
    reset();
    if (!file) return;
    if (file.size > 5_000_000) {
      toast.error(t("common.error_generic"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setCsv(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => toast.error(t("common.error_generic"));
    reader.readAsText(file);
  }

  async function runImport() {
    if (importing || csv.trim().length === 0) return;
    setImporting(true);
    try {
      const res = await api.import(campaignId, { csv });
      setLastImport(res.result);
      setCsv("");
      toast.success(
        t("admin.pinvite_import_result", {
          imported: res.result.imported,
          registered: res.result.skipped_registered,
          optout: res.result.skipped_optout,
          dup: res.result.skipped_duplicate,
          invalid: res.result.skipped_invalid,
        }),
      );
      await onImported();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.error_generic"));
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">{t("admin.pinvite_import_heading")}</h2>
        <p className="text-xs text-neutral-500 dark:text-umber-300">
          {t("admin.pinvite_import_hint")}
        </p>
      </div>
      <div className="rounded-xl p-3 ring-1 ring-ink-100 dark:ring-umber-700">
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={t("admin.pinvite_import_placeholder")}
          rows={4}
          className="input w-full font-mono text-xs"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* Upload a .csv file — it loads into the textarea above so the same
              paste-import flow (with review) applies. */}
          <label className="btn-secondary h-8 cursor-pointer gap-1.5 text-sm">
            <FileUp size={14} /> {t("admin.pinvite_import_file_cta")}
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              className="sr-only"
              onChange={(e) =>
                loadFile(e.target.files?.[0], () => {
                  e.target.value = "";
                })
              }
            />
          </label>
          <button
            type="button"
            className="btn-secondary h-8 gap-1.5 text-sm"
            onClick={() => void runImport()}
            disabled={importing || busy || csv.trim().length === 0}
          >
            <Upload size={14} /> {t("admin.pinvite_import_cta")}
          </button>
        </div>

        {/* Live preview of the pasted/loaded list: valid count + what will be
            stripped, with a one-click Clean that keeps only the good rows. */}
        {preview.length > 0 && (
          <div className="mt-3 rounded-lg bg-paper-100 p-2.5 dark:bg-umber-800/50">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="rounded-full bg-sage-100 px-2 py-0.5 font-medium text-sage-800 dark:bg-sage-500/20 dark:text-sage-200">
                {counts.ok} {t("admin.pinvite_valid")}
              </span>
              {counts.duplicate > 0 && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-400/20 dark:text-amber-200">
                  {counts.duplicate} {t("admin.pinvite_duplicate")}
                </span>
              )}
              {counts.invalid > 0 && (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 font-medium text-rose-700 dark:bg-rose-500/20 dark:text-rose-200">
                  {counts.invalid} {t("admin.pinvite_invalid")}
                </span>
              )}
              {counts.suspicious > 0 && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-400/20 dark:text-amber-200">
                  {counts.suspicious} {t("admin.pinvite_suspicious")}
                </span>
              )}
              {flagged.length > 0 && (
                <button
                  type="button"
                  className="btn-secondary ml-auto h-7 gap-1.5 text-xs"
                  onClick={cleanList}
                >
                  <Sparkles size={13} /> {t("admin.pinvite_clean_cta")}
                </button>
              )}
            </div>
            {flagged.length > 0 && (
              <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-[11px] text-ink-600 dark:text-umber-200">
                {flagged.slice(0, 300).map((r, i) => (
                  <li
                    key={`${r.email}-${i}`}
                    className="flex items-center justify-between gap-2 border-b border-paper-200/60 py-0.5 last:border-0 dark:border-umber-700/60"
                  >
                    <span className="truncate font-mono">{r.email || r.name || "—"}</span>
                    <span className="shrink-0 text-ink-400 dark:text-umber-400">
                      {statusLabel(r.status as Exclude<RowStatus, "ok">)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {lastImport && (
          <p className="mt-2 text-xs text-ink-600 dark:text-umber-200">
            {t("admin.pinvite_import_result", {
              imported: lastImport.imported,
              registered: lastImport.skipped_registered,
              optout: lastImport.skipped_optout,
              dup: lastImport.skipped_duplicate,
              invalid: lastImport.skipped_invalid,
            })}
          </p>
        )}
      </div>
    </section>
  );
}
