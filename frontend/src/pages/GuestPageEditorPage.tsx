// Single couple-facing editor for the public guest-facing page. Replaces the
// older split between /app/wedding-site (publish + venue + cover) and
// /app/guest-portal (read-only preview of the gated /g/:slug/:code view).
// The merger reflects how couples actually think about the artifact: one
// thing they share with guests, with a public top section (anyone with the
// link) and a deeper post-RSVP-yes block that unlocks for confirmed guests.

import type { Couple, Household, PlaceSuggestion } from "@shared/types";
import type { CoupleSupplier } from "@shared/couple_suppliers";
import type { CouplePick } from "@shared/picks";
import type { DirectorySupplier } from "@shared/suppliers";
import { toPublicDesign } from "@shared/design";
import type { PublicWeddingScheduleEntry, PublicWeddingWebsiteView } from "@shared/wedding_website";
import type { ScheduleEvent } from "@shared/schedule";
import {
  ChevronRight,
  Clipboard,
  Copy,
  ExternalLink,
  Eye,
  Globe,
  Lock,
  MessageCircle,
  Move,
  Palette,
  Plus,
  RefreshCcw,
  MapPin,
  Trash2,
  Unlock,
  Upload,
} from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { WeddingSiteView } from "../components/WeddingSiteView";
import { InfoHint } from "../components/InfoHint";
import { Dialog, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import {
  coupleApi,
  coupleSupplierApi,
  householdApi,
  picksApi,
  placesApi,
  scheduleApi,
  supplierApi,
} from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

/** Pre-made "Good to know" rows. They serialize back into the single
 *  `useful_info` text column as "Label: value" lines — ONLY the filled ones —
 *  so the guest page (which renders that column as pre-line text and hides the
 *  whole band when empty) shows exactly the rows the couple filled, with no
 *  schema change. */
const USEFUL_INFO_FIELDS = [
  { key: "parking", labelKey: "guest_page_editor.useful_field_parking" },
  { key: "getting_there", labelKey: "guest_page_editor.useful_field_getting_there" },
  { key: "transfer", labelKey: "guest_page_editor.useful_field_transfer" },
  { key: "accommodation", labelKey: "guest_page_editor.useful_field_accommodation" },
] as const;

type UsefulInfoKey = (typeof USEFUL_INFO_FIELDS)[number]["key"];
type UsefulInfoFields = Record<UsefulInfoKey, string>;

const EMPTY_USEFUL_FIELDS: UsefulInfoFields = {
  parking: "",
  getting_there: "",
  transfer: "",
  accommodation: "",
};

/** Label variants (lowercased, no colon) recognised when re-parsing the stored
 *  text back into rows — current HU + EN labels, so the structured rows survive
 *  a locale switch. A line that matches none falls through to the free-form
 *  "other" box, so nothing the couple typed is ever lost. */
const USEFUL_INFO_PREFIXES: Record<string, UsefulInfoKey> = {
  parkolás: "parking",
  parking: "parking",
  megközelítés: "getting_there",
  "getting there": "getting_there",
  transzfer: "transfer",
  transfer: "transfer",
  szállás: "accommodation",
  accommodation: "accommodation",
  // Recovery: before these i18n keys existed, t() echoed the raw key, so rows
  // saved during that window were serialized with the key string as their
  // label. Recognise those too so a reload re-homes them into the right field
  // instead of dumping them into the free-form "other" box.
  "guest_page_editor.useful_field_parking": "parking",
  "guest_page_editor.useful_field_getting_there": "getting_there",
  "guest_page_editor.useful_field_transfer": "transfer",
  "guest_page_editor.useful_field_accommodation": "accommodation",
};

/** Split the stored `useful_info` text into the known rows + a free-form rest.
 *  Each "Label: value" line whose label is recognised fills its row (first hit
 *  wins); every other line is preserved verbatim in `other`. */
function parseUsefulInfo(text: string): { fields: UsefulInfoFields; other: string } {
  const fields: UsefulInfoFields = { ...EMPTY_USEFUL_FIELDS };
  const otherLines: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([^:]+?)\s*:\s*(.*)$/);
    const label = m?.[1]?.trim().toLowerCase();
    const key = label ? USEFUL_INFO_PREFIXES[label] : undefined;
    if (key && !fields[key]) {
      fields[key] = (m?.[2] ?? "").trim();
    } else {
      otherLines.push(line);
    }
  }
  return { fields, other: otherLines.join("\n").trim() };
}

/** Compose the filled rows (in catalog order) + the free-form rest back into a
 *  single text blob for the `useful_info` column. Empty rows are dropped, so the
 *  guest page only ever shows lines the couple actually wrote. */
function serializeUsefulInfo(
  fields: UsefulInfoFields,
  other: string,
  t: (key: string) => string,
): string {
  const lines: string[] = [];
  for (const f of USEFUL_INFO_FIELDS) {
    const v = fields[f.key].trim();
    if (v) lines.push(`${t(f.labelKey)}: ${v}`);
  }
  const rest = other.trim();
  if (rest) lines.push(rest);
  return lines.join("\n");
}

/** Venue-name input with two assists:
 *  - a debounced Nominatim-backed autocomplete (the /api/places/search proxy
 *    the honeymoon picker uses, in `kind="venue"` mode) so typing "Sári"
 *    surfaces real venue names rather than the settlements they sit in;
 *  - quick-fill chips for venues the couple already saved among their
 *    suppliers (a picked directory venue or a DIY "venue" entry).
 *  We commit the venue NAME plus its town ("Sári Csárda, Dunakiliti"), not the
 *  full street address — the precise address lives on the invitation /
 *  post-RSVP block. */
