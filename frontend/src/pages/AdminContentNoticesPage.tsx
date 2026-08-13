import { ExternalLink, RefreshCcw, Scale } from "lucide-react";
import { useEffect, useState } from "react";
import { AdminEmptyState, AdminPageHeader, Pill } from "../components/admin";
import { useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { type AdminContentNotice, adminContentNoticeApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

const copy = {
  en: {
    title: "Content notices",
    description: "DSA notice, decision, statement-of-reasons and appeal queue.",
    empty: "No content notices.",
    reload: "Reload",
    reporter: "Reporter",
    affected: "Affected content owner email",
    reason: "Reasoned decision",
    reviewing: "Mark reviewing",
    action: "Remove or restrict",
    reject: "Reject notice",
    reporterAppeal: "Reporter appeal decision",
    affectedAppeal: "Affected-user appeal decision",
    saveAppeal: "Save appeal decision",
  },
  hu: {
    title: "Tartalmi bejelentések",
    description: "DSA bejelentési, döntési, indokolási és fellebbezési ügylista.",
    empty: "Nincs tartalmi bejelentés.",
    reload: "Frissítés",
    reporter: "Bejelentő",
    affected: "Az érintett tartalomtulajdonos e-mail-címe",
    reason: "Indokolt döntés",
    reviewing: "Vizsgálat alatt",
    action: "Eltávolítás vagy korlátozás",
    reject: "Bejelentés elutasítása",
    reporterAppeal: "Bejelentői fellebbezés döntése",
    affectedAppeal: "Érintetti fellebbezés döntése",
    saveAppeal: "Fellebbezési döntés mentése",
  },
} as const;

export default function AdminContentNoticesPage() {
  const { locale } = useT();
  const c = locale === "hu" ? copy.hu : copy.en;
  useDocumentMeta(c.title, c.description);
  const toast = useToast();
  const [notices, setNotices] = useState<AdminContentNotice[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [drafts, setDrafts] = useState<
    Record<
      string,
      { reason: string; affected: string; reporterAppeal: string; affectedAppeal: string }
    >
  >({});

  useEffect(() => {
    let cancelled = false;
    adminContentNoticeApi
      .list()
      .then(({ notices: rows }) => {
        if (cancelled) return;
        setNotices(rows);
        setDrafts((current) => {
          const next = { ...current };
          for (const row of rows) {
            next[row.reference] ??= {
              reason: row.decision_reason ?? "",
              affected: row.affected_email ?? "",
              reporterAppeal: row.appeal_decision ?? "",
              affectedAppeal: row.affected_appeal_decision ?? "",
            };
          }
          return next;
        });
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof ApiError ? error.message : "Request failed");
      });
    return () => {
      cancelled = true;
    };
  }, [reload, toast]);

  function setDraft(
    reference: string,
    key: "reason" | "affected" | "reporterAppeal" | "affectedAppeal",
    value: string,
  ) {
    setDrafts((current) => ({
      ...current,
      [reference]: { ...current[reference]!, [key]: value },
    }));
  }

  async function decide(
    row: AdminContentNotice,
    status: "reviewing" | "actioned" | "rejected",
    appealKind?: "reporter" | "affected",
  ) {
    const draft = drafts[row.reference]!;
    setBusy(row.reference);
    try {
      const body: Parameters<typeof adminContentNoticeApi.decide>[1] = {
        status,
        ...(status === "reviewing" ? {} : { decision_reason: draft.reason }),
        ...(draft.affected ? { affected_email: draft.affected } : {}),
        ...(appealKind === "reporter" ? { appeal_decision: draft.reporterAppeal } : {}),
        ...(appealKind === "affected" ? { affected_appeal_decision: draft.affectedAppeal } : {}),
      };
      const { notice } = await adminContentNoticeApi.decide(row.reference, body);
      setNotices(
        (current) => current?.map((item) => (item.id === notice.id ? notice : item)) ?? [],
      );
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={c.title}
        subtitle={c.description}
        actions={
          <button
            className="btn-secondary inline-flex items-center gap-2"
            onClick={() => setReload((n) => n + 1)}
          >
            <RefreshCcw size={15} /> {c.reload}
          </button>
        }
      />
      {notices?.length === 0 && <AdminEmptyState icon={<Scale />} title={c.empty} />}
      {notices === null && (
        <div className="h-36 animate-pulse rounded-xl bg-paper-200 dark:bg-umber-900" />
      )}
      {notices?.map((row) => {
        const draft = drafts[row.reference];
        if (!draft) return null;
        return (
          <article
            key={row.id}
            className="rounded-xl border border-paper-300 bg-white p-5 shadow-sm dark:border-umber-800 dark:bg-umber-950"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Pill
                    tone={
                      row.status === "actioned"
                        ? "sage"
                        : row.status === "rejected"
                          ? "muted"
                          : "violet"
                    }
                  >
                    {row.status}
                  </Pill>
                  <code className="text-xs">{row.reference}</code>
                </div>
                <p className="mt-2 text-sm">
                  <strong>{c.reporter}:</strong> {row.reporter_name} · {row.reporter_email}
                </p>
              </div>
              <a
                className="inline-flex items-center gap-1 text-sm underline"
                href={row.content_url}
                target="_blank"
                rel="noreferrer"
              >
                {row.content_url} <ExternalLink size={13} />
              </a>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg bg-paper-100 p-3 dark:bg-umber-900">
                <strong>{row.illegality}</strong>
                <p className="mt-1 whitespace-pre-wrap text-sm">{row.explanation}</p>
              </div>
              <div className="space-y-3">
                <label className="block">
                  <span className="field-label">{c.affected}</span>
                  <input
                    className="input w-full"
                    type="email"
                    value={draft.affected}
                    onChange={(e) => setDraft(row.reference, "affected", e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="field-label">{c.reason}</span>
                  <textarea
                    className="input w-full"
                    rows={4}
                    minLength={20}
                    maxLength={4000}
                    value={draft.reason}
                    onChange={(e) => setDraft(row.reference, "reason", e.target.value)}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn-secondary"
                    disabled={busy === row.reference}
                    onClick={() => void decide(row, "reviewing")}
                  >
                    {c.reviewing}
                  </button>
                  <button
                    className="btn-primary"
                    disabled={busy === row.reference || draft.reason.trim().length < 20}
                    onClick={() => void decide(row, "actioned")}
                  >
                    {c.action}
                  </button>
                  <button
                    className="btn-secondary"
                    disabled={busy === row.reference || draft.reason.trim().length < 20}
                    onClick={() => void decide(row, "rejected")}
                  >
                    {c.reject}
                  </button>
                </div>
              </div>
            </div>
            {row.appeal_text && (
              <div className="mt-4 rounded-lg border border-paper-300 p-3">
                <p className="whitespace-pre-wrap text-sm">{row.appeal_text}</p>
                <label className="mt-3 block">
                  <span className="field-label">{c.reporterAppeal}</span>
                  <textarea
                    className="input w-full"
                    rows={3}
                    value={draft.reporterAppeal}
                    onChange={(e) => setDraft(row.reference, "reporterAppeal", e.target.value)}
                  />
                </label>
                <button
                  className="btn-secondary mt-2"
                  disabled={draft.reporterAppeal.trim().length < 20 || busy === row.reference}
                  onClick={() =>
                    void decide(
                      row,
                      row.status === "submitted" ? "reviewing" : row.status,
                      "reporter",
                    )
                  }
                >
                  {c.saveAppeal}
                </button>
              </div>
            )}
            {row.affected_appeal_text && (
              <div className="mt-4 rounded-lg border border-paper-300 p-3">
                <p className="whitespace-pre-wrap text-sm">{row.affected_appeal_text}</p>
                <label className="mt-3 block">
                  <span className="field-label">{c.affectedAppeal}</span>
                  <textarea
                    className="input w-full"
                    rows={3}
                    value={draft.affectedAppeal}
                    onChange={(e) => setDraft(row.reference, "affectedAppeal", e.target.value)}
                  />
                </label>
                <button
                  className="btn-secondary mt-2"
                  disabled={draft.affectedAppeal.trim().length < 20 || busy === row.reference}
                  onClick={() =>
                    void decide(
                      row,
                      row.status === "submitted" ? "reviewing" : row.status,
                      "affected",
                    )
                  }
                >
                  {c.saveAppeal}
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
