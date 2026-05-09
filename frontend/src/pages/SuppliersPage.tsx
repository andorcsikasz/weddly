// Static suppliers directory. v1 = read-only outbound contact only.

import type { DirectorySupplier, SupplierCategory } from "@shared/suppliers";
import { Mail, Phone } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { supplierApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

const CATEGORIES: SupplierCategory[] = [
  "venue",
  "catering",
  "photo_video",
  "music_dj",
  "decor_floral",
  "cake_dessert",
  "attire",
  "hair_makeup",
  "transport",
  "stationery",
];

export default function SuppliersPage() {
  const { t, locale } = useT();
  const [items, setItems] = useState<DirectorySupplier[]>([]);
  const [filter, setFilter] = useState<SupplierCategory | null>(null);

  useEffect(() => {
    supplierApi.list().then((r) => setItems(r.suppliers));
  }, []);

  const filtered = useMemo(
    () => (filter ? items.filter((s) => s.category === filter) : items),
    [items, filter],
  );

  return (
    <AppShell>
      <header className="mb-6">
        <h1>{t("suppliers.title")}</h1>
        <p className="mt-1 text-sm text-ink-500">{t("suppliers.sub")}</p>
      </header>

      <div className="mb-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFilter(null)}
          className={
            filter === null
              ? "rounded-full border border-ink-700 bg-ink-700 px-3 py-1 text-xs font-medium text-paper-100"
              : "rounded-full border border-paper-300 bg-paper-50 px-3 py-1 text-xs text-ink-700"
          }
        >
          {t("suppliers.filter_all")}
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setFilter(c)}
            className={
              filter === c
                ? "rounded-full border border-ink-700 bg-ink-700 px-3 py-1 text-xs font-medium text-paper-100"
                : "rounded-full border border-paper-300 bg-paper-50 px-3 py-1 text-xs text-ink-700"
            }
          >
            {prettyCategory(c)}
          </button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {filtered.map((s) => (
          <article key={s.id} className="card-hover">
            <div className="flex items-center gap-3">
              <Avatar name={s.name} />
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-base font-semibold">{s.name}</h3>
                <p className="text-xs uppercase tracking-wide text-ink-500">
                  {prettyCategory(s.category)} · {s.city}
                </p>
              </div>
            </div>
            <p className="mt-3 text-sm text-ink-700">{locale === "hu" ? s.blurb_hu : s.blurb_en}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href={s.website}
                target="_blank"
                rel="noreferrer noopener"
                className="btn-outline btn-sm"
              >
                {t("suppliers.visit_website")}
              </a>
              {s.contact_email && (
                <a href={`mailto:${s.contact_email}`} className="btn-ghost btn-sm">
                  <Mail size={14} /> {t("suppliers.contact_email")}
                </a>
              )}
              {s.contact_phone && (
                <a href={`tel:${s.contact_phone}`} className="btn-ghost btn-sm">
                  <Phone size={14} /> {s.contact_phone}
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
    </AppShell>
  );
}

function Avatar({ name }: { name: string }) {
  const initial = name.charAt(0).toUpperCase();
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-paper-300 bg-paper-100 font-serif text-lg text-ink-700">
      {initial}
    </div>
  );
}

function prettyCategory(cat: string): string {
  return cat
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
