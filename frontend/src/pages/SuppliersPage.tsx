// Static suppliers directory. v1 = read-only outbound contact only.
//
// Layout: a step-by-step "chain" of supplier groups along the top — selecting
// a step reveals its sub-categories. The chain mirrors the real-world booking
// order (venue first, details last).

import type { DirectorySupplier, SupplierCategory, SupplierGroup } from "@shared/suppliers";
import { SUPPLIER_GROUPS } from "@shared/suppliers";
import {
  BedDouble,
  Brush,
  Building2,
  Bus,
  Cake,
  Camera,
  ChefHat,
  ChevronRight,
  Disc3,
  Flower2,
  Lightbulb,
  Mail,
  MapPin,
  PartyPopper,
  Phone,
  Scissors,
  Shirt,
  Sparkles,
  StickyNote,
  UtensilsCrossed,
  Wine,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { SubmitSupplierModal } from "../components/SubmitSupplierModal";
import { Button } from "../components/ui";
import { supplierApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

const GROUP_ICON: Record<SupplierGroup, IconCmp> = {
  venue_stay: MapPin,
  food_drink: UtensilsCrossed,
  atmosphere: Sparkles,
  experience: PartyPopper,
  style: Scissors,
  details: Mail,
};

const CATEGORY_ICON: Record<SupplierCategory, IconCmp> = {
  venue: Building2,
  accommodation: BedDouble,
  catering: ChefHat,
  cake_dessert: Cake,
  bar_drinks: Wine,
  decor_floral: Flower2,
  lighting: Lightbulb,
  music_dj: Disc3,
  photo_video: Camera,
  entertainment: PartyPopper,
  attire: Shirt,
  hair_makeup: Brush,
  stationery: StickyNote,
  transport: Bus,
};

export default function SuppliersPage() {
  const { t, locale } = useT();
  const [items, setItems] = useState<DirectorySupplier[]>([]);
  const [activeGroup, setActiveGroup] = useState<SupplierGroup | null>(null);
  const [activeCat, setActiveCat] = useState<SupplierCategory | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);

  useEffect(() => {
    supplierApi.list().then((r) => setItems(r.suppliers));
  }, []);

  const filtered = useMemo(() => {
    if (activeCat) return items.filter((s) => s.category === activeCat);
    if (activeGroup) {
      const group = SUPPLIER_GROUPS.find((g) => g.id === activeGroup);
      const cats = new Set(group?.categories ?? []);
      return items.filter((s) => cats.has(s.category));
    }
    return items;
  }, [items, activeGroup, activeCat]);

  const subCategories = activeGroup
    ? (SUPPLIER_GROUPS.find((g) => g.id === activeGroup)?.categories ?? [])
    : [];

  function pickGroup(id: SupplierGroup | null) {
    setActiveGroup(id);
    setActiveCat(null);
  }

  return (
    <AppShell>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1>{t("suppliers.title")}</h1>
          <p className="mt-1 text-sm text-ink-500">{t("suppliers.sub")}</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setSubmitOpen(true)}>
          {t("suppliers.drop_your_own")}
        </Button>
      </header>

      {/* Step chain */}
      <div className="mb-3 overflow-x-auto pb-1">
        <div className="flex min-w-max items-stretch gap-2">
          <ChainStep
            active={activeGroup === null}
            onClick={() => pickGroup(null)}
            label={t("suppliers.filter_all")}
            index={0}
            isAll
          />
          {SUPPLIER_GROUPS.map((g, i) => {
            const Icon = GROUP_ICON[g.id];
            return (
              <div key={g.id} className="flex items-stretch gap-2">
                <ChevronRight size={16} className="self-center text-paper-400" aria-hidden />
                <ChainStep
                  active={activeGroup === g.id}
                  onClick={() => pickGroup(g.id)}
                  label={t(`suppliers.group.${g.id}`)}
                  icon={<Icon size={16} />}
                  index={i + 1}
                />
              </div>
            );
          })}
        </div>
      </div>
      <p className="mb-5 text-xs text-ink-500">{t("suppliers.chain_help")}</p>

      {/* Sub-category pills (only when a group is selected) */}
      {activeGroup && subCategories.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveCat(null)}
            className={
              activeCat === null
                ? "rounded-full border border-ink-700 bg-ink-700 px-3 py-1 text-xs font-medium text-paper-100"
                : "rounded-full border border-paper-300 bg-paper-50 px-3 py-1 text-xs text-ink-700"
            }
          >
            {t("suppliers.filter_all")}
          </button>
          {subCategories.map((c) => {
            const Icon = CATEGORY_ICON[c];
            const selected = activeCat === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setActiveCat(c)}
                className={
                  selected
                    ? "inline-flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-700 px-3 py-1 text-xs font-medium text-paper-100"
                    : "inline-flex items-center gap-1.5 rounded-full border border-paper-300 bg-paper-50 px-3 py-1 text-xs text-ink-700"
                }
              >
                <Icon size={13} />
                {t(`suppliers.cat.${c}`)}
              </button>
            );
          })}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {filtered.map((s) => {
          const Icon = CATEGORY_ICON[s.category];
          return (
            <article key={s.id} className="card-hover relative">
              {s.price_band !== null && (
                <span className="absolute right-4 top-4 text-xs text-ink-500">
                  {"$".repeat(s.price_band)}
                </span>
              )}
              <div className="flex items-center gap-3">
                <Avatar name={s.name} />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-base font-semibold">{s.name}</h3>
                  <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs uppercase tracking-wide text-ink-500">
                    <Icon size={12} />
                    <span>
                      {t(`suppliers.cat.${s.category}`)} · {s.city}
                    </span>
                    {s.source === "community" && (
                      <span className="inline-flex items-center rounded-full border border-paper-300 bg-paper-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-600">
                        {t("suppliers.community_pill")}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-sm text-ink-700">
                {locale === "hu" ? s.blurb_hu : s.blurb_en}
              </p>
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
          );
        })}
      </div>

      <SubmitSupplierModal
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        onSubmitted={(s) => setItems((prev) => [s, ...prev])}
      />
    </AppShell>
  );
}

function ChainStep({
  active,
  onClick,
  label,
  icon,
  index,
  isAll,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
  index: number;
  isAll?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
        active
          ? "border-ink-700 bg-ink-700 text-paper-100"
          : "border-paper-300 bg-paper-50 text-ink-700 hover:border-ink-300"
      }`}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium ${
          active ? "bg-paper-100/20 text-paper-100" : "bg-paper-200 text-ink-700"
        }`}
        aria-hidden
      >
        {isAll ? "·" : index}
      </span>
      {icon}
      <span className="font-medium">{label}</span>
    </button>
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