function VenueNameField({
  value,
  onChange,
  onPickCity,
  savedVenues,
  country,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Called when a place is picked from the autocomplete so the parent can
   *  auto-fill the separate City field from the result's settlement. */
  onPickCity?: (city: string) => void;
  savedVenues: { id: string; name: string }[];
  /** ISO 3166-1 alpha-2 — scopes the autocomplete to the couple's country so
   *  a HU couple isn't offered cross-border (e.g. Austrian) venues. */
  country: string;
}) {
  const { t } = useT();
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  // After picking a suggestion / chip we write the committed name back into
  // `value`, which would otherwise retrigger the debounced search and reopen
  // the dropdown. This one-shot flag swallows that next run.
  const skipNextSearch = useRef(false);

  useEffect(() => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const q = value.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const myId = ++requestId.current;
    const handle = setTimeout(async () => {
      try {
        const r = await placesApi.search(q, country, "venue");
        // Discard stale responses — only the latest typed query wins.
        if (myId !== requestId.current) return;
        setSuggestions(r.places);
        setHighlight(-1);
        setOpen(r.places.length > 0);
      } catch {
        if (myId !== requestId.current) return;
        setSuggestions([]);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [value, country]);

  // Click-outside just closes the dropdown — the field is already controlled,
  // so there's nothing to commit (unlike the honeymoon tile).
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function pick(name: string) {
    skipNextSearch.current = true;
    requestId.current++; // invalidate any in-flight search
    setOpen(false);
    setSuggestions([]);
    onChange(name);
  }

  /** Commit a Nominatim suggestion: the POI name ("Sári Csárda") goes in the
   *  venue field, and the settlement ("Dunakiliti") auto-fills the separate
   *  City field. We skip the city when the name already IS the settlement (a
   *  plain town search) or already contains it, to avoid "Dunakiliti" twice. */
  function pickSuggestion(s: PlaceSuggestion) {
    const name = s.primary.trim();
    const loc = s.locality?.trim();
    const nameLc = name.toLowerCase();
    const locLc = loc?.toLowerCase();
    pick(name);
    if (onPickCity) {
      const distinct = loc && locLc && nameLc !== locLc && !nameLc.includes(locLc);
      onPickCity(distinct ? (loc as string) : "");
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (suggestions.length === 0) return;
      setOpen(true);
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (suggestions.length === 0) return;
      setOpen(true);
      setHighlight((h) => (h <= 0 ? suggestions.length - 1 : h - 1));
    } else if (e.key === "Enter") {
      const sel = highlight >= 0 ? suggestions[highlight] : undefined;
      if (open && sel) {
        e.preventDefault();
        pickSuggestion(sel);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  // "Option B" — saved venues the couple can drop in with one click, minus the
  // one already in the field so we don't offer a no-op chip.
  const chips = savedVenues.filter((v) => v.name.trim() && v.name.trim() !== value.trim());

  return (
    <div ref={wrapperRef} className="relative">
      <input
        id="guest-page-venue"
        type="text"
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onKeyDown={onKey}
        placeholder={t("wedding_site_editor.venue_placeholder")}
        maxLength={200}
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
      />
      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-xl border border-paper-300 bg-white py-1 shadow-pop dark:border-umber-700 dark:bg-umber-800"
        >
          {suggestions.map((s, i) => (
            <li key={`${s.primary}-${i}`}>
              <button
                type="button"
                role="option"
                aria-selected={i === highlight}
                onMouseDown={(e) => {
                  // mousedown fires before the input blurs, so the pick lands.
                  e.preventDefault();
                  pickSuggestion(s);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`flex w-full items-start gap-2 px-3 py-2 text-left ${
                  i === highlight
                    ? "bg-blush-50 dark:bg-blush-400/15"
                    : "hover:bg-paper-50 dark:hover:bg-umber-700"
                }`}
              >
                <MapPin
                  size={14}
                  className="mt-0.5 shrink-0 text-blush-700 dark:text-blush-300"
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-900 dark:text-paper-50">
                    {s.primary}
                  </span>
                  {s.secondary && s.secondary !== s.primary && (
                    <span className="block truncate text-[11px] text-ink-500 dark:text-umber-300">
                      {s.secondary}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-ink-500 dark:text-umber-300">
            {t("guest_page_editor.venue_saved_prefix")}
          </span>
          {chips.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => pick(v.name)}
              className="inline-flex items-center gap-1 rounded-full border border-sage-300 bg-sage-50 px-2.5 py-0.5 text-xs font-medium text-sage-800 hover:bg-sage-100 dark:border-sage-700 dark:bg-sage-900/30 dark:text-sage-200 dark:hover:bg-sage-900/50"
            >
              <MapPin size={11} aria-hidden />
              {v.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Drag-to-reposition control for the cover photo. The hero crops the cover to
 *  a wide band, so the couple drags the photo inside this same-shape frame to
 *  choose the focal point. `x`/`y` are object-position percentages (0..100);
 *  `onChange` fires live during the drag (updates the preview), `onCommit` fires
 *  on release (persists). Dragging the photo right reveals its left edge, so a
 *  rightward drag lowers object-position-x — the natural "move the photo" feel. */
function CoverPositioner({
  src,
  x,
  y,
  onChange,
  onCommit,
  hint,
}: {
  src: string;
  x: number;
  y: number;
  onChange: (x: number, y: number) => void;
  onCommit: (x: number, y: number) => void;
  hint: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

  function nextFrom(e: { clientX: number; clientY: number }): [number, number] | null {
    const el = ref.current;
    const d = drag.current;
    if (!el || !d) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const dxPct = ((e.clientX - d.sx) / rect.width) * 100;
    const dyPct = ((e.clientY - d.sy) / rect.height) * 100;
    return [clamp(d.px - dxPct), clamp(d.py - dyPct)];
  }

  return (
    <div className="mt-2">
      <div
        ref={ref}
        className={`relative w-full select-none overflow-hidden rounded-lg border border-paper-300 dark:border-umber-700 ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        style={{ aspectRatio: "21 / 9", touchAction: "none" }}
        onPointerDown={(e) => {
          ref.current?.setPointerCapture(e.pointerId);
          drag.current = { sx: e.clientX, sy: e.clientY, px: x, py: y };
          setDragging(true);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const n = nextFrom(e);
          if (n) onChange(n[0], n[1]);
        }}
        onPointerUp={(e) => {
          const n = nextFrom(e);
          ref.current?.releasePointerCapture(e.pointerId);
          drag.current = null;
          setDragging(false);
          if (n) {
            onChange(n[0], n[1]);
            onCommit(n[0], n[1]);
          }
        }}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="pointer-events-none h-full w-full object-cover"
          style={{ objectPosition: `${x}% ${y}%` }}
        />
        <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-gradient-to-t from-black/55 to-transparent px-2 py-1.5 text-[11px] font-medium text-white">
          <Move size={12} aria-hidden />
          {hint}
        </span>
      </div>
    </div>
  );
}

export default function GuestPageEditorPage() {
  const { t, locale } = useT();
  useDocumentMeta("seo.guest_page_title", "seo.guest_page_description");
  const toast = useToast();
  const confirm = useConfirm();

  const [couple, setCouple] = useState<Couple | null>(null);
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [isPublic, setIsPublic] = useState(false);
  const [venueName, setVenueName] = useState("");
  const [venueCity, setVenueCity] = useState("");
  // Exact wedding date (ISO YYYY-MM-DD, or "" for none/fuzzy). Editable here
  // because the date is the hero's signature element; saving folds it into an
  // `exact` goal server-side, which also updates the dashboard.
  const [weddingDate, setWeddingDate] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  // Cover focal point (object-position %, 0..100). Adjusted by dragging the
  // cover in the positioner below; persisted separately from the debounced
  // text auto-save (a drag commits on release).
  const [coverPositionX, setCoverPositionX] = useState(50);
  const [coverPositionY, setCoverPositionY] = useState(50);
  const [guestPageIntro, setGuestPageIntro] = useState("");
  // "Good to know" is edited as pre-made labelled rows (+ a free-form rest),
  // but still persisted into the single `useful_info` text column.
  const [usefulFields, setUsefulFields] = useState<UsefulInfoFields>(EMPTY_USEFUL_FIELDS);
  const [usefulOther, setUsefulOther] = useState("");
  const [postRsvpContent, setPostRsvpContent] = useState("");
  // Public-content disclosure. Starts open so an incomplete page nudges the
  // couple to fill it; once the core fields are all set, it defaults collapsed
  // (set after load). Controlled + onToggle so revealField's DOM-level open
  // (preview ghost shortcuts) stays in sync with this state.
  const [publicOpen, setPublicOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-household share rows — Phase 3 of the guest-page merger. Hidden behind
  // a <details> below the main share block so the page doesn't grow vertically
  // for couples that don't need it. We keep these in their own state slice (vs
  // refetching with the couple) because rotating a code returns just the new
  // code, and we patch the local row rather than round-tripping the whole list.
  const [households, setHouseholds] = useState<Household[]>([]);
  const [rotatingId, setRotatingId] = useState<number | null>(null);
  // Venues the couple already saved among their suppliers — surfaced as
  // one-click quick-fill chips under the venue-name field ("Option B"). We
  // resolve a picked "venue" category to its name (directory or DIY) and add
  // any DIY "venue" suppliers. Loaded in its own effect so a supplier-API
  // hiccup never blocks the main couple/schedule/household load.
  const [savedVenues, setSavedVenues] = useState<{ id: string; name: string }[]>([]);
  // Cover-image upload — the server persists the file and the new URL into
  // the couples row in the same transaction, so the upload bypasses the
  // dirty/save flow. We track only the in-flight bit + hidden file input
  // ref; on success we patch the local `couple` + `coverImageUrl` to the
  // returned `/uploads/couples/<id>/cover.<ext>?v=…` value.
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverDragOver, setCoverDragOver] = useState(false);
  const coverFileInputRef = useRef<HTMLInputElement>(null);
  // Which structured field is being edited in a modal sheet (click-to-edit on
  // the preview opens these instead of scrolling to a form). null = closed.
  const [editPanel, setEditPanel] = useState<"cover" | "useful" | "date" | "schedule" | null>(null);

  const postRsvpTextareaRef = useRef<HTMLTextAreaElement>(null);

  // "\n\n" separator between sections is intentional: the public site
  // renders the field with `whitespace-pre-line`, so the blank line is what
  // visually separates one topic block from the next.
  function insertPostRsvpSection(label: string) {
    setPostRsvpContent((current) => {
      const trimmed = current.replace(/\s+$/, "");
      const sep = trimmed.length === 0 ? "" : "\n\n";
      const next = `${trimmed}${sep}${label}:\n`;
      if (next.length > 8000) return current;
      requestAnimationFrame(() => {
        const el = postRsvpTextareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(next.length, next.length);
          el.scrollTop = el.scrollHeight;
        }
      });
      return next;
    });
  }

  // Drop a ready-made welcome note into the intro field. Offered only while
  // the field is empty so we never clobber something the couple already wrote;
  // they can edit the picked text freely afterwards.
  function applyIntroSuggestion(text: string) {
    setGuestPageIntro(text);
    requestAnimationFrame(() => {
      const el = document.getElementById("guest-page-intro");
      if (el instanceof HTMLTextAreaElement) {
        el.focus();
        el.setSelectionRange(text.length, text.length);
      }
    });
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([coupleApi.current(), scheduleApi.list(), householdApi.list()])
      .then(([cR, sR, hR]) => {
        if (cancelled) return;
        if (cR.couple) {
          setCouple(cR.couple);
          setIsPublic(cR.couple.is_public);
          setVenueName(cR.couple.venue_name ?? "");
          setVenueCity(cR.couple.venue_city ?? "");
          setWeddingDate(cR.couple.wedding_date ?? "");
          setCoverImageUrl(cR.couple.cover_image_url ?? "");
          setCoverPositionX(cR.couple.cover_position_x ?? 50);
          setCoverPositionY(cR.couple.cover_position_y ?? 50);
          setGuestPageIntro(cR.couple.guest_page_intro ?? "");
          {
            const parsed = parseUsefulInfo(cR.couple.useful_info ?? "");
            setUsefulFields(parsed.fields);
            setUsefulOther(parsed.other);
          }
          setPostRsvpContent(cR.couple.post_rsvp_content ?? "");
          // Collapse the public section when the couple has already filled the
          // core fields (venue + cover + welcome text); keep it open otherwise.
          const publicComplete = Boolean(
            (cR.couple.venue_name ?? "").trim() &&
              (cR.couple.cover_image_url ?? "").trim() &&
              (cR.couple.guest_page_intro ?? "").trim(),
          );
          setPublicOpen(!publicComplete);
        }
        setEvents(sR.events);
        // Hide the host-couple's own household — they don't need a personal
        // RSVP link to themselves. Other auto-created singletons stay visible
        // since they represent real guests the couple still has to brief.
        setHouseholds(hR.households.filter((h) => !h.is_couple_household));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolve the couple's saved venues for the quick-fill chips. Each call is
  // wrapped so a single failure degrades to "no chips" rather than throwing.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      picksApi.list().catch(() => ({ picks: [] as CouplePick[] })),
      coupleSupplierApi.list().catch(() => ({ suppliers: [] as CoupleSupplier[] })),
      supplierApi.list("venue").catch(() => ({ suppliers: [] as DirectorySupplier[] })),
    ]).then(([pR, csR, dR]) => {
      if (cancelled) return;
      // Public supplier id → display name, across directory + DIY entries.
      const nameById = new Map<string, string>();
      for (const s of dR.suppliers) nameById.set(s.id, s.name);
      for (const s of csR.suppliers) nameById.set(s.id, s.name);
      const out: { id: string; name: string }[] = [];
      const seen = new Set<string>();
      const add = (id: string, name: string) => {
        const trimmed = name.trim();
        const key = trimmed.toLowerCase();
        if (!trimmed || seen.has(key)) return;
        seen.add(key);
        out.push({ id, name: trimmed });
      };
      // The explicit "this is our venue" pick leads.
      const venuePick = pR.picks.find((p) => p.category === "venue");
      if (venuePick) {
        const name = nameById.get(venuePick.supplier_id);
        if (name) add(venuePick.supplier_id, name);
      }
      // Then any DIY venue entries the couple typed in themselves.
      for (const s of csR.suppliers) {
        if (s.category === "venue") add(s.id, s.name);
      }
      setSavedVenues(out);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const slug = couple?.slug ?? "";
  const publicUrl = slug ? `${window.location.origin}/w/${slug}` : null;
  const rsvpUrl = typeof window !== "undefined" && slug ? `${window.location.origin}/rsvp` : "";

  // Eye-preview button: the bare /w/:slug page is only reachable once the
  // couple has a slug AND is_public (private == not-found by design), so we
  // only open the live tab when both hold and explain the gap via tooltip.
  const previewState: "ready" | "no_slug" | "not_published" = !slug
    ? "no_slug"
    : !isPublic
      ? "not_published"
      : "ready";
  const previewHint =
    previewState === "no_slug"
      ? t("guest_page_editor.preview_live_hint_no_slug")
      : previewState === "not_published"
        ? t("guest_page_editor.preview_live_hint_not_published")
        : t("guest_page_editor.preview_live_hint_ready");
  function onOpenLivePreview() {
    if (previewState !== "ready" || !publicUrl) return;
    window.open(publicUrl, "_blank", "noopener,noreferrer");
  }

  const venueTrimmed = venueName.trim();
  const coverTrimmed = coverImageUrl.trim();
  // Don't trim the markdown blocks — leading whitespace can be meaningful
  // in markdown (lists, code fences). The backend treats an empty string
  // as "clear the column" so the dirty check just compares to current.
  const venueChanged = venueTrimmed !== (couple?.venue_name ?? "");
  const venueCityTrimmed = venueCity.trim();
  const venueCityChanged = venueCityTrimmed !== (couple?.venue_city ?? "");
  const weddingDateChanged = weddingDate !== (couple?.wedding_date ?? "");
  const coverChanged = coverTrimmed !== (couple?.cover_image_url ?? "");
  const introChanged = guestPageIntro !== (couple?.guest_page_intro ?? "");
  // The labelled rows + free-form rest, composed back into the persisted text.
  const usefulInfoText = serializeUsefulInfo(usefulFields, usefulOther, t);
  const usefulInfoChanged = usefulInfoText !== (couple?.useful_info ?? "");
  const postRsvpChanged = postRsvpContent !== (couple?.post_rsvp_content ?? "");
  const publishChanged = isPublic !== Boolean(couple?.is_public);
  const dirty =
    venueChanged ||
    venueCityChanged ||
    weddingDateChanged ||
    coverChanged ||
    publishChanged ||
    introChanged ||
    usefulInfoChanged ||
    postRsvpChanged;

  // Persist the current form state. No manual Save button — edits auto-save
  // (debounced) via the effect below, and the venue input's Enter also calls
  // this through onSubmit. Quiet on success (the inline status line reflects
  // it); only failures surface, inline.
  async function save() {
    if (!couple || !dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const body: Parameters<typeof coupleApi.update>[0] = {};
      if (publishChanged) body.is_public = isPublic;
      if (venueChanged) body.venue_name = venueTrimmed === "" ? null : venueTrimmed;
      if (venueCityChanged) body.venue_city = venueCityTrimmed === "" ? null : venueCityTrimmed;
      if (weddingDateChanged) body.wedding_date = weddingDate === "" ? null : weddingDate;
      if (coverChanged) body.cover_image_url = coverTrimmed === "" ? null : coverTrimmed;
      if (introChanged) body.guest_page_intro = guestPageIntro === "" ? null : guestPageIntro;
      if (usefulInfoChanged) body.useful_info = usefulInfoText === "" ? null : usefulInfoText;
      if (postRsvpChanged) body.post_rsvp_content = postRsvpContent === "" ? null : postRsvpContent;
      const r = await coupleApi.update(body);
      setCouple(r.couple);
      setIsPublic(r.couple.is_public);
      setVenueName(r.couple.venue_name ?? "");
      setVenueCity(r.couple.venue_city ?? "");
      setWeddingDate(r.couple.wedding_date ?? "");
      setCoverImageUrl(r.couple.cover_image_url ?? "");
      setGuestPageIntro(r.couple.guest_page_intro ?? "");
      {
        const parsed = parseUsefulInfo(r.couple.useful_info ?? "");
        setUsefulFields(parsed.fields);
        setUsefulOther(parsed.other);
      }
      setPostRsvpContent(r.couple.post_rsvp_content ?? "");
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : t("wedding_site_editor.save_error_generic");
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void save();
  }

  // Debounced auto-save: ~900ms after the last edit, persist. Keyed on the
  // field values so each keystroke resets the timer; skipped while a save is
  // already in flight or nothing changed. The save closure is fresh on every
  // re-run, so the timeout always commits the latest values.
  useEffect(() => {
    if (!couple || !dirty || saving) return;
    const id = setTimeout(() => void save(), 900);
    return () => clearTimeout(id);
  }, [
    couple,
    dirty,
    saving,
    venueName,
    venueCity,
    coverImageUrl,
    guestPageIntro,
    usefulInfoText,
    postRsvpContent,
    isPublic,
  ]);

  async function copyText(text: string, successKey: "share_copied" | "url_copied") {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(
        successKey === "share_copied"
          ? t("guest_preview.share_copied")
          : t("wedding_site_editor.url_copied"),
      );
    } catch {
      toast.error(t("guest_preview.share_copy_failed"));
    }
  }

  /** Build the per-household personal share URL. Uses the Phase 2 nested
   *  route shape (/w/:slug/:code) so once Phase 2 lands the link goes
   *  straight to the public landing with the household preselected. If
   *  Phase 2 hasn't shipped yet the URL 404s on hit — acceptable, since
   *  the surfaces ship in the same PR sequence. */
  const buildHouseholdUrl = useCallback(
    (code: string) => (slug ? `${window.location.origin}/w/${slug}/${code}` : ""),
    [slug],
  );

  async function onCopyHouseholdLink(hh: Household) {
    const link = buildHouseholdUrl(hh.code);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t("guest_preview.share_copied"));
    } catch {
      toast.error(t("guest_preview.share_copy_failed"));
    }
  }

  function onShareHouseholdWhatsapp(hh: Household) {
    const link = buildHouseholdUrl(hh.code);
    if (!link) return;
    const message = t("guest_page_editor.whatsapp_message_template", {
      guest_name: hh.label,
      link,
    });
    // wa.me is the official WhatsApp deep-link host — opens the share-sheet
    // on mobile, the desktop client (or web) on a laptop. Open in a new tab
    // so the planner stays on the editor.
    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function onRotateHouseholdCode(hh: Household) {
    const ok = await confirm({
      title: t("guest_page_editor.share_per_household_rotate_confirm_title"),
      body: t("guest_page_editor.share_per_household_rotate_confirm_body"),
      confirmLabel: t("guest_page_editor.share_per_household_rotate_confirm_action"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    setRotatingId(hh.id);
    try {
      const r = await householdApi.rotateCode(hh.id);
      // Patch the local row in-place; the rest of the household payload is
      // unchanged so we don't need a full re-fetch.
      setHouseholds((prev) =>
        prev.map((row) => (row.id === hh.id ? { ...row, code: r.household.code } : row)),
      );
      toast.success(t("guest_page_editor.share_per_household_rotate_success"));
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : t("guest_page_editor.share_per_household_rotate_error");
      toast.error(msg);
    } finally {
      setRotatingId(null);
    }
  }

  async function onCopyAllHouseholdLinks() {
    if (households.length === 0 || !slug) return;
    // Tab-separated so a paste into Sheets / Excel / Numbers lights up the
    // two columns cleanly. Power-user escape hatch — most couples reach
    // for the per-row Copy / WhatsApp buttons above.
    const lines = households.map((hh) => `${hh.label}\t${buildHouseholdUrl(hh.code)}`);
    const blob = lines.join("\n");
    try {
      await navigator.clipboard.writeText(blob);
      toast.success(t("guest_page_editor.share_per_household_copy_all_success"));
    } catch {
      toast.error(t("guest_preview.share_copy_failed"));
    }
  }

  /** Pre-validate on the client so the user gets a HU/EN-localised error
   *  instead of the raw server response. Server enforces the same limits as
   *  the source of truth — these are mirrored constants for fast feedback. */
  const COVER_MAX_BYTES = 4 * 1024 * 1024;
  const COVER_MIME_OK = new Set(["image/jpeg", "image/png", "image/webp"]);

  // Shared upload path for both the file picker and the drag-and-drop zone.
  async function uploadCoverFile(file: File) {
    if (!COVER_MIME_OK.has(file.type)) {
      toast.error(t("wedding_site_editor.cover_upload_error_type"));
      return;
    }
    if (file.size > COVER_MAX_BYTES) {
      toast.error(t("wedding_site_editor.cover_upload_error_too_large"));
      return;
    }

    setCoverUploading(true);
    try {
      const r = await coupleApi.uploadCover(file);
      setCouple(r.couple);
      setCoverImageUrl(r.couple.cover_image_url ?? "");
      toast.success(t("wedding_site_editor.cover_upload_success"));
    } catch (err) {
      if (err instanceof ApiError) {
        // The upload endpoint stashes the granular `code` ("file_too_large",
        // "unsupported_type", "bad_multipart", …) into ApiError.detail; the
        // top-level err.code is the coarse "client_error" bucket from the
        // multipart fetch wrapper in endpoints.ts.
        const code = (err.detail as { code?: string } | null)?.code;
        if (code === "file_too_large") {
          toast.error(t("wedding_site_editor.cover_upload_error_too_large"));
        } else if (code === "unsupported_type") {
          toast.error(t("wedding_site_editor.cover_upload_error_type"));
        } else {
          toast.error(err.message || t("wedding_site_editor.cover_upload_error_generic"));
        }
      } else {
        toast.error(t("wedding_site_editor.cover_upload_error_generic"));
      }
    } finally {
      setCoverUploading(false);
    }
  }

  async function onCoverFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input value so re-picking the SAME file (e.g. after the user
    // edits it and re-tries) still fires onChange. Without this, identical
    // filenames silently no-op.
    e.target.value = "";
    if (!file) return;
    await uploadCoverFile(file);
  }

  function onCoverDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault(); // required so the browser permits the drop
    if (!coverUploading && !coverDragOver) setCoverDragOver(true);
  }

  function onCoverDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setCoverDragOver(false);
  }

  async function onCoverDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setCoverDragOver(false);
    if (coverUploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) await uploadCoverFile(file);
  }

  // Synthesised preview in the exact shape the public /w/:slug endpoint returns,
  // so the editor preview renders through the SAME <WeddingSiteView> as the live
  // page — what the couple sees here IS what guests get. Editor-owned fields
  // read from live form state (venue/cover/intro/useful-info/post-RSVP) so a
  // ghost fills in the instant the couple types; the rest comes from the loaded
  // couple/events. Empty strings normalise to null so the component's "is this
  // set?" checks and ghost placeholders behave exactly like the live page.
  const previewView: PublicWeddingWebsiteView | null = couple
    ? {
        couple_slug: couple.slug ?? "",
        couple_display_name: couple.display_name,
        bride_name: null,
        groom_name: null,
        wedding_date: weddingDate === "" ? null : weddingDate,
        ceremony_kind: couple.ceremony_kind,
        venue_name: venueName.trim() === "" ? null : venueName.trim(),
        venue_city: venueCity.trim() === "" ? null : venueCity.trim(),
        cover_image_url: coverImageUrl.trim() === "" ? null : coverImageUrl.trim(),
        cover_position_x: coverPositionX,
        cover_position_y: coverPositionY,
        guest_page_intro: guestPageIntro.trim() === "" ? null : guestPageIntro,
        useful_info: usefulInfoText.trim() === "" ? null : usefulInfoText,
        location_lat: couple.location_lat,
        location_lng: couple.location_lng,
        location_radius_km: couple.location_radius_km,
        post_rsvp_content: postRsvpContent.trim() === "" ? null : postRsvpContent,
        schedule: events.map(
          (ev): PublicWeddingScheduleEntry => ({
            id: ev.id,
            label: ev.label,
            starts_at_minutes: ev.starts_at_minutes,
            duration_minutes: ev.duration_minutes,
            location: ev.location,
            notes: ev.notes,
            is_key_moment: ev.is_key_moment,
          }),
        ),
        wishlist: null,
        design: toPublicDesign(couple.design),
        fetched_at: Date.now(),
      }
    : null;

  // Reveal an editor field that may live inside a collapsed <details> section:
  // open the section FIRST, then scroll it into view. The public-content fields
  // (venue, cover, intro, useful-info) sit inside a collapsed disclosure, so
  // without the open step a click on a preview ghost scrolls to (and focuses)
  // an element that's still display:none and nothing visible happens.
  function revealField(id: string): HTMLElement | null {
    const el = document.getElementById(id);
    if (!(el instanceof HTMLElement)) return null;
    el.closest("details")?.setAttribute("open", "");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    return el;
  }

  // Venue card in the preview is a shortcut to its editor field below — reveal
  // it and focus the input so the couple lands right on it.
  function focusVenueField() {
    const el = revealField("guest-page-venue");
    if (el) window.setTimeout(() => el.focus(), 350);
  }

  // Köszöntő ghost → reveal the intro textarea (the type-in) and focus it. The
  // 5 starter-welcome suggestions render right below it while it's empty, so a
  // click lands the couple on both the field and the pick-one shortcuts.
  function focusIntroField() {
    const el = revealField("guest-page-intro");
    if (el) window.setTimeout(() => el.focus(), 350);
  }

  function focusPostRsvpField() {
    const el = revealField("guest-page-post-rsvp");
    if (el) window.setTimeout(() => el.focus(), 350);
  }

  // Double-verify before flipping publish on/off — it controls whether the
  // /w/… link is reachable by anyone, so it shouldn't toggle on a stray click.
  async function onTogglePublish() {
    const turningOn = !isPublic;
    const ok = await confirm({
      title: turningOn
        ? t("wedding_site_editor.publish_confirm_on_title")
        : t("wedding_site_editor.publish_confirm_off_title"),
      body: turningOn
        ? t("wedding_site_editor.publish_confirm_on_body")
        : t("wedding_site_editor.publish_confirm_off_body"),
      confirmLabel: turningOn
        ? t("wedding_site_editor.publish_confirm_on_cta")
        : t("wedding_site_editor.publish_confirm_off_cta"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    setIsPublic(turningOn);
  }

  return (
    <>
      <header className="mb-6 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="font-grotesk font-semibold tracking-tight">
            {t("guest_page_editor.title")}
          </h1>
          <InfoHint text={t("guest_page_editor.subtitle")} />
        </div>
        <div className="flex items-center gap-2">
          <Link to="/app/design" className="btn-outline btn-sm">
            <Palette size={14} aria-hidden />
            {t("nav.design")}
          </Link>
          <button
            type="button"
            className="btn-outline btn-sm"
            onClick={onOpenLivePreview}
            disabled={previewState !== "ready"}
            title={previewHint}
            aria-label={t("guest_page_editor.preview_live_aria")}
          >
            <Eye size={14} aria-hidden />
            {t("guest_page_editor.preview_live_label")}
          </button>
        </div>
      </header>

      {/* ── Guest-view preview (on top) ──────────────────────────────────
       *  The read-only "this is what your guest sees" view sits above the
       *  editor so the couple sees the result first. The divider labels the
       *  guest view directly below it; the editor (its own <details> summary
       *  is the boundary) follows underneath. */}
      <div
        className="mb-6 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-500 dark:text-umber-200"
        role="separator"
        aria-label={t("guest_page_editor.preview_divider_label")}
      >
        <span className="h-px flex-1 bg-paper-300 dark:bg-umber-700" aria-hidden />
        <span>{t("guest_page_editor.preview_divider_label")}</span>
        <span className="h-px flex-1 bg-paper-300 dark:bg-umber-700" aria-hidden />
      </div>

      <section className="mb-8">
        <p className="mb-3 text-sm text-ink-600 dark:text-umber-200">
          {t("guest_page_editor.preview_subtitle")}
        </p>
        {loading ? (
          <p className="text-sm text-ink-500 dark:text-umber-300">{t("common.loading")}</p>
        ) : previewView ? (
          // Full-bleed editorial preview inside a framed "device" so the couple
          // sees the real guest-site structure (alternating bands), not a card.
          <div className="overflow-hidden rounded-2xl border border-paper-200 dark:border-umber-700">
            <WeddingSiteView
              view={previewView}
              household={null}
              tier="public"
              locale={locale}
              isPreview
              edit={{
                onEditCover: () => setEditPanel("cover"),
                onEditDate: () => setEditPanel("date"),
                onEditSchedule: () => setEditPanel("schedule"),
                onEditVenue: focusVenueField,
                onEditIntro: focusIntroField,
                onEditUsefulInfo: () => setEditPanel("useful"),
                onEditPostRsvp: focusPostRsvpField,
              }}
              // Direct in-place editing of the prose fields. The setters feed
              // the same form state the sidebar inputs use, so the existing
              // debounced autosave persists an inline edit just like a typed one.
              inlineEdit={{
                intro: setGuestPageIntro,
                venue: (name, city) => {
                  setVenueName(name);
                  setVenueCity(city);
                },
                postRsvp: setPostRsvpContent,
              }}
            />
          </div>
        ) : (
          <p className="text-sm text-ink-500 dark:text-umber-300">{t("guest_preview.empty")}</p>
        )}
      </section>

      {/* ── Divider into the editor ──────────────────────────────────────
       *  Marks where the read-only guest view ends and the editing surface
       *  below begins. */}
      <div
        className="mb-6 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-500 dark:text-umber-200"
        role="separator"
        aria-label={t("guest_page_editor.editor_divider_label")}
      >
        <span className="h-px flex-1 bg-paper-300 dark:bg-umber-700" aria-hidden />
        <span>{t("guest_page_editor.editor_divider_label")}</span>
        <span className="h-px flex-1 bg-paper-300 dark:bg-umber-700" aria-hidden />
      </div>

      {/* ── Editor block (collapsible) ───────────────────────────────────
       *  Everything from the share artefact through the save button lives
       *  inside one <details>, so the couple can fold the whole editor
       *  shut and just compare the live preview below to what guests see.
       *  Open by default — the editor is the primary surface on this page. */}
      <details open className="group">
        {/* Inline-block summary so the click target is the chevron + label,
         *  not the full row width. Reduces accidental collapse from a stray
         *  click between sections. Chevron is a lucide icon for consistent
         *  rendering across OSes (no Unicode font-stack lottery). */}
        <summary className="list-none [&::-webkit-details-marker]:hidden">
          <span className="inline-flex cursor-pointer select-none items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium text-ink-700 transition hover:text-ink-900 hover:bg-paper-100 dark:text-umber-200 dark:hover:text-paper-50 dark:hover:bg-umber-800">
            <ChevronRight
              size={14}
              aria-hidden
              className="transition-transform group-open:rotate-90"
            />
            {t("guest_page_editor.editor_collapse_summary")}
          </span>
        </summary>
        <div className="mt-3">
          {/* ── Share ────────────────────────────────────────────────────────
           *  Two pieces side-by-side: the public /w/:slug URL (one share artefact
           *  for save-the-dates / Instagram bio) and the slug + /rsvp pair the
           *  couple uses to brief individual guests on how to RSVP. */}
          <section className="card !border-ink-900 dark:!border-paper-100/40">
            <h2 className="flex items-center gap-2 font-grotesk text-lg font-semibold tracking-tight text-ink-900 dark:text-paper-50">
              <Globe size={18} aria-hidden /> {t("guest_page_editor.section_share_title")}
            </h2>
            <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
              {t("guest_page_editor.section_share_body")}
            </p>

            {publicUrl ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => copyText(publicUrl, "url_copied")}
                  className="flex-1 min-w-0 rounded-xl border border-ink-900 bg-white px-3 py-2 text-left font-mono text-sm tabular-nums text-ink-900 transition hover:border-ink-700 dark:border-paper-100/40 dark:bg-umber-800 dark:text-paper-50 dark:hover:border-paper-100/60"
                  aria-label={t("wedding_site_editor.url_copied")}
                >
                  <span className="block truncate">{publicUrl}</span>
                </button>
                <button
                  type="button"
                  className="btn-outline btn-sm"
                  onClick={() => copyText(publicUrl, "url_copied")}
                >
                  <Clipboard size={14} aria-hidden />
                  {t("wedding_site_editor.url_copied")}
                </button>
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-outline btn-sm inline-flex"
                >
                  <ExternalLink size={14} aria-hidden />
                  {t("wedding_site_editor.url_open")}
                </a>
              </div>
            ) : (
              <p className="mt-3 rounded-xl border border-blush-300 bg-white px-3 py-2 text-sm text-ink-700 dark:border-blush-400/40 dark:bg-umber-800 dark:text-paper-100">
                {t("wedding_site_editor.url_no_slug")}
              </p>
            )}

            {slug && (
              <div className="mt-3 grid gap-x-4 gap-y-2 border-t border-paper-300 pt-3 sm:grid-cols-2 dark:border-umber-700">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] uppercase tracking-wide text-ink-400 dark:text-umber-300">
                    {t("guest_preview.share_slug_label")}
                  </span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-md border border-paper-300 px-2 py-0.5 font-mono text-sm uppercase tracking-[0.2em] text-ink-800 hover:border-paper-400 dark:border-umber-700 dark:text-paper-100 dark:hover:border-umber-600"
                    onClick={() => copyText(slug, "share_copied")}
                    aria-label={t("guest_preview.share_copy_slug_aria")}
                  >
                    {slug}
                    <Copy size={14} aria-hidden />
                  </button>
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] uppercase tracking-wide text-ink-400 dark:text-umber-300 shrink-0">
                    {t("guest_preview.share_link_label")}
                  </span>
                  <button
                    type="button"
                    className="inline-flex min-w-0 items-center gap-2 rounded-md border border-paper-300 px-2 py-0.5 text-sm text-ink-800 hover:border-paper-400 dark:border-umber-700 dark:text-paper-100 dark:hover:border-umber-600"
                    onClick={() => copyText(rsvpUrl, "share_copied")}
                    aria-label={t("guest_preview.share_copy_link_aria")}
                  >
                    <span className="truncate">{rsvpUrl}</span>
                    <Copy size={14} aria-hidden className="shrink-0" />
                  </button>
                </div>
              </div>
            )}

            {/* ── Per-household share (Phase 3 of the guest-page merger) ─────
             *  Subordinate to the main share block — hidden in a <details>
             *  so couples that just want the single public URL don't have to
             *  scroll past a list. Once expanded, each household gets a row
             *  with a personal /w/:slug/:code link, copy + WhatsApp buttons,
             *  and a rotate-code action. */}
            {slug && households.length > 0 && (
              <details className="mt-3 rounded-xl border border-paper-300 bg-paper-50 px-4 py-2 dark:border-umber-700 dark:bg-umber-900/60">
                <summary className="cursor-pointer text-sm font-medium text-ink-800 dark:text-paper-100">
                  {t("guest_page_editor.share_per_household_summary")}
                </summary>
                <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
                  <p className="min-w-[16rem] flex-1 text-xs text-ink-600 dark:text-umber-200">
                    {t("guest_page_editor.share_per_household_subtitle")}
                  </p>
                  <button
                    type="button"
                    className="btn-outline btn-sm shrink-0"
                    onClick={onCopyAllHouseholdLinks}
                    aria-label={t("guest_page_editor.share_per_household_copy_all_aria")}
                  >
                    <Copy size={14} aria-hidden />
                    {t("guest_page_editor.share_per_household_copy_all")}
                  </button>
                </div>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {households.map((hh) => {
                    const memberCount = hh.member_ids.length;
                    return (
                      <li
                        key={hh.id}
                        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-paper-300 bg-white px-3 py-2 dark:border-umber-700 dark:bg-umber-800"
                      >
                        <div className="flex min-w-0 flex-1 items-baseline gap-2">
                          <span className="truncate text-sm font-medium text-ink-900 dark:text-paper-50">
                            {hh.label}
                          </span>
                          <span className="shrink-0 text-xs text-ink-500 dark:text-umber-300">
                            {t("guest_page_editor.share_per_household_member_count", {
                              count: memberCount,
                            })}
                          </span>
                          <code className="hidden truncate font-mono text-xs uppercase tracking-[0.15em] text-ink-600 sm:inline dark:text-umber-200">
                            {hh.code}
                          </code>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            className="btn-outline btn-sm"
                            onClick={() => onCopyHouseholdLink(hh)}
                            title={t("guest_page_editor.share_per_household_copy_link")}
                            aria-label={t("guest_page_editor.share_per_household_copy_link_aria", {
                              label: hh.label,
                            })}
                          >
                            <Copy size={14} aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="btn-outline btn-sm"
                            onClick={() => onShareHouseholdWhatsapp(hh)}
                            aria-label={t("guest_page_editor.share_per_household_whatsapp_aria", {
                              label: hh.label,
                            })}
                          >
                            <MessageCircle size={14} aria-hidden />
                            {t("guest_page_editor.share_per_household_whatsapp")}
                          </button>
                          <button
                            type="button"
                            className="btn-outline btn-sm"
                            onClick={() => onRotateHouseholdCode(hh)}
                            disabled={rotatingId === hh.id}
                            aria-label={t("guest_page_editor.share_per_household_rotate_aria", {
                              label: hh.label,
                            })}
                          >
                            <RefreshCcw size={14} aria-hidden />
                            {t("guest_page_editor.share_per_household_rotate")}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}

            {slug && loading && households.length === 0 && (
              <p className="mt-3 text-sm text-ink-400 dark:text-umber-300">{t("common.loading")}</p>
            )}

            {slug && !loading && households.length === 0 && (
              <p className="mt-3 text-sm text-ink-500 dark:text-umber-300">
                {t("guest_page_editor.share_per_household_empty")}
              </p>
            )}
          </section>

          <form onSubmit={onSubmit}>
            {/* ── Publish toggle ──────────────────────────────────────────── */}
            <section
              className={`card mt-6 border-2 ${
                isPublic
                  ? "border-sage-400 dark:border-sage-500"
                  : "border-paper-300 dark:border-umber-700"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0 flex-1 lg:flex lg:items-baseline lg:gap-2">
                  <h2 className="shrink-0 font-grotesk text-lg font-semibold tracking-tight text-ink-900 dark:text-paper-50">
                    {t("wedding_site_editor.publish_title")}
                  </h2>
                  <p className="mt-1 text-sm text-ink-600 lg:mt-0 dark:text-umber-200">
                    {isPublic
                      ? t("wedding_site_editor.publish_body_on")
                      : t("wedding_site_editor.publish_body_off")}
                  </p>
                </div>
                <label className="inline-flex shrink-0 cursor-pointer items-center gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isPublic}
                    onClick={onTogglePublish}
                    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
                      isPublic ? "bg-sage-500 dark:bg-sage-400" : "bg-paper-300 dark:bg-umber-700"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                        isPublic ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                  <span className="text-sm font-medium text-ink-800 dark:text-paper-100">
                    {isPublic
                      ? t("wedding_site_editor.publish_label_on")
                      : t("wedding_site_editor.publish_label_off")}
                  </span>
                </label>
              </div>
            </section>

            {/* ── Public content (anyone with the link) ──────────────────── */}
            <details
              open={publicOpen}
              onToggle={(e) => setPublicOpen((e.currentTarget as HTMLDetailsElement).open)}
              className="card mt-6 group/pub"
            >
              <summary className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <ChevronRight
                    size={16}
                    aria-hidden
                    className="shrink-0 text-ink-400 transition-transform group-open/pub:rotate-90 dark:text-umber-300"
                  />
                  <h2 className="font-grotesk text-lg font-semibold tracking-tight text-ink-900 dark:text-paper-50">
                    {t("guest_page_editor.section_public_title")}
                  </h2>
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-500 dark:text-umber-300">
                    <Unlock size={12} aria-hidden /> {t("guest_page_editor.section_public_eyebrow")}
                  </span>
                </div>
              </summary>
              <div className="mt-4">
                <label htmlFor="guest-page-venue" className="field-label">
                  {t("wedding_site_editor.venue_label")}
                </label>
                <VenueNameField
                  value={venueName}
                  onChange={setVenueName}
                  onPickCity={setVenueCity}
                  savedVenues={savedVenues}
                  country={couple?.country ?? "HU"}
                />
              </div>
              <div className="mt-3">
                <label htmlFor="guest-page-venue-city" className="field-label">
                  {t("wedding_site_editor.venue_city_label")}
                </label>
                <input
                  id="guest-page-venue-city"
                  className="input"
                  type="text"
                  value={venueCity}
                  onChange={(e) => setVenueCity(e.target.value)}
                  placeholder={t("wedding_site_editor.venue_city_placeholder")}
                />
              </div>
              <div className="mt-3">
                <label htmlFor="guest-page-intro" className="field-label">
                  {t("guest_page_editor.intro_label")}
                </label>
                {/* The welcome note is optional, so it never gets the red
                    required outline — an empty one just shows the starter-note
                    suggestions below instead of reading as an error. */}
                <textarea
                  id="guest-page-intro"
                  className="input"
                  rows={4}
                  value={guestPageIntro}
                  onChange={(e) => setGuestPageIntro(e.target.value)}
                  placeholder={t("guest_page_editor.intro_placeholder")}
                  maxLength={4000}
                />
                {guestPageIntro.trim() === "" && (
                  <div className="mt-2 flex flex-col gap-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-500 dark:text-umber-200">
                      {t("guest_page_editor.intro_suggestions_heading")}
                    </span>
                    <div className="flex flex-col gap-1.5">
                      {([1, 3, 4] as const).map((n, i) => {
                        const text = t(`guest_page_editor.intro_suggestion_${n}`);
                        return (
                          <button
                            key={n}
                            type="button"
                            onClick={() => applyIntroSuggestion(text)}
                            className="flex items-start gap-2.5 rounded-xl border border-paper-300 bg-paper-50 p-3 text-left transition hover:border-ink-400 hover:bg-paper-100 dark:border-umber-700 dark:bg-umber-900 dark:hover:border-umber-500 dark:hover:bg-umber-800"
                          >
                            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-paper-200 text-[11px] font-semibold tabular-nums text-ink-600 dark:bg-umber-700 dark:text-umber-200">
                              {i + 1}
                            </span>
                            <span className="text-sm leading-relaxed text-ink-700 dark:text-paper-100">
                              {text}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </details>

            {/* ── Post-RSVP unlocked content (collapsible) ──────────────── */}
            <details className="card mt-6 group/rsvp">
              <summary className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <ChevronRight
                    size={16}
                    aria-hidden
                    className="shrink-0 text-ink-400 transition-transform group-open/rsvp:rotate-90 dark:text-umber-300"
                  />
                  <h2 className="font-grotesk text-lg font-semibold tracking-tight text-ink-900 dark:text-paper-50">
                    {t("guest_page_editor.section_unlocked_title")}
                  </h2>
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-blush-700 dark:text-blush-300">
                    <Lock size={12} aria-hidden /> {t("guest_page_editor.section_unlocked_eyebrow")}
                  </span>
                </div>
              </summary>
              <ul className="mt-4 flex flex-wrap items-center gap-2">
                <li className="inline-flex items-center">
                  <Link to="/app/schedule" className="btn-outline btn-sm">
                    {t("guest_page_editor.section_unlocked_link_schedule")}
                  </Link>
                </li>
                <li className="inline-flex items-center">
                  <Link to="/app/settings/workspace" className="btn-outline btn-sm">
                    {t("guest_page_editor.section_unlocked_link_profile")}
                  </Link>
                </li>
              </ul>
              <div className="mt-3">
                <label htmlFor="guest-page-post-rsvp" className="field-label">
                  {t("guest_page_editor.post_rsvp_label")}
                </label>
                <div className="mb-2 flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-500 dark:text-umber-200">
                    {t("guest_page_editor.post_rsvp_suggestions_heading")}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        "parking",
                        "dress_code",
                        "gifts",
                        "accommodation",
                        "kids",
                        "getting_there",
                      ] as const
                    ).map((slug) => {
                      const label = t(`guest_page_editor.post_rsvp_suggestion_${slug}`);
                      return (
                        <button
                          key={slug}
                          type="button"
                          className="inline-flex items-center gap-1 rounded-full border border-paper-300 bg-paper-50 px-2.5 py-1 text-xs font-medium text-ink-700 transition hover:border-ink-400 hover:bg-paper-100 dark:border-umber-700 dark:bg-umber-900 dark:text-paper-100 dark:hover:border-umber-500 dark:hover:bg-umber-800"
                          onClick={() => insertPostRsvpSection(label)}
                        >
                          <Plus size={11} aria-hidden />
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <textarea
                  ref={postRsvpTextareaRef}
                  id="guest-page-post-rsvp"
                  className="input"
                  rows={6}
                  value={postRsvpContent}
                  onChange={(e) => setPostRsvpContent(e.target.value)}
                  placeholder={t("guest_page_editor.post_rsvp_placeholder")}
                  maxLength={8000}
                />
              </div>
            </details>

            {error && (
              <p className="field-error mt-4" role="alert">
                {error}
              </p>
            )}

            <div className="mt-6">
              <p
                className="flex items-center gap-1.5 text-sm text-ink-500 dark:text-umber-300"
                aria-live="polite"
              >
                {saving || dirty
                  ? t("wedding_site_editor.save_saving")
                  : t("wedding_site_editor.save_success")}
              </p>
            </div>
          </form>
        </div>
      </details>

      {/* Cover editor — opened by clicking the hero / cover ghost in the
          preview. A modal sheet (bottom sheet on mobile) so the couple never
          scrolls to a form. Hosts upload + drag-drop + remove + the focal-point
          positioner; the raw URL input was dropped as a pre-upload relic. */}
      <Dialog
        open={editPanel === "cover"}
        role="dialog"
        closeOnBackdrop
        title={t("wedding_site_editor.cover_image_label")}
        onClose={() => setEditPanel(null)}
        footer={
          <button type="button" className="btn-primary" onClick={() => setEditPanel(null)}>
            {t("common.done")}
          </button>
        }
      >
        <div className="flex flex-col gap-3">
          <div
            onDragOver={onCoverDragOver}
            onDragLeave={onCoverDragLeave}
            onDrop={onCoverDrop}
            className={`flex flex-col gap-3 rounded-xl border border-dashed p-4 transition ${
              coverDragOver
                ? "border-sage-400 bg-sage-50 dark:border-sage-500 dark:bg-umber-800"
                : "border-paper-300 bg-paper-50 dark:border-umber-700 dark:bg-umber-800/40"
            }`}
          >
            <div className="flex items-center gap-3">
              {coverImageUrl ? (
                <img
                  src={coverImageUrl}
                  alt={t("wedding_site_editor.cover_upload_preview_alt")}
                  className="h-14 w-20 shrink-0 rounded-md border border-paper-300 object-cover dark:border-umber-700"
                />
              ) : (
                <div
                  className="flex h-14 w-20 shrink-0 items-center justify-center rounded-md border border-dashed border-paper-300 text-ink-400 dark:border-umber-700 dark:text-umber-300"
                  aria-hidden
                >
                  <Upload size={18} />
                </div>
              )}
              <input
                ref={coverFileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={onCoverFileChange}
              />
              <button
                type="button"
                className="btn-outline btn-sm"
                disabled={coverUploading}
                onClick={() => coverFileInputRef.current?.click()}
              >
                <Upload size={14} aria-hidden />
                {coverUploading
                  ? t("wedding_site_editor.cover_upload_uploading")
                  : coverImageUrl
                    ? t("wedding_site_editor.cover_upload_replace")
                    : t("wedding_site_editor.cover_upload_button")}
              </button>
              {coverImageUrl && !coverUploading && (
                <button
                  type="button"
                  onClick={() => setCoverImageUrl("")}
                  aria-label={t("wedding_site_editor.cover_image_remove")}
                  title={t("wedding_site_editor.cover_image_remove")}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-500 text-red-600 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 dark:border-red-400/60 dark:text-red-300 dark:hover:bg-red-400/15"
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              )}
            </div>
            <p className="text-xs text-ink-400 dark:text-umber-300">
              {coverDragOver
                ? t("wedding_site_editor.cover_drop_active")
                : t("wedding_site_editor.cover_drop_hint")}
            </p>
          </div>
          {coverTrimmed !== "" && (
            <CoverPositioner
              src={coverTrimmed}
              x={coverPositionX}
              y={coverPositionY}
              onChange={(nx, ny) => {
                setCoverPositionX(nx);
                setCoverPositionY(ny);
              }}
              onCommit={(nx, ny) => {
                void coupleApi
                  .update({ cover_position_x: nx, cover_position_y: ny })
                  .catch(() => undefined);
              }}
              hint={t("wedding_site_editor.cover_position_hint")}
            />
          )}
        </div>
      </Dialog>

      {/* Good-to-know editor — opened by clicking the useful-info band in the
          preview. The 4 labelled rows + free-form box, lifted from the bottom
          form; serialize/parse stays in the editor so the shared renderer never
          carries the USEFUL_INFO_FIELDS catalog. */}
      <Dialog
        open={editPanel === "useful"}
        role="dialog"
        closeOnBackdrop
        title={t("guest_page_editor.useful_info_label")}
        onClose={() => setEditPanel(null)}
        footer={
          <button type="button" className="btn-primary" onClick={() => setEditPanel(null)}>
            {t("common.done")}
          </button>
        }
      >
        <p className="mb-3 text-xs text-ink-500 dark:text-umber-300">
          {t("guest_page_editor.useful_info_hint")}
        </p>
        <div className="flex flex-col gap-2">
          {USEFUL_INFO_FIELDS.map((f) => (
            <div key={f.key} className="flex items-center gap-2">
              <label
                htmlFor={`guest-page-useful-${f.key}`}
                className="w-28 shrink-0 text-sm text-ink-600 dark:text-umber-200"
              >
                {t(f.labelKey)}
              </label>
              <input
                id={`guest-page-useful-${f.key}`}
                type="text"
                className="input flex-1"
                value={usefulFields[f.key]}
                onChange={(e) => setUsefulFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                maxLength={500}
              />
            </div>
          ))}
          <div className="mt-1">
            <label
              htmlFor="guest-page-useful-other"
              className="mb-1 block text-sm text-ink-600 dark:text-umber-200"
            >
              {t("guest_page_editor.useful_field_other_label")}
            </label>
            <textarea
              id="guest-page-useful-other"
              className="input"
              rows={3}
              value={usefulOther}
              onChange={(e) => setUsefulOther(e.target.value)}
              placeholder={t("guest_page_editor.useful_field_other_placeholder")}
              maxLength={4000}
            />
          </div>
        </div>
      </Dialog>

      {/* Date editor — clicking the hero date opens it here rather than jumping
          to the dashboard. Saving folds the scalar into an `exact` goal
          server-side, so the dashboard reflects it too. */}
      <Dialog
        open={editPanel === "date"}
        role="dialog"
        closeOnBackdrop
        title={t("guest_page_editor.date_panel_title")}
        onClose={() => setEditPanel(null)}
        footer={
          <button type="button" className="btn-primary" onClick={() => setEditPanel(null)}>
            {t("common.done")}
          </button>
        }
      >
        <div className="flex flex-col gap-2">
          <input
            type="date"
            className="input"
            value={weddingDate}
            onChange={(e) => setWeddingDate(e.target.value)}
            aria-label={t("guest_page_editor.date_panel_title")}
          />
          <p className="text-xs text-ink-500 dark:text-umber-300">
            {t("guest_page_editor.date_panel_hint")}
          </p>
        </div>
      </Dialog>

      {/* Schedule — clicking the schedule band shows the day's moments read-only
          plus an explicit link to the full editor (its CRUD is too rich to
          inline). No more surprise redirect. */}
      <Dialog
        open={editPanel === "schedule"}
        role="dialog"
        closeOnBackdrop
        title={t("guest_page_editor.schedule_panel_title")}
        onClose={() => setEditPanel(null)}
        footer={
          <Link to="/app/schedule" className="btn-primary">
            {t("guest_page_editor.schedule_panel_open_full")}
          </Link>
        }
      >
        {events.length === 0 ? (
          <p className="text-sm text-ink-500 dark:text-umber-300">
            {t("guest_page_editor.schedule_panel_empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {events.map((ev) => (
              <li key={ev.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-ink-700 dark:text-paper-100">{ev.label}</span>
                <span className="shrink-0 tabular-nums text-ink-500 dark:text-umber-300">
                  {`${Math.floor(ev.starts_at_minutes / 60)}:${String(
                    ev.starts_at_minutes % 60,
                  ).padStart(2, "0")}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </>
  );
}
