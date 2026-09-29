// Vendor venue editor (shared/venue.ts): the venue-only half of the listing
// editor. Four cards, in the order the couple's page shows them: the venue at
// a glance (type, setting, style, capacity, facilities), its spaces, seasonal
// pricing, and the catering / drinks / supplier rules.
//
// Self-contained like VendorListingPackages: it loads its own VenueDetail and
// every mutation answers with the whole detail, so the cards never drift.
// Chips save on click and text/number fields on blur, matching the rest of the
// editor's "no Save button for a single fact" feel; a space or a pricing rule
// is a multi-field thing and gets one explicit Save.

import { useEffect, useState } from "react";
import { Copy, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  CATERING_RULES,
  cateringConflict,
  DRINKS_RULES,
  EXTERNAL_SUPPLIER_KINDS,
  hasHolidayCalendar,
  MAX_SPACE_PHOTOS,
  MAX_VENUE_PRICE_ITEMS,
  MAX_VENUE_PRICING_RULES,
  MAX_VENUE_SPACES,
  PRICED_MODES,
  QUANTITY_MODES,
  SUPPLIER_POLICIES,
  VENUE_DAY_KINDS,
  VENUE_FACILITIES,
  VENUE_PRICE_ITEM_KEYS,
  VENUE_PRICE_MODES,
  VENUE_SETTINGS,
  VENUE_SPACE_SETTINGS,
  VENUE_SPACE_USES,
  VENUE_STYLE_TAGS,
  VENUE_TYPES,
  type VenueDayKind,
  type VenueDetail,
  type VenuePriceItem,
  type VenuePricingRule,
  type VenueProfile,
  type VenueProfilePatch,
  type VenueSpace,
  type VenueSpaceInput,
  type VenueSpaceUse,
} from "@shared/venue";
import type { ListingPhoto } from "@shared/listings";
import { ApiError } from "../lib/api";
import { vendorVenueApi } from "../lib/endpoints";
import { currencySymbol } from "../lib/format";
import { type Locale, useT } from "../lib/i18n";
import { MoneyInput } from "./MoneyInput";
import { Switch, useConfirm } from "./ui";
import { useToast } from "./ui/ToastProvider";
import { monthLabel, ruleConditionLabel, VenueEstimatePanel } from "./VenueSections";

type T = (k: string, vars?: Record<string, string | number>) => string;

const CHIP_ON =
  "border-blush-300 bg-blush-50 text-blush-700 dark:border-blush-400/40 dark:bg-blush-500/15 dark:text-blush-200";
const CHIP_OFF =
  "border-paper-300 text-steel-700 hover:border-steel-400 dark:border-umber-700 dark:text-umber-200 dark:hover:border-umber-500";
const HINT = "text-xs text-steel-600 dark:text-steel-300";
const ICON_BTN =
  "inline-flex h-8 w-8 items-center justify-center rounded-full text-steel-600 transition hover:bg-paper-100 hover:text-steel-900 disabled:opacity-40 dark:text-steel-300 dark:hover:bg-umber-800";

function errCode(err: unknown): string | undefined {
  if (err instanceof ApiError) return (err.detail as { code?: string } | null)?.code;
  return undefined;
}

/** A server refusal as a sentence, falling back to the generic error. */
function errorMessage(err: unknown, t: T): string {
  const code = errCode(err);
  const known = [
    "catering_conflict",
    "bad_guest_range",
    "item_amount_missing",
    "item_amount_unexpected",
    "item_label_missing",
    "days_missing",
    "fee_amount_without_fee",
    "spaces_full",
    "rules_full",
  ];
  return code && known.includes(code) ? t(`venue.err.${code}`) : t("common.error_generic");
}

