// Admin console for Weddly Camera tryout codes. Mint a code for a guest tier,
// hand out the code or a ready /camera/start?code=… link, see who redeemed
// it, and revoke it. The rules (status, one film per code, caps only go up)
// live server-side in domain/film_codes.ts; this page only reads the derived
// status back.

import { FILM_PRICE_TIERS } from "@shared/film_pricing";
import type { FilmPromoCode, FilmPromoCodeStatus } from "@shared/types";
import { Check, Copy, Link2, Ticket } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Button, DateField, Skeleton, TextField, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { adminFilmCodeApi } from "../lib/endpoints";
import { intlLocale } from "../lib/format";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

type Loadable<T> = { status: "loading" } | { status: "ok"; data: T } | { status: "error" };

const STATUS_TONE: Record<FilmPromoCodeStatus, string> = {
  active: "bg-sage-100 text-sage-800 dark:bg-sage-900/40 dark:text-sage-200",
  used_up: "bg-paper-200 text-ink-700 dark:bg-umber-700/50 dark:text-umber-100",
  expired: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  revoked: "bg-paper-200 text-ink-500 line-through dark:bg-umber-800 dark:text-umber-300",
};

/** The link a code is best handed out as: it opens the camera start form with
 *  the code already applied, and survives sign-up. */
function codeLink(code: string): string {
  return `${window.location.origin}/camera/start?code=${encodeURIComponent(code)}`;
}

/** End of the picked day, local time: "until the 30th" includes the 30th. */
function endOfDay(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 23, 59, 59, 999).getTime();
}

