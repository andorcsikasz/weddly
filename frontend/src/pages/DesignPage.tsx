// /app/design — the wedding visual-identity editor. A curated, controlled
// design system (NOT a freeform editor): the couple picks one Wedding Style,
// one Colour Palette and one Font preset from fixed catalogs, plus a few print
// toggles. The selection persists on `couples.design_json` and drives the
// guest page (live preview below) + the printable cards. The concrete colours
// and font stacks all come from `@shared/design`, so the picker and the guest
// page can never drift.

import {
  type CoupleDesign,
  FONT_PRESETS,
  type FontPresetSlug,
  getFontPreset,
  getPalette,
  PALETTES,
  type PaletteSlug,
  resolveDesign,
  STYLE_PRESETS,
  type StylePresetSlug,
  toPublicDesign,
} from "@shared/design";
import type { Couple } from "@shared/types";
import type { PublicWeddingWebsiteView } from "@shared/wedding_website";
import { Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { InfoHint } from "../components/InfoHint";
import { WeddingSiteView } from "../components/WeddingSiteView";
import { useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { coupleApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

/** A selectable preset tile — large, calm card with a check badge when active.
 *  Used by all three picker sections so they read as one coherent system. */
function PresetTile({
  active,
  onSelect,
  label,
  ariaLabel,
  children,
}: {
  active: boolean;
  onSelect: () => void;
  label: string;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={`group relative flex flex-col gap-3 rounded-2xl border bg-white p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:bg-umber-800 dark:focus-visible:ring-paper-100 ${
        active
          ? "border-ink-900 ring-1 ring-ink-900 dark:border-paper-100 dark:ring-paper-100"
          : "border-paper-300 hover:border-paper-400 dark:border-umber-700 dark:hover:border-umber-600"
      }`}
    >
      {active && (
        <span
          className="absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-ink-900 text-paper-50 dark:bg-paper-100 dark:text-umber-900"
          aria-hidden
        >
          <Check size={12} strokeWidth={3} />
        </span>
      )}
      {children}
      <span className="text-sm font-medium text-ink-900 dark:text-paper-50">{label}</span>
    </button>
  );
}

export default function DesignPage() {
  const { t, locale } = useT();
  const toast = useToast();

  const [couple, setCouple] = useState<Couple | null>(null);
  const [design, setDesign] = useState<CoupleDesign>(() => resolveDesign(null));
  // Last value confirmed by the server — the debounced auto-save diffs against
  // this so a no-op selection doesn't fire a PATCH.
  const [saved, setSaved] = useState<CoupleDesign>(() => resolveDesign(null));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Read-only (lapsed plan) is surfaced once, then saving is disabled so the
  // couple can still explore the picker + preview without a toast on every tap.
  const [readOnly, setReadOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    coupleApi
      .current()
      .then((r) => {
        if (cancelled || !r.couple) return;
        setCouple(r.couple);
        setDesign(r.couple.design);
        setSaved(r.couple.design);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = useMemo(() => JSON.stringify(design) !== JSON.stringify(saved), [design, saved]);

  // Debounced auto-save: ~900ms after the last change, persist the whole
  // design blob. Mirrors GuestPageEditorPage's auto-save. The save closure is
  // fresh each run so the timeout always commits the latest selection.
  const designRef = useRef(design);
  designRef.current = design;
  useEffect(() => {
    if (!couple || !dirty || saving || readOnly) return;
    const id = setTimeout(() => {
      const next = designRef.current;
      setSaving(true);
      coupleApi
        .update({ design: next })
        .then((r) => {
          setCouple(r.couple);
          setSaved(r.couple.design);
          toast.success(t("design.saved"));
        })
        .catch((err) => {
          if (err instanceof ApiError && err.status === 402) {
            setReadOnly(true);
            toast.error(t("design.save_blocked"));
          } else {
            toast.error(t("design.save_error"));
          }
        })
        .finally(() => setSaving(false));
    }, 900);
    return () => clearTimeout(id);
  }, [couple, dirty, saving, readOnly, design, toast, t]);

  // Picking a style pre-selects its palette + fonts, but the couple can still
  // override either independently afterwards (the catalog defaults are a
  // starting point, not a lock).
  function chooseStyle(slug: StylePresetSlug) {
    const preset = STYLE_PRESETS.find((s) => s.slug === slug);
    if (!preset) return;
    setDesign((d) => ({
      ...d,
      style: slug,
      palette: preset.defaultPalette,
      fonts: preset.defaultFonts,
    }));
  }
  function choosePalette(slug: PaletteSlug) {
    setDesign((d) => ({ ...d, palette: slug }));
  }
  function chooseFonts(slug: FontPresetSlug) {
    setDesign((d) => ({ ...d, fonts: slug }));
  }
  function togglePrint(key: "border" | "ornament" | "qr") {
    setDesign((d) => ({ ...d, print: { ...d.print, [key]: !d.print[key] } }));
  }

  // Live guest-page preview through the SAME <WeddingSiteView> guests see, fed
  // the in-progress design so the couple watches the theme update as they pick.
  const previewView: PublicWeddingWebsiteView | null = couple
    ? {
        couple_slug: couple.slug ?? "",
        couple_display_name: couple.display_name,
        bride_name: couple.bride_name,
        groom_name: couple.groom_name,
        wedding_date: couple.wedding_date,
        ceremony_kind: couple.ceremony_kind,
        venue_name: couple.venue_name,
        cover_image_url: couple.cover_image_url,
        guest_page_intro: couple.guest_page_intro,
        useful_info: couple.useful_info,
        location_lat: null,
        location_lng: null,
        location_radius_km: couple.location_radius_km,
        post_rsvp_content: null,
        schedule: [],
        wishlist: null,
        design: toPublicDesign(design),
        fetched_at: Date.now(),
      }
    : null;

  return (
    <>
      <header className="mb-6 flex items-center gap-2">
        <h1 className="font-grotesk font-semibold tracking-tight">{t("design.title")}</h1>
        <InfoHint text={t("design.hint")} />
      </header>

      {loading ? (
        <p className="text-sm text-ink-500 dark:text-umber-300">{t("common.loading")}</p>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          {/* ── Picker column ───────────────────────────────────────────── */}
          <div className="space-y-10">
            {/* Wedding style */}
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                {t("design.section.style")}
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {STYLE_PRESETS.map((s) => {
                  const palette = getPalette(s.defaultPalette);
                  return (
                    <PresetTile
                      key={s.slug}
                      active={design.style === s.slug}
                      onSelect={() => chooseStyle(s.slug)}
                      label={t(s.nameKey)}
                      ariaLabel={t(s.nameKey)}
                    >
                      <span
                        className="flex h-12 overflow-hidden rounded-lg border border-paper-200 dark:border-umber-700"
                        aria-hidden
                      >
                        {[palette.background, palette.accent, palette.primary, palette.text].map(
                          (c) => (
                            <span
                              key={c.hex}
                              className="flex-1"
                              style={{ backgroundColor: c.hex }}
                            />
                          ),
                        )}
                      </span>
                    </PresetTile>
                  );
                })}
              </div>
            </section>

            {/* Colour palette */}
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                {t("design.section.palette")}
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {PALETTES.map((p) => (
                  <PresetTile
                    key={p.slug}
                    active={design.palette === p.slug}
                    onSelect={() => choosePalette(p.slug)}
                    label={t(p.nameKey)}
                    ariaLabel={t(p.nameKey)}
                  >
                    <span className="flex gap-1.5" aria-hidden>
                      {[p.primary, p.accent, p.background, p.text].map((c) => (
                        <span
                          key={c.hex}
                          className="h-8 w-8 rounded-full border border-paper-200 dark:border-umber-700"
                          style={{ backgroundColor: c.hex }}
                        />
                      ))}
                    </span>
                  </PresetTile>
                ))}
              </div>
            </section>

            {/* Fonts */}
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                {t("design.section.fonts")}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {FONT_PRESETS.map((f) => (
                  <PresetTile
                    key={f.slug}
                    active={design.fonts === f.slug}
                    onSelect={() => chooseFonts(f.slug)}
                    label={t(f.nameKey)}
                    ariaLabel={t(f.nameKey)}
                  >
                    <span className="flex flex-col gap-0.5" aria-hidden>
                      <span
                        className="text-2xl leading-none text-ink-900 dark:text-paper-50"
                        style={{ fontFamily: f.headingStack }}
                      >
                        Anna & Bence
                      </span>
                      <span
                        className="text-xs text-ink-500 dark:text-umber-300"
                        style={{ fontFamily: f.bodyStack }}
                      >
                        {t("design.font_sample_body")}
                      </span>
                    </span>
                  </PresetTile>
                ))}
              </div>
            </section>

            {/* Print options */}
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                {t("design.section.print")}
              </h2>
              <div className="flex flex-wrap gap-2">
                {(["border", "ornament", "qr"] as const).map((key) => {
                  const on = design.print[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => togglePrint(key)}
                      aria-pressed={on}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:focus-visible:ring-paper-100 ${
                        on
                          ? "border-ink-900 bg-ink-900 text-paper-50 dark:border-paper-100 dark:bg-paper-100 dark:text-umber-900"
                          : "border-paper-300 bg-white text-ink-700 hover:border-paper-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
                      }`}
                    >
                      {on && <Check size={12} strokeWidth={3} aria-hidden />}
                      {t(`design.print.${key}`)}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>

          {/* ── Live preview column ─────────────────────────────────────── */}
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-500 dark:text-umber-200">
              {t("design.preview_label")}
            </p>
            {previewView && (
              <div className="overflow-hidden rounded-2xl border border-paper-200 dark:border-umber-700">
                <div className="max-h-[34rem] overflow-y-auto p-4">
                  <WeddingSiteView
                    view={previewView}
                    household={null}
                    tier="public"
                    locale={locale}
                    isPreview={false}
                    showFooter={false}
                  />
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