function ChipGroup<K extends string>({
  label,
  options,
  selected,
  labelFor,
  onToggle,
  disabled,
}: {
  label: string;
  options: readonly K[];
  selected: readonly K[];
  labelFor: (k: K) => string;
  onToggle: (k: K) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset>
      <legend className="field-label">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((k) => {
          const on = selected.includes(k);
          return (
            <button
              key={k}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onToggle(k)}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${on ? CHIP_ON : CHIP_OFF}`}
            >
              {labelFor(k)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function toggle<K>(list: readonly K[], k: K): K[] {
  return list.includes(k) ? list.filter((x) => x !== k) : [...list, k];
}

const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));
const strOf = (n: number | null): string => (n === null ? "" : String(n));

/** Number field that saves on blur when its value changed. */
function BlurNumber({
  id,
  label,
  value,
  onCommit,
  disabled,
}: {
  id: string;
  label: string;
  value: number | null;
  onCommit: (n: number | null) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(strOf(value));
  useEffect(() => setDraft(strOf(value)), [value]);
  return (
    <label htmlFor={id} className="block">
      <span className="field-label">{label}</span>
      <input
        id={id}
        className="input"
        inputMode="numeric"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 5))}
        onBlur={() => {
          const next = numOrNull(draft);
          if (next !== value) onCommit(next);
        }}
      />
    </label>
  );
}

function BlurText({
  id,
  label,
  value,
  onCommit,
  placeholder,
  multiline,
  maxLength,
  disabled,
}: {
  id: string;
  label: string;
  value: string | null;
  onCommit: (s: string | null) => void;
  placeholder?: string;
  multiline?: boolean;
  maxLength: number;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  const commit = () => {
    const next = draft.trim() === "" ? null : draft.trim();
    if (next !== value) onCommit(next);
  };
  return (
    <label htmlFor={id} className="block">
      <span className="field-label">{label}</span>
      {multiline ? (
        <textarea
          id={id}
          className="input min-h-[4.5rem]"
          value={draft}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
      ) : (
        <input
          id={id}
          className="input"
          value={draft}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
      )}
    </label>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────

export function VendorVenueEditor({ photos }: { photos: ListingPhoto[] }) {
  const { t, locale } = useT();
  const toast = useToast();
  const [detail, setDetail] = useState<VenueDetail | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    vendorVenueApi
      .get()
      .then((d) => alive && setDetail(d))
      .catch(() => alive && toast.error(t("common.error_generic")));
    return () => {
      alive = false;
    };
  }, [t, toast]);

  /** Run one mutation; the detail is replaced by the server's answer. */
  const run = async (fn: () => Promise<VenueDetail>, okKey?: string): Promise<boolean> => {
    setBusy(true);
    try {
      setDetail(await fn());
      if (okKey) toast.success(t(okKey));
      return true;
    } catch (err) {
      toast.error(errorMessage(err, t));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const patch = (body: VenueProfilePatch) => run(() => vendorVenueApi.patchProfile(body));

  if (!detail) {
    return <div className="card h-40 animate-pulse p-4" aria-hidden />;
  }

  return (
    <div className="space-y-6">
      <ProfileCard profile={detail.profile} patch={patch} busy={busy} t={t} />
      <SpacesCard detail={detail} photos={photos} run={run} busy={busy} t={t} locale={locale} />
      <PricingCard detail={detail} run={run} busy={busy} t={t} locale={locale} />
      <RulesCard profile={detail.profile} patch={patch} busy={busy} t={t} />
    </div>
  );
}

// ── Profile ────────────────────────────────────────────────────────────────

function ProfileCard({
  profile: p,
  patch,
  busy,
  t,
}: {
  profile: VenueProfile;
  patch: (b: VenueProfilePatch) => Promise<boolean>;
  busy: boolean;
  t: T;
}) {
  return (
    <section id="vendor-section-venue" className="card scroll-mt-36 space-y-5 p-4">
      <div>
        <h2 className="font-semibold">{t("venue.editor_title")}</h2>
        <p className={HINT}>{t("venue.editor_intro")}</p>
      </div>
      <ChipGroup
        label={t("venue.types_label")}
        options={VENUE_TYPES}
        selected={p.venue_types}
        labelFor={(k) => t(`venue.type.${k}`)}
        onToggle={(k) => patch({ venue_types: toggle(p.venue_types, k) })}
        disabled={busy}
      />
      <ChipGroup
        label={t("venue.settings_label")}
        options={VENUE_SETTINGS}
        selected={p.settings}
        labelFor={(k) => t(`venue.setting.${k}`)}
        onToggle={(k) => patch({ settings: toggle(p.settings, k) })}
        disabled={busy}
      />
      <ChipGroup
        label={t("venue.styles_label")}
        options={VENUE_STYLE_TAGS}
        selected={p.styles}
        labelFor={(k) => t(`venue.style.${k}`)}
        onToggle={(k) => patch({ styles: toggle(p.styles, k) })}
        disabled={busy}
      />

      <div>
        <span className="field-label">{t("venue.capacity_label")}</span>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <BlurNumber
            id="venue-min-guests"
            label={t("venue.min_guests")}
            value={p.min_guests}
            onCommit={(n) => patch({ min_guests: n })}
            disabled={busy}
          />
          <BlurNumber
            id="venue-max-seated"
            label={t("venue.max_seated")}
            value={p.max_seated}
            onCommit={(n) => patch({ max_seated: n })}
            disabled={busy}
          />
          <BlurNumber
            id="venue-max-ceremony"
            label={t("venue.max_ceremony")}
            value={p.max_ceremony}
            onCommit={(n) => patch({ max_ceremony: n })}
            disabled={busy}
          />
          <BlurNumber
            id="venue-max-standing"
            label={t("venue.max_standing")}
            value={p.max_standing}
            onCommit={(n) => patch({ max_standing: n })}
            disabled={busy}
          />
        </div>
      </div>

      <ChipGroup
        label={t("venue.facilities_label")}
        options={VENUE_FACILITIES}
        selected={p.facilities}
        labelFor={(k) => t(`venue.facility.${k}`)}
        onToggle={(k) => patch({ facilities: toggle(p.facilities, k) })}
        disabled={busy}
      />
      {p.facilities.includes("accommodation") && (
        <div className="max-w-[12rem]">
          <BlurNumber
            id="venue-accommodation"
            label={t("venue.accommodation_capacity")}
            value={p.accommodation_capacity}
            onCommit={(n) => patch({ accommodation_capacity: n })}
            disabled={busy}
          />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <BlurText
          id="venue-contact-person"
          label={t("venue.contact_person")}
          value={p.contact_person}
          onCommit={(s) => patch({ contact_person: s })}
          maxLength={80}
          disabled={busy}
        />
        <BlurText
          id="venue-instagram"
          label="Instagram"
          value={p.instagram}
          placeholder="@"
          onCommit={(s) => patch({ instagram: s })}
          maxLength={80}
          disabled={busy}
        />
      </div>
    </section>
  );
}

// ── Catering, drinks, suppliers ────────────────────────────────────────────

function RulesCard({
  profile: p,
  patch,
  busy,
  t,
}: {
  profile: VenueProfile;
  patch: (b: VenueProfilePatch) => Promise<boolean>;
  busy: boolean;
  t: T;
}) {
  return (
    <section id="vendor-section-venue-rules" className="card scroll-mt-36 space-y-5 p-4">
      <div>
        <h2 className="font-semibold">{t("venue.rules_title")}</h2>
        <p className={HINT}>{t("venue.rules_intro")}</p>
      </div>
      <ChipGroup
        label={t("venue.catering_label")}
        options={CATERING_RULES}
        selected={p.catering}
        labelFor={(k) => t(`venue.catering.${k}`)}
        onToggle={(k) => {
          const next = toggle(p.catering, k);
          // Say it here rather than let the server refuse a click.
          if (cateringConflict(next)) {
            void patch({
              catering: next.filter((c) =>
                k === "in_house_required"
                  ? c !== "external_allowed" && c !== "byo_allowed"
                  : c !== "in_house_required",
              ),
            });
            return;
          }
          void patch({ catering: next });
        }}
        disabled={busy}
      />
      <BlurText
        id="venue-catering-partners"
        label={t("venue.catering_partners")}
        value={p.catering_partners}
        placeholder={t("venue.catering_partners_placeholder")}
        onCommit={(s) => patch({ catering_partners: s })}
        maxLength={400}
        disabled={busy}
      />
      <ChipGroup
        label={t("venue.drinks_label")}
        options={DRINKS_RULES}
        selected={p.drinks}
        labelFor={(k) => t(`venue.drinks.${k}`)}
        onToggle={(k) => patch({ drinks: toggle(p.drinks, k) })}
        disabled={busy}
      />
      <fieldset>
        <legend className="field-label">{t("venue.suppliers_label")}</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup">
          {SUPPLIER_POLICIES.map((k) => {
            const on = p.supplier_policy === k;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={busy}
                // Clicking the chosen policy clears it: "not said" is a real
                // answer here, unlike the listing's price band.
                onClick={() => patch({ supplier_policy: on ? null : k })}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${on ? CHIP_ON : CHIP_OFF}`}
              >
                {t(`venue.supplier_policy.${k}`)}
              </button>
            );
          })}
        </div>
      </fieldset>
      <ChipGroup
        label={t("venue.external_label")}
        options={EXTERNAL_SUPPLIER_KINDS}
        selected={p.external_allowed}
        labelFor={(k) => t(`venue.external.${k}`)}
        onToggle={(k) => patch({ external_allowed: toggle(p.external_allowed, k) })}
        disabled={busy}
      />
      <BlurText
        id="venue-rules-note"
        label={t("venue.rules_note")}
        value={p.rules_note}
        placeholder={t("venue.rules_note_placeholder")}
        onCommit={(s) => patch({ rules_note: s })}
        multiline
        maxLength={400}
        disabled={busy}
      />
    </section>
  );
}

