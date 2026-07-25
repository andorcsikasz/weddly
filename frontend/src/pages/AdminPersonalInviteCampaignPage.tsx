// Admin console for the personal-invite campaign: the founder's own contacts
// (CSV import), told about Weddly with a register CTA. Mirrors the two vendor
// campaign consoles but adds a paste-a-CSV import step, because this audience is
// a fixed imported list rather than a live directory query. Launching is a
// deliberate action (Start), and pacing beyond a supervised send-batch belongs
// to the worker.

import { FileUp, Play, Send, Sparkles, Square, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  PersonalInviteCampaign,
  PersonalInviteCampaignDetail,
  PersonalInviteCampaignStats,
  PersonalInviteImportResult,
} from "@shared/personal_invite_campaign";
import { PERSONAL_INVITE_DEFAULT_DAILY_CAP } from "@shared/personal_invite_campaign";
import { Skeleton, useConfirm, useToast } from "../components/ui";
import { adminEmailPreviewApi, adminPersonalInviteCampaignApi as api } from "../lib/endpoints";
import { useT } from "../lib/i18n";

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
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [previewLocale, setPreviewLocale] = useState<"hu" | "en">("hu");
  const [campaigns, setCampaigns] = useState<PersonalInviteCampaign[]>([]);
  const [details, setDetails] = useState<Record<number, PersonalInviteCampaignStats>>({});
  const [slug, setSlug] = useState("");
  const [cap, setCap] = useState(PERSONAL_INVITE_DEFAULT_DAILY_CAP);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    const res = await api.list();
    setCampaigns(res.campaigns);
    const stats: Record<number, PersonalInviteCampaignStats> = {};
    await Promise.all(
      res.campaigns.map(async (c) => {
        const d: PersonalInviteCampaignDetail = await api.detail(c.id);
        stats[c.id] = d.stats;
      }),
    );
    setDetails(stats);
  }, []);

  useEffect(() => {
    void refresh().catch(() => toast.error(t("common.error_generic")));
  }, [refresh, toast, t]);

  async function create() {
    if (creating) return;
    setCreating(true);
    try {
      await api.create({ slug: slug.trim(), daily_cap: cap });
      setSlug("");
      toast.success(t("admin.campaign_created"));
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.error_generic"));
    } finally {
      setCreating(false);
    }
  }

  async function setStatus(c: PersonalInviteCampaign, status: "running" | "paused") {
    if (status === "running") {
      const ok = await confirm({
        title: t("admin.campaign_start_confirm_title"),
        body: t("admin.pinvite_start_confirm_body", {
          n: details[c.id]?.queued ?? 0,
          cap: c.daily_cap,
        }),
        confirmLabel: t("admin.campaign_start_confirm_cta"),
        cancelLabel: t("common.cancel"),
      });
      if (!ok) return;
    }
    try {
      await api.update(c.id, { status });
      toast.success(
        status === "running" ? t("admin.campaign_launched") : t("admin.campaign_pause"),
      );
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.error_generic"));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-grotesk text-xl text-ink-900 dark:text-paper-50">
          {t("admin.pinvite_title")}
        </h1>
        <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
          {t("admin.pinvite_subtitle")}
        </p>
      </header>

      {/* Create */}
      <section className="card flex flex-wrap items-end gap-3 p-4">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-600 dark:text-umber-200">
          {t("admin.campaign_slug")}
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="friends-2026-07"
            className="input h-9 w-56"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-600 dark:text-umber-200">
          {t("admin.campaign_daily_cap")}
          <input
            type="number"
            min={1}
            max={200}
            value={cap}
            onChange={(e) => setCap(Number(e.target.value))}
            className="input h-9 w-28 tabular-nums"
          />
        </label>
        <button
          type="button"
          className="btn-primary h-9"
          onClick={() => void create()}
          disabled={creating}
        >
          {t("admin.campaign_create")}
        </button>
      </section>

      {/* Email preview — what the invite actually looks like when it sends. */}
      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-ink-800 dark:text-paper-100">
            {t("admin.pinvite_preview_heading")}
          </p>
          <div className="flex items-center gap-1">
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
        </div>
        <div className="mx-auto max-w-xl">
          <EmailPreview locale={previewLocale} />
        </div>
      </section>

      {campaigns.length === 0 ? (
        <p className="text-sm text-ink-500 dark:text-umber-300">{t("admin.campaign_empty")}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {campaigns.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              stats={details[c.id]}
              onChanged={refresh}
              onStart={() => setStatus(c, "running")}
              onPause={() => setStatus(c, "paused")}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CampaignCard({
  campaign,
  stats,
  onChanged,
  onStart,
  onPause,
}: {
  campaign: PersonalInviteCampaign;
  stats: PersonalInviteCampaignStats | undefined;
  onChanged: () => Promise<void>;
  onStart: () => void;
  onPause: () => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const [csv, setCsv] = useState("");
  const [importing, setImporting] = useState(false);
  const [sending, setSending] = useState(false);
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
      const res = await api.import(campaign.id, { csv });
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
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.error_generic"));
    } finally {
      setImporting(false);
    }
  }

  async function sendBatch() {
    if (sending) return;
    setSending(true);
    try {
      const res = await api.sendBatch(campaign.id, 25);
      toast.success(t("admin.review_campaign_batch_sent", { count: res.sent }));
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.error_generic"));
    } finally {
      setSending(false);
    }
  }

  const statusTone =
    campaign.status === "running"
      ? "bg-sage-100 text-sage-800 dark:bg-sage-500/20 dark:text-sage-200"
      : campaign.status === "done"
        ? "bg-paper-200 text-ink-600 dark:bg-umber-700 dark:text-umber-200"
        : "bg-amber-100 text-amber-800 dark:bg-amber-400/20 dark:text-amber-200";

  return (
    <li className="card flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="font-grotesk text-lg text-ink-900 dark:text-paper-50">
            {campaign.slug}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusTone}`}>
            {campaign.status}
          </span>
          <span className="text-xs text-ink-500 dark:text-umber-300">
            {t("admin.campaign_daily_cap")}: {campaign.daily_cap}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {campaign.status === "running" ? (
            <button type="button" className="btn-secondary h-8 gap-1.5 text-sm" onClick={onPause}>
              <Square size={14} /> {t("admin.campaign_pause")}
            </button>
          ) : (
            <button type="button" className="btn-primary h-8 gap-1.5 text-sm" onClick={onStart}>
              <Play size={14} /> {t("admin.campaign_start")}
            </button>
          )}
          <button
            type="button"
            className="btn-secondary h-8 gap-1.5 text-sm"
            onClick={() => void sendBatch()}
            disabled={sending}
          >
            <Send size={14} /> {t("admin.campaign_send_batch")}
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          <Stat label={t("admin.campaign_targets")} value={stats.total} />
          <Stat label={t("admin.campaign_stat_sent")} value={stats.sent} />
          <Stat label={t("admin.pinvite_stat_queued")} value={stats.queued} />
          <Stat label={t("admin.campaign_send_failed")} value={stats.failed} />
          <Stat label={t("admin.pinvite_stat_registered")} value={stats.registered} />
          <Stat label={t("admin.pinvite_stat_lang")} value={`${stats.hu} / ${stats.en}`} />
        </div>
      )}

      {/* Import */}
      <div className="rounded-xl border border-paper-300 p-3 dark:border-umber-700">
        <p className="text-sm font-medium text-ink-800 dark:text-paper-100">
          {t("admin.pinvite_import_heading")}
        </p>
        <p className="mt-0.5 text-xs text-ink-500 dark:text-umber-300">
          {t("admin.pinvite_import_hint")}
        </p>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={t("admin.pinvite_import_placeholder")}
          rows={4}
          className="input mt-2 w-full font-mono text-xs"
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
            disabled={importing || csv.trim().length === 0}
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
    </li>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-paper-100 px-2 py-1.5 dark:bg-umber-800">
      <div className="stat-num text-base font-semibold tabular-nums text-ink-900 dark:text-paper-50">
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-ink-500 dark:text-umber-300">
        {label}
      </div>
    </div>
  );
}