export default function AdminFilmCodesPage() {
  const { t, locale } = useT();
  useDocumentMeta(t("admin.film_codes.title"), t("admin.film_codes.description"));
  const toast = useToast();
  const confirm = useConfirm();
  const [state, setState] = useState<Loadable<FilmPromoCode[]>>({ status: "loading" });

  const [code, setCode] = useState("");
  const [cap, setCap] = useState(50);
  const [uses, setUses] = useState("1");
  const [expires, setExpires] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = () => {
    setState({ status: "loading" });
    adminFilmCodeApi
      .list()
      .then((r) => setState({ status: "ok", data: r.codes }))
      .catch(() => setState({ status: "error" }));
  };
  useEffect(load, []);

  const fmtDate = (ms: number) =>
    new Date(ms).toLocaleDateString(intlLocale(locale), {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      toast.error(t("common.error_generic"));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setCodeError(null);
    const maxUses = Number.parseInt(uses, 10);
    setSaving(true);
    try {
      const { code: created } = await adminFilmCodeApi.create({
        ...(code.trim() ? { code: code.trim() } : {}),
        cap,
        max_redemptions: Number.isInteger(maxUses) && maxUses > 0 ? maxUses : 1,
        expires_at: expires ? endOfDay(expires) : null,
        note: note.trim() || null,
      });
      setState((s) => (s.status === "ok" ? { status: "ok", data: [created, ...s.data] } : s));
      setCode("");
      setNote("");
      setExpires("");
      setUses("1");
      toast.success(t("admin.film_codes.created"));
      void copy(created.code, `code-${created.id}`);
    } catch (err) {
      const reason =
        err instanceof ApiError ? (err.detail as { code?: string } | undefined)?.code : null;
      if (reason === "code_taken") setCodeError(t("admin.film_codes.error_code_taken"));
      else if (reason === "invalid_code") setCodeError(t("admin.film_codes.error_invalid_code"));
      else toast.error(err instanceof ApiError ? err.message : t("common.error_generic"));
    } finally {
      setSaving(false);
    }
  }

  async function revoke(row: FilmPromoCode) {
    const ok = await confirm({
      title: t("admin.film_codes.revoke_title", { code: row.code }),
      body: t("admin.film_codes.revoke_body"),
      confirmLabel: t("admin.film_codes.revoke"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    try {
      const { code: updated } = await adminFilmCodeApi.revoke(row.id);
      setState((s) =>
        s.status === "ok"
          ? { status: "ok", data: s.data.map((c) => (c.id === updated.id ? updated : c)) }
          : s,
      );
      toast.success(t("admin.film_codes.revoked"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.error_generic"));
    }
  }

  const iconBtn =
    "inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-paper-100 hover:text-ink-900 dark:text-umber-300 dark:hover:bg-umber-800 dark:hover:text-paper-50";

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 xl:px-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900 dark:text-paper-50">
          {t("admin.film_codes.title")}
        </h1>
        <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
          {t("admin.film_codes.description")}
        </p>
      </header>

      <form
        onSubmit={submit}
        className="mb-8 rounded-xl border border-ink-200/60 bg-white p-5 dark:border-umber-700/60 dark:bg-umber-900"
      >
        <h2 className="mb-4 text-sm font-semibold text-ink-900 dark:text-paper-50">
          {t("admin.film_codes.new_title")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="film-code-code"
            label={t("admin.film_codes.code_label")}
            placeholder={t("admin.film_codes.code_placeholder")}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            autoComplete="off"
            spellCheck={false}
            className="font-mono uppercase"
            errorText={codeError ?? undefined}
          />
          <div className="block">
            <span className="field-label">{t("admin.film_codes.cap_label")}</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup">
              {FILM_PRICE_TIERS.map((tier) => (
                <button
                  key={tier.cap}
                  type="button"
                  role="radio"
                  aria-checked={tier.cap === cap}
                  onClick={() => setCap(tier.cap)}
                  className={`min-h-10 min-w-12 rounded-full border px-3 text-sm font-semibold tabular-nums transition-colors ${
                    tier.cap === cap
                      ? "border-ink-900 bg-ink-900 text-paper-50 dark:border-paper-100 dark:bg-paper-100 dark:text-ink-900"
                      : "border-paper-300 text-ink-700 hover:border-ink-500 dark:border-umber-700 dark:text-umber-100"
                  }`}
                >
                  {tier.cap}
                </button>
              ))}
            </div>
          </div>
          <TextField
            id="film-code-uses"
            label={t("admin.film_codes.uses_label")}
            type="number"
            inputMode="numeric"
            min={1}
            max={10000}
            value={uses}
            onChange={(e) => setUses(e.target.value)}
          />
          <DateField
            id="film-code-expires"
            label={t("admin.film_codes.expires_label")}
            value={expires}
            onChange={setExpires}
            locale={locale}
            min={new Date().toISOString().slice(0, 10)}
            clearable
          />
          <div className="sm:col-span-2">
            <TextField
              id="film-code-note"
              label={t("admin.film_codes.note_label")}
              placeholder={t("admin.film_codes.note_placeholder")}
              value={note}
              maxLength={200}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? "…" : t("admin.film_codes.create")}
          </Button>
        </div>
      </form>

      {state.status === "loading" && <Skeleton className="h-40 w-full rounded-xl" />}
      {state.status === "error" && (
        <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-200">
          {t("admin.film_codes.load_error")}{" "}
          <button type="button" onClick={load} className="underline">
            {t("photos.busy_retry")}
          </button>
        </div>
      )}
      {state.status === "ok" && state.data.length === 0 && (
        <p className="flex items-center gap-3 rounded-xl border border-ink-200/60 bg-white p-6 text-sm text-ink-500 dark:border-umber-700/60 dark:bg-umber-900 dark:text-umber-300">
          <Ticket size={18} strokeWidth={1.5} aria-hidden="true" />
          {t("admin.film_codes.empty")}
        </p>
      )}
      {state.status === "ok" && state.data.length > 0 && (
        <ul className="space-y-3">
          {state.data.map((row) => (
            <li
              key={row.id}
              className="rounded-xl border border-ink-200/60 bg-white p-5 dark:border-umber-700/60 dark:bg-umber-900"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="font-mono text-base font-semibold tracking-wide text-ink-900 dark:text-paper-50">
                  {row.code}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[row.status]}`}
                >
                  {t(`admin.film_codes.status_${row.status}`)}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void copy(row.code, `code-${row.id}`)}
                    aria-label={t("admin.film_codes.copy_code")}
                    title={t("admin.film_codes.copy_code")}
                    className={iconBtn}
                  >
                    {copied === `code-${row.id}` ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => void copy(codeLink(row.code), `link-${row.id}`)}
                    aria-label={t("admin.film_codes.copy_link")}
                    title={t("admin.film_codes.copy_link")}
                    className={iconBtn}
                  >
                    {copied === `link-${row.id}` ? <Check size={16} /> : <Link2 size={16} />}
                  </button>
                  {row.status !== "revoked" && (
                    <button
                      type="button"
                      onClick={() => void revoke(row)}
                      className="ml-1 rounded-full px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:bg-paper-100 hover:text-ink-900 dark:text-umber-200 dark:hover:bg-umber-800"
                    >
                      {t("admin.film_codes.revoke")}
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-2 text-sm text-ink-600 dark:text-umber-200">
                {[
                  t("admin.film_codes.guests", { n: row.cap }),
                  t("admin.film_codes.uses_count", {
                    used: row.redemptions,
                    max: row.max_redemptions,
                  }),
                  row.expires_at
                    ? t("admin.film_codes.expires_on", { date: fmtDate(row.expires_at) })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {row.note && (
                <p className="mt-1 text-sm italic text-ink-500 dark:text-umber-300">{row.note}</p>
              )}
              {row.redeemed_by.length > 0 && (
                <div className="mt-3 border-t border-paper-200 pt-3 dark:border-umber-700/60">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                    {t("admin.film_codes.redeemed_by")}
                  </p>
                  <ul className="space-y-0.5 text-sm text-ink-700 dark:text-umber-100">
                    {row.redeemed_by.map((r) => (
                      <li
                        key={`${r.couple_id}-${r.redeemed_at}`}
                        className="flex flex-wrap gap-x-2"
                      >
                        <span className="font-medium">{r.display_name ?? "-"}</span>
                        {r.email && (
                          <span className="text-ink-500 dark:text-umber-300">{r.email}</span>
                        )}
                        <span className="text-ink-400 dark:text-umber-400">
                          {fmtDate(r.redeemed_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