// ── Spaces ─────────────────────────────────────────────────────────────────

interface SpaceDraft {
  name: string;
  uses: VenueSpaceUse[];
  setting: VenueSpace["setting"];
  capacity: string;
  fee: VenueSpace["fee"];
  fee_amount: string;
  weather_backup: boolean;
  description: string;
  photo_ids: number[];
}

function spaceDraft(s: VenueSpace | null): SpaceDraft {
  return {
    name: s?.name ?? "",
    uses: s?.uses ?? [],
    setting: s?.setting ?? null,
    capacity: strOf(s?.capacity ?? null),
    fee: s?.fee ?? null,
    fee_amount: strOf(s?.fee_amount ?? null),
    weather_backup: s?.weather_backup ?? false,
    description: s?.description ?? "",
    photo_ids: s?.photo_ids ?? [],
  };
}

function spaceBody(d: SpaceDraft): VenueSpaceInput {
  return {
    name: d.name,
    uses: d.uses,
    setting: d.setting,
    capacity: numOrNull(d.capacity),
    fee: d.fee,
    fee_amount: d.fee === "extra" ? numOrNull(d.fee_amount) : null,
    weather_backup: d.weather_backup,
    description: d.description.trim() || null,
    photo_ids: d.photo_ids,
  };
}

function SpacesCard({
  detail,
  photos,
  run,
  busy,
  t,
  locale,
}: {
  detail: VenueDetail;
  photos: ListingPhoto[];
  run: (fn: () => Promise<VenueDetail>, okKey?: string) => Promise<boolean>;
  busy: boolean;
  t: T;
  locale: Locale;
}) {
  const confirm = useConfirm();
  // null = nothing open, "new" = the add form, a number = that space.
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const atCap = detail.spaces.length >= MAX_VENUE_SPACES;

  const remove = async (s: VenueSpace) => {
    const ok = await confirm({
      title: t("venue.space_delete_title"),
      body: t("venue.space_delete_body", { name: s.name }),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (ok) await run(() => vendorVenueApi.deleteSpace(s.id));
  };

  return (
    <section id="vendor-section-venue-spaces" className="card scroll-mt-36 space-y-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{t("venue.spaces_title")}</h2>
          <p className={HINT}>{t("venue.spaces_intro")}</p>
        </div>
        <button
          type="button"
          className="vp-btn-secondary shrink-0"
          disabled={busy || atCap || editing !== null}
          onClick={() => setEditing("new")}
        >
          <Plus size={16} aria-hidden /> {t("venue.space_add")}
        </button>
      </div>
      {detail.spaces.length === 0 && editing !== "new" && (
        <p className={HINT}>{t("venue.spaces_empty")}</p>
      )}
      <ul className="space-y-3">
        {detail.spaces.map((s) =>
          editing === s.id ? (
            <li key={s.id}>
              <SpaceForm
                initial={s}
                photos={photos}
                busy={busy}
                t={t}
                locale={locale}
                currency={detail.currency}
                onCancel={() => setEditing(null)}
                onSave={async (d) => {
                  if (
                    await run(() => vendorVenueApi.saveSpace(s.id, spaceBody(d)), "venue.saved")
                  ) {
                    setEditing(null);
                  }
                }}
              />
            </li>
          ) : (
            <li
              key={s.id}
              className="flex items-center gap-3 rounded-xl border border-paper-200 p-3 dark:border-umber-700"
            >
              {s.photo_urls[0] ? (
                <img src={s.photo_urls[0]} alt="" className="h-12 w-16 rounded-lg object-cover" />
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-steel-900 dark:text-paper-50">{s.name}</p>
                <p className={HINT}>
                  {[
                    ...s.uses.map((u) => t(`venue.space_use.${u}`)),
                    s.capacity !== null ? t("venue.space_capacity_n", { n: s.capacity }) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <button
                type="button"
                className={ICON_BTN}
                aria-label={t("common.edit")}
                title={t("common.edit")}
                disabled={busy || editing !== null}
                onClick={() => setEditing(s.id)}
              >
                <Pencil size={15} strokeWidth={1.5} aria-hidden />
              </button>
              <button
                type="button"
                className={ICON_BTN}
                aria-label={t("common.delete")}
                title={t("common.delete")}
                disabled={busy}
                onClick={() => void remove(s)}
              >
                <Trash2 size={15} strokeWidth={1.5} aria-hidden />
              </button>
            </li>
          ),
        )}
        {editing === "new" && (
          <li>
            <SpaceForm
              initial={null}
              photos={photos}
              busy={busy}
              t={t}
              locale={locale}
              currency={detail.currency}
              onCancel={() => setEditing(null)}
              onSave={async (d) => {
                if (await run(() => vendorVenueApi.addSpace(spaceBody(d)), "venue.saved")) {
                  setEditing(null);
                }
              }}
            />
          </li>
        )}
      </ul>
    </section>
  );
}

function SpaceForm({
  initial,
  photos,
  busy,
  t,
  locale,
  currency,
  onSave,
  onCancel,
}: {
  initial: VenueSpace | null;
  photos: ListingPhoto[];
  busy: boolean;
  t: T;
  locale: Locale;
  currency: VenueDetail["currency"];
  onSave: (d: SpaceDraft) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<SpaceDraft>(() => spaceDraft(initial));
  const set = <K extends keyof SpaceDraft>(k: K, v: SpaceDraft[K]) =>
    setD((prev) => ({ ...prev, [k]: v }));
  const idp = `venue-space-${initial?.id ?? "new"}`;
  return (
    <form
      className="space-y-4 rounded-xl border border-blush-200 p-3 dark:border-blush-400/30"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(d);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <label htmlFor={`${idp}-name`} className="block">
          <span className="field-label">{t("venue.space_name")}</span>
          <input
            id={`${idp}-name`}
            className="input"
            required
            maxLength={80}
            placeholder={t("venue.space_name_placeholder")}
            value={d.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </label>
        <label htmlFor={`${idp}-cap`} className="block">
          <span className="field-label">{t("venue.space_capacity")}</span>
          <input
            id={`${idp}-cap`}
            className="input"
            inputMode="numeric"
            value={d.capacity}
            onChange={(e) => set("capacity", e.target.value.replace(/\D/g, "").slice(0, 5))}
          />
        </label>
      </div>
      <ChipGroup
        label={t("venue.space_uses")}
        options={VENUE_SPACE_USES}
        selected={d.uses}
        labelFor={(k) => t(`venue.space_use.${k}`)}
        onToggle={(k) => set("uses", toggle(d.uses, k))}
      />
      <ChipGroup
        label={t("venue.space_setting_label")}
        options={VENUE_SPACE_SETTINGS}
        selected={d.setting ? [d.setting] : []}
        labelFor={(k) => t(`venue.space_setting.${k}`)}
        onToggle={(k) => set("setting", d.setting === k ? null : k)}
      />
      <div className="flex flex-wrap items-end gap-3">
        <ChipGroup
          label={t("venue.space_fee_label")}
          options={["included", "extra"] as const}
          selected={d.fee ? [d.fee] : []}
          labelFor={(k) =>
            t(k === "included" ? "venue.space_fee_included" : "venue.space_fee_extra")
          }
          onToggle={(k) => set("fee", d.fee === k ? null : k)}
        />
        {d.fee === "extra" && (
          <label className="block w-40">
            <span className="field-label">
              {t("venue.space_fee_amount")} ({currencySymbol(currency, locale)})
            </span>
            <MoneyInput
              className="input"
              value={d.fee_amount}
              onChange={(v) => set("fee_amount", v)}
              locale={locale}
            />
          </label>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Switch
          checked={d.weather_backup}
          onChange={(v) => set("weather_backup", v)}
          label={t("venue.space_weather_backup")}
        />
        <span className="text-sm text-steel-700 dark:text-umber-100">
          {t("venue.space_weather_backup")}
        </span>
      </div>
      <label htmlFor={`${idp}-desc`} className="block">
        <span className="field-label">{t("venue.space_description")}</span>
        <textarea
          id={`${idp}-desc`}
          className="input min-h-[4rem]"
          maxLength={400}
          value={d.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </label>
      <fieldset>
        <legend className="field-label">
          {t("venue.space_photos", { max: MAX_SPACE_PHOTOS })}
        </legend>
        {photos.length === 0 ? (
          <p className={HINT}>{t("venue.space_photos_empty")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {photos.map((ph) => {
              const on = d.photo_ids.includes(ph.id);
              const full = !on && d.photo_ids.length >= MAX_SPACE_PHOTOS;
              return (
                <button
                  key={ph.id}
                  type="button"
                  aria-pressed={on}
                  disabled={full}
                  onClick={() => set("photo_ids", toggle(d.photo_ids, ph.id))}
                  className={`overflow-hidden rounded-lg ring-2 transition ${
                    on ? "ring-blush-500" : "ring-transparent opacity-70 hover:opacity-100"
                  } disabled:opacity-30`}
                >
                  <img src={ph.url} alt="" className="h-14 w-20 object-cover" />
                </button>
              );
            })}
          </div>
        )}
      </fieldset>
      <div className="flex justify-end gap-2">
        <button type="button" className="vp-btn-quiet" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </button>
        <button type="submit" className="vp-btn-primary" disabled={busy || d.name.trim() === ""}>
          {t("common.save")}
        </button>
      </div>
    </form>
  );
}

// ── Pricing rules ──────────────────────────────────────────────────────────

interface ItemDraft {
  key: VenuePriceItem["key"];
  label: string;
  mode: VenuePriceItem["mode"];
  amount: string;
  quantity: string;
  optional: boolean;
}

interface RuleDraft {
  name: string;
  start_month: number;
  end_month: number;
  days: VenueDayKind[];
  min_guests: string;
  max_guests: string;
  min_spend: string;
  available: boolean;
  items: ItemDraft[];
}

function itemDraft(i: VenuePriceItem): ItemDraft {
  return {
    key: i.key,
    label: i.label ?? "",
    mode: i.mode,
    amount: strOf(i.amount),
    quantity: strOf(i.quantity),
    optional: i.optional,
  };
}

function newRuleDraft(t: T): RuleDraft {
  const blank = (key: ItemDraft["key"], mode: ItemDraft["mode"]): ItemDraft => ({
    key,
    label: "",
    mode,
    amount: "",
    quantity: "",
    optional: false,
  });
  return {
    name: t("venue.rule_name_default"),
    start_month: 5,
    end_month: 9,
    days: ["saturday"],
    min_guests: "",
    max_guests: "",
    min_spend: "",
    available: true,
    items: [
      blank("venue_rental", "fixed"),
      blank("catering", "per_guest"),
      blank("drinks", "included"),
    ],
  };
}

function ruleDraft(r: VenuePricingRule): RuleDraft {
  return {
    name: r.name,
    start_month: r.start_month,
    end_month: r.end_month,
    days: r.days,
    min_guests: strOf(r.min_guests),
    max_guests: strOf(r.max_guests),
    min_spend: strOf(r.min_spend),
    available: r.available,
    items: r.items.map(itemDraft),
  };
}

function ruleBody(d: RuleDraft) {
  return {
    name: d.name,
    start_month: d.start_month,
    end_month: d.end_month,
    days: d.days,
    min_guests: numOrNull(d.min_guests),
    max_guests: numOrNull(d.max_guests),
    min_spend: numOrNull(d.min_spend),
    available: d.available,
    items: d.items.map((i) => ({
      key: i.key,
      label: i.label.trim() || null,
      mode: i.mode,
      amount: PRICED_MODES.includes(i.mode) ? numOrNull(i.amount) : null,
      quantity: QUANTITY_MODES.includes(i.mode) ? numOrNull(i.quantity) : null,
      optional: i.optional,
    })),
  };
}

function PricingCard({
  detail,
  run,
  busy,
  t,
  locale,
}: {
  detail: VenueDetail;
  run: (fn: () => Promise<VenueDetail>, okKey?: string) => Promise<boolean>;
  busy: boolean;
  t: T;
  locale: Locale;
}) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const atCap = detail.pricing_rules.length >= MAX_VENUE_PRICING_RULES;

  const remove = async (r: VenuePricingRule) => {
    const ok = await confirm({
      title: t("venue.rule_delete_title"),
      body: t("venue.rule_delete_body", { name: r.name }),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (ok) await run(() => vendorVenueApi.deleteRule(r.id));
  };

  return (
    <section id="vendor-section-venue-pricing" className="card scroll-mt-36 space-y-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{t("venue.pricing_title")}</h2>
          <p className={HINT}>{t("venue.pricing_intro")}</p>
        </div>
        <button
          type="button"
          className="vp-btn-secondary shrink-0"
          disabled={busy || atCap || editing !== null}
          onClick={() => setEditing("new")}
        >
          <Plus size={16} aria-hidden /> {t("venue.rule_add")}
        </button>
      </div>
      {detail.pricing_rules.length === 0 && editing !== "new" && (
        <p className={HINT}>{t("venue.pricing_empty")}</p>
      )}
      <ul className="space-y-3">
        {detail.pricing_rules.map((r) =>
          editing === r.id ? (
            <li key={r.id}>
              <RuleForm
                initial={ruleDraft(r)}
                detail={detail}
                busy={busy}
                t={t}
                locale={locale}
                onCancel={() => setEditing(null)}
                onSave={async (d) => {
                  if (await run(() => vendorVenueApi.saveRule(r.id, ruleBody(d)), "venue.saved")) {
                    setEditing(null);
                  }
                }}
              />
            </li>
          ) : (
            <li
              key={r.id}
              className="flex items-center gap-3 rounded-xl border border-paper-200 p-3 dark:border-umber-700"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-steel-900 dark:text-paper-50">
                  {r.name}
                  {!r.available && (
                    <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
                      {t("venue.rule_unavailable_badge")}
                    </span>
                  )}
                </p>
                <p className={HINT}>{ruleConditionLabel(r, locale, t)}</p>
              </div>
              <button
                type="button"
                className={ICON_BTN}
                aria-label={t("venue.rule_duplicate")}
                title={t("venue.rule_duplicate")}
                disabled={busy || atCap}
                onClick={() => void run(() => vendorVenueApi.duplicateRule(r.id))}
              >
                <Copy size={15} strokeWidth={1.5} aria-hidden />
              </button>
              <button
                type="button"
                className={ICON_BTN}
                aria-label={t("common.edit")}
                title={t("common.edit")}
                disabled={busy || editing !== null}
                onClick={() => setEditing(r.id)}
              >
                <Pencil size={15} strokeWidth={1.5} aria-hidden />
              </button>
              <button
                type="button"
                className={ICON_BTN}
                aria-label={t("common.delete")}
                title={t("common.delete")}
                disabled={busy}
                onClick={() => void remove(r)}
              >
                <Trash2 size={15} strokeWidth={1.5} aria-hidden />
              </button>
            </li>
          ),
        )}
        {editing === "new" && (
          <li>
            <RuleForm
              initial={newRuleDraft(t)}
              detail={detail}
              busy={busy}
              t={t}
              locale={locale}
              onCancel={() => setEditing(null)}
              onSave={async (d) => {
                if (await run(() => vendorVenueApi.addRule(ruleBody(d)), "venue.saved")) {
                  setEditing(null);
                }
              }}
            />
          </li>
        )}
      </ul>

      {detail.pricing_rules.length > 0 && (
        <div className="rounded-xl bg-paper-100 p-3 dark:bg-umber-800">
          <p className="mb-3 text-sm font-medium text-steel-900 dark:text-paper-50">
            {t("venue.test_title")}
          </p>
          <VenueEstimatePanel
            venue={detail}
            initialDate={null}
            initialGuests={null}
            locale={locale}
            t={t}
          />
        </div>
      )}
    </section>
  );
}

function RuleForm({
  initial,
  detail,
  busy,
  t,
  locale,
  onSave,
  onCancel,
}: {
  initial: RuleDraft;
  detail: VenueDetail;
  busy: boolean;
  t: T;
  locale: Locale;
  onSave: (d: RuleDraft) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<RuleDraft>(initial);
  const set = <K extends keyof RuleDraft>(k: K, v: RuleDraft[K]) =>
    setD((prev) => ({ ...prev, [k]: v }));
  const setItem = (i: number, patch: Partial<ItemDraft>) =>
    setD((prev) => ({
      ...prev,
      items: prev.items.map((it, j) => (j === i ? { ...it, ...patch } : it)),
    }));
  const sym = currencySymbol(detail.currency, locale);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const holidaysKnown = hasHolidayCalendar(detail.country);

  return (
    <form
      className="space-y-4 rounded-xl border border-blush-200 p-3 dark:border-blush-400/30"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(d);
      }}
    >
      <label className="block">
        <span className="field-label">{t("venue.rule_name")}</span>
        <input
          className="input"
          required
          maxLength={80}
          value={d.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label">{t("venue.rule_from")}</span>
          <select
            className="input"
            value={d.start_month}
            onChange={(e) => set("start_month", Number(e.target.value))}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m, locale)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">{t("venue.rule_to")}</span>
          <select
            className="input"
            value={d.end_month}
            onChange={(e) => set("end_month", Number(e.target.value))}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m, locale)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ChipGroup
        label={t("venue.rule_days")}
        options={VENUE_DAY_KINDS}
        selected={d.days}
        labelFor={(k) => t(`venue.day.${k}`)}
        onToggle={(k) => set("days", toggle(d.days, k))}
      />
      {d.days.includes("holiday") && !holidaysKnown && (
        <p className={HINT}>{t("venue.holiday_unsupported")}</p>
      )}
      <div className="flex items-center gap-3">
        <Switch
          checked={d.available}
          onChange={(v) => set("available", v)}
          label={t("venue.rule_available")}
        />
        <span className="text-sm text-steel-700 dark:text-umber-100">
          {d.available ? t("venue.rule_available") : t("venue.rule_unavailable_hint")}
        </span>
      </div>

      {d.available && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="field-label">{t("venue.rule_min_guests")}</span>
              <input
                className="input"
                inputMode="numeric"
                value={d.min_guests}
                onChange={(e) => set("min_guests", e.target.value.replace(/\D/g, "").slice(0, 5))}
              />
            </label>
            <label className="block">
              <span className="field-label">{t("venue.rule_max_guests")}</span>
              <input
                className="input"
                inputMode="numeric"
                value={d.max_guests}
                onChange={(e) => set("max_guests", e.target.value.replace(/\D/g, "").slice(0, 5))}
              />
            </label>
            <label className="block">
              <span className="field-label">
                {t("venue.rule_min_spend")} ({sym})
              </span>
              <MoneyInput
                className="input"
                value={d.min_spend}
                onChange={(v) => set("min_spend", v)}
                locale={locale}
              />
            </label>
          </div>

          <fieldset className="space-y-2">
            <legend className="field-label">{t("venue.items_title")}</legend>
            {d.items.map((it, i) => (
              <div
                key={i}
                className="grid grid-cols-2 gap-2 rounded-lg border border-paper-200 p-2 sm:grid-cols-[1.3fr_1fr_1fr_auto] dark:border-umber-700"
              >
                <div className="col-span-2 space-y-1 sm:col-span-1">
                  <select
                    className="input"
                    aria-label={t("venue.item_label")}
                    value={it.key}
                    onChange={(e) => setItem(i, { key: e.target.value as ItemDraft["key"] })}
                  >
                    {VENUE_PRICE_ITEM_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {t(`venue.item.${k}`)}
                      </option>
                    ))}
                  </select>
                  {it.key === "custom" && (
                    <input
                      className="input"
                      maxLength={80}
                      placeholder={t("venue.item_custom_placeholder")}
                      value={it.label}
                      onChange={(e) => setItem(i, { label: e.target.value })}
                    />
                  )}
                </div>
                <select
                  className="input"
                  aria-label={t("venue.item_mode")}
                  value={it.mode}
                  onChange={(e) => setItem(i, { mode: e.target.value as ItemDraft["mode"] })}
                >
                  {VENUE_PRICE_MODES.map((m) => (
                    <option key={m} value={m}>
                      {t(`venue.mode.${m}`)}
                    </option>
                  ))}
                </select>
                <div className="space-y-1">
                  {PRICED_MODES.includes(it.mode) && (
                    <MoneyInput
                      className="input"
                      aria-label={`${t("venue.item_amount")} (${sym})`}
                      placeholder={sym}
                      value={it.amount}
                      onChange={(v) => setItem(i, { amount: v })}
                      locale={locale}
                    />
                  )}
                  {QUANTITY_MODES.includes(it.mode) && (
                    <input
                      className="input"
                      inputMode="numeric"
                      aria-label={t(
                        it.mode === "per_room" ? "venue.item_rooms" : "venue.item_hours",
                      )}
                      placeholder={t(
                        it.mode === "per_room" ? "venue.item_rooms" : "venue.item_hours",
                      )}
                      value={it.quantity}
                      onChange={(e) =>
                        setItem(i, { quantity: e.target.value.replace(/\D/g, "").slice(0, 3) })
                      }
                    />
                  )}
                </div>
                <div className="col-span-2 flex items-center justify-between gap-2 sm:col-span-1">
                  <label className="inline-flex items-center gap-1.5 text-xs text-steel-700 dark:text-umber-200">
                    <input
                      type="checkbox"
                      checked={it.optional}
                      onChange={(e) => setItem(i, { optional: e.target.checked })}
                    />
                    {t("venue.item_optional")}
                  </label>
                  <button
                    type="button"
                    className={ICON_BTN}
                    aria-label={t("common.delete")}
                    onClick={() =>
                      set(
                        "items",
                        d.items.filter((_, j) => j !== i),
                      )
                    }
                  >
                    <X size={15} strokeWidth={1.5} aria-hidden />
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="vp-btn-quiet"
              disabled={d.items.length >= MAX_VENUE_PRICE_ITEMS}
              onClick={() =>
                set("items", [
                  ...d.items,
                  {
                    key: "custom",
                    label: "",
                    mode: "fixed",
                    amount: "",
                    quantity: "",
                    optional: false,
                  },
                ])
              }
            >
              <Plus size={15} aria-hidden /> {t("venue.item_add")}
            </button>
          </fieldset>
        </>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" className="vp-btn-quiet" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </button>
        <button
          type="submit"
          className="vp-btn-primary"
          disabled={busy || d.name.trim() === "" || d.days.length === 0}
        >
          {t("common.save")}
        </button>
      </div>
    </form>
  );
}
