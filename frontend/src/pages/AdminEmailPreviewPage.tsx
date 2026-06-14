import { useEffect, useRef, useState } from "react";
import { AdminPageHeader, Pill, type PillTone } from "../components/admin";
import { Skeleton } from "../components/ui";
import { ApiError } from "../lib/api";
import { adminEmailPreviewApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMetaLiteral } from "../lib/seo";

type EmailCategory = "transactional" | "lifecycle" | "outreach";

interface KindEntry {
  kind: string;
  category: EmailCategory;
  subject: string;
}

const CATEGORY_ORDER: EmailCategory[] = ["transactional", "lifecycle", "outreach"];

const CATEGORY_TONE: Record<EmailCategory, PillTone> = {
  transactional: "ink",
  lifecycle: "sage",
  outreach: "violet",
};

const CATEGORY_LABEL_EN: Record<EmailCategory, string> = {
  transactional: "Transactional",
  lifecycle: "Lifecycle",
  outreach: "Outreach",
};

export function AdminEmailPreviewPage() {
  useT();
  useDocumentMetaLiteral("Email templates · Weddly Admin", "");

  const [kinds, setKinds] = useState<KindEntry[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [locale, setLocale] = useState<"bilingual" | "hu" | "en">("bilingual");
  const [html, setHtml] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    adminEmailPreviewApi.list().then(({ kinds: k }) => {
      setKinds(k as KindEntry[]);
      if (k.length > 0 && !selected) setSelected(k[0]!.kind);
    });
  }, []);

  useEffect(() => {
    if (!selected) return;
    setLoadingPreview(true);
    setHtml(null);
    const localeParam = locale === "bilingual" ? undefined : locale;
    adminEmailPreviewApi
      .render(selected, localeParam)
      .then(({ html: h, subject: s }) => {
        setHtml(h);
        setSubject(s);
      })
      .catch((e) => {
        if (e instanceof ApiError) setHtml(`<pre style="padding:16px">${e.message}</pre>`);
      })
      .finally(() => setLoadingPreview(false));
  }, [selected, locale]);

  useEffect(() => {
    if (!iframeRef.current || html === null) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
  }, [html]);

  const grouped = kinds
    ? CATEGORY_ORDER.map((cat) => ({
        cat,
        items: kinds.filter((k) => k.category === cat),
      })).filter((g) => g.items.length > 0)
    : null;

  return (
    <div className="flex flex-col h-full min-h-0">
      <AdminPageHeader title="Email templates" subtitle={`${kinds?.length ?? 0} templates`} />

      <div className="flex flex-1 min-h-0 gap-0 border-t border-neutral-200 dark:border-neutral-800">
        {/* ── Left: template list ─────────────────────────────────────── */}
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950">
          {!grouped
            ? Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="px-3 py-2">
                  <Skeleton className="h-4 w-full rounded" />
                </div>
              ))
            : grouped.map(({ cat, items }) => (
                <div key={cat}>
                  <div className="px-3 pt-4 pb-1">
                    <Pill tone={CATEGORY_TONE[cat]}>{CATEGORY_LABEL_EN[cat]}</Pill>
                  </div>
                  {items.map((k) => (
                    <button
                      key={k.kind}
                      type="button"
                      onClick={() => setSelected(k.kind)}
                      className={[
                        "w-full text-left px-3 py-1.5 text-xs font-mono truncate transition-colors",
                        selected === k.kind
                          ? "bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-paper-50 font-semibold"
                          : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-900",
                      ].join(" ")}
                    >
                      {k.kind}
                    </button>
                  ))}
                </div>
              ))}
        </aside>

        {/* ── Right: preview pane ─────────────────────────────────────── */}
        <div className="flex flex-col flex-1 min-w-0 bg-neutral-100 dark:bg-neutral-900">
          {/* toolbar */}
          <div className="flex items-center gap-3 px-4 py-2 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950">
            <span className="text-xs text-neutral-500 dark:text-neutral-400 truncate flex-1">
              {subject ?? (loadingPreview ? "Loading…" : "")}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {(["bilingual", "hu", "en"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLocale(l)}
                  className={[
                    "px-2 py-0.5 rounded text-xs font-medium transition-colors",
                    locale === l
                      ? "bg-neutral-900 dark:bg-paper-50 text-white dark:text-neutral-900"
                      : "text-neutral-500 hover:text-neutral-900 dark:hover:text-paper-50",
                  ].join(" ")}
                >
                  {l === "bilingual" ? "HU+EN" : l.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* iframe */}
          <div className="flex-1 overflow-hidden relative">
            {loadingPreview && (
              <div className="absolute inset-0 flex items-center justify-center bg-neutral-100 dark:bg-neutral-900 z-10">
                <Skeleton className="h-6 w-32 rounded" />
              </div>
            )}
            <iframe
              ref={iframeRef}
              title="Email preview"
              className="w-full h-full border-0"
              sandbox="allow-same-origin"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
