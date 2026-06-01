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
import type {
  GuestPortalView as GuestPortalViewType,
  GuestScheduleEntry,
} from "@shared/guest_portal";
import type { ScheduleEvent } from "@shared/schedule";
import {
  AlertCircle,
  ChevronRight,
  Clipboard,
  Copy,
  ExternalLink,
  Globe,
  Lock,
  MessageCircle,
  Plus,
  RefreshCcw,
  MapPin,
  Unlock,
  Upload,
} from "lucide-react";
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { GuestPortalView } from "../components/GuestPortalView";
import { useConfirm, useToast } from "../components/ui";
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

/** Inline "Missing" indicator next to a field label or jump-to button when
 *  the underlying value is empty. Pure visual — no click target. Rendered in
 *  the red danger palette (same tokens as the cost-planning delete state) so
 *  an unfinished field reads as an explicit "still required" flag rather than
 *  blending into the warm blush accents the rest of the editor uses. */
function TodoPill({ label }: { label: string }) {
  return (
    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-red-700 dark:bg-red-400/15 dark:text-red-300">
      <AlertCircle size={10} aria-hidden />
      {label}
    </span>
  );
}

/** Venue-name input with two assists:
 *  - a debounced Nominatim-backed autocomplete (same /api/places/search proxy
 *    the honeymoon picker uses) so typing "Sári" surfaces real venue names;
 *  - quick-fill chips for venues the couple already saved among their
 *    suppliers (a picked directory venue or a DIY "venue" entry).
 *  Unlike the honeymoon picker we commit the suggestion's `primary` (the place
 *  NAME), not its full address — the field is name-only by design; the precise
 *  address lives on the invitation / post-RSVP block. */
function VenueNameField({
  value,
  onChange,
  savedVenues,
}: {
  value: string;
  onChange: (v: string) => void;
  savedVenues: { id: string; name: string }[];
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
        const r = await placesApi.search(q);
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
  }, [value]);

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
        pick(sel.primary);
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
                  pick(s.primary);
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

export default function GuestPageEditorPage() {
  const { t, locale } = useT();
  useDocumentMeta("seo.guest_page_title", "seo.guest_page_description");
  const toast = useToast();
  const confirm = useConfirm();

  const [couple, setCouple] = useState<Couple | null>(null);
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [isPublic, setIsPublic] = useState(false);
  const [venueName, setVenueName] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [guestPageIntro, setGuestPageIntro] = useState("");
  const [postRsvpContent, setPostRsvpContent] = useState("");
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
  const coverFileInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    let cancelled = false;
    Promise.all([coupleApi.current(), scheduleApi.list(), householdApi.list()])
      .then(([cR, sR, hR]) => {
        if (cancelled) return;
        if (cR.couple) {
          setCouple(cR.couple);
          setIsPublic(cR.couple.is_public);
          setVenueName(cR.couple.venue_name ?? "");
          setCoverImageUrl(cR.couple.cover_image_url ?? "");
          setGuestPageIntro(cR.couple.guest_page_intro ?? "");
          setPostRsvpContent(cR.couple.post_rsvp_content ?? "");
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

  const venueTrimmed = venueName.trim();
  const coverTrimmed = coverImageUrl.trim();
  // Don't trim the markdown blocks — leading whitespace can be meaningful
  // in markdown (lists, code fences). The backend treats an empty string
  // as "clear the column" so the dirty check just compares to current.
  const venueChanged = venueTrimmed !== (couple?.venue_name ?? "");
  const coverChanged = coverTrimmed !== (couple?.cover_image_url ?? "");
  const introChanged = guestPageIntro !== (couple?.guest_page_intro ?? "");
  const postRsvpChanged = postRsvpContent !== (couple?.post_rsvp_content ?? "");
  const publishChanged = isPublic !== Boolean(couple?.is_public);
  const dirty = venueChanged || coverChanged || publishChanged || introChanged || postRsvpChanged;

  // Completeness flags — derived from the live form state for fields the
  // couple edits in this page, and from the loaded couple/events for the
  // ones that live on sibling pages (coords, schedule). We use these to
  // (1) flag empty fields inline next to their label and (2) build a
  // one-line summary above the editor that survives <details> being
  // collapsed. Venue name is included since the public landing falls back
  // to a generic title without one; the cover image, welcome text, and
  // post-RSVP block are optional but visually-impactful.
  const todoCover = coverTrimmed.length === 0;
  const todoIntro = guestPageIntro.trim().length === 0;
  const todoPostRsvp = postRsvpContent.trim().length === 0;
  const todoVenue = venueTrimmed.length === 0;
  const todoCoords = couple ? couple.location_lat === null || couple.location_lng === null : false;
  const todoSchedule = !loading && events.length === 0;
  const todoSummaryItems: string[] = [];
  if (todoVenue) todoSummaryItems.push(t("guest_page_editor.todo_item_venue"));
  if (todoCover) todoSummaryItems.push(t("guest_page_editor.todo_item_cover"));
  if (todoIntro) todoSummaryItems.push(t("guest_page_editor.todo_item_intro"));
  if (todoPostRsvp) todoSummaryItems.push(t("guest_page_editor.todo_item_post_rsvp"));
  if (todoSchedule) todoSummaryItems.push(t("guest_page_editor.todo_item_schedule"));
  if (todoCoords) todoSummaryItems.push(t("guest_page_editor.todo_item_coords"));
  const todoPillLabel = t("guest_page_editor.todo_pill");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!couple || !dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const body: Parameters<typeof coupleApi.update>[0] = {};
      if (publishChanged) body.is_public = isPublic;
      if (venueChanged) body.venue_name = venueTrimmed === "" ? null : venueTrimmed;
      if (coverChanged) body.cover_image_url = coverTrimmed === "" ? null : coverTrimmed;
      if (introChanged) body.guest_page_intro = guestPageIntro === "" ? null : guestPageIntro;
      if (postRsvpChanged) body.post_rsvp_content = postRsvpContent === "" ? null : postRsvpContent;
      const r = await coupleApi.update(body);
      setCouple(r.couple);
      setIsPublic(r.couple.is_public);
      setVenueName(r.couple.venue_name ?? "");
      setCoverImageUrl(r.couple.cover_image_url ?? "");
      setGuestPageIntro(r.couple.guest_page_intro ?? "");
      setPostRsvpContent(r.couple.post_rsvp_content ?? "");
      toast.success(t("wedding_site_editor.save_success"));
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : t("wedding_site_editor.save_error_generic");
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

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

  async function onCoverFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input value so re-picking the SAME file (e.g. after the user
    // edits it and re-tries) still fires onChange. Without this, identical
    // filenames silently no-op.
    e.target.value = "";
    if (!file) return;

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

  // Synthesised preview — same shape as the public /g/:slug/:code endpoint
  // returns, with empty household so the shared component's defensive
  // `members.length > 0` check renders the no-household branch.
  const preview: GuestPortalViewType | null = couple
    ? {
        couple_slug: couple.slug ?? "",
        couple_display_name: couple.display_name,
        wedding_date: couple.wedding_date,
        ceremony_kind: couple.ceremony_kind,
        location_lat: couple.location_lat,
        location_lng: couple.location_lng,
        location_radius_km: couple.location_radius_km,
        schedule: events.map(
          (ev): GuestScheduleEntry => ({
            id: ev.id,
            label: ev.label,
            starts_at_minutes: ev.starts_at_minutes,
            duration_minutes: ev.duration_minutes,
            location: ev.location,
            notes: ev.notes,
          }),
        ),
        household_code: "",
        household_label: "",
        members: [],
        fetched_at: Date.now(),
      }
    : null;

  return (
    <>
      <header className="mb-6">
        <h1>{t("guest_page_editor.title")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-600 dark:text-umber-200">
          {t("guest_page_editor.subtitle")}
        </p>
      </header>

      {/* ── Outstanding-items summary ────────────────────────────────────
       *  Sits OUTSIDE the collapsible editor so the planner still sees the
       *  list of unfilled fields when the editor is folded shut. Hidden
       *  entirely once everything's filled. Plain text — the inline pills
       *  next to each label are the actionable signal; this row is just
       *  a glance-able overview. */}
      {!loading && todoSummaryItems.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-blush-300 bg-blush-50 px-3 py-2 text-sm text-blush-800 dark:border-blush-400/40 dark:bg-blush-900/20 dark:text-blush-200">
          <AlertCircle size={16} aria-hidden className="mt-0.5 shrink-0" />
          <p>
            <span className="font-medium">{t("guest_page_editor.todo_summary_prefix")}</span>{" "}
            {todoSummaryItems.join(" · ")}
          </p>
        </div>
      )}

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
          <section className="card">
            <h2 className="text-lg flex items-center gap-2">
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
                  className="flex-1 min-w-0 rounded-xl border border-ink-200 bg-white px-3 py-2 text-left font-mono text-sm tabular-nums text-ink-900 transition hover:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-50 dark:hover:border-umber-600"
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
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg">{t("wedding_site_editor.publish_title")}</h2>
                  <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
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
                    onClick={() => setIsPublic((v) => !v)}
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
            <section className="card mt-6">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-lg">{t("guest_page_editor.section_public_title")}</h2>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-500 dark:text-umber-300">
                  <Unlock size={12} aria-hidden /> {t("guest_page_editor.section_public_eyebrow")}
                </span>
              </div>
              <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
                {t("guest_page_editor.section_public_hint")}
              </p>
              <div className="mt-3">
                <label htmlFor="guest-page-venue" className="field-label">
                  {t("wedding_site_editor.venue_label")}
                  {todoVenue && <TodoPill label={todoPillLabel} />}
                </label>
                <VenueNameField
                  value={venueName}
                  onChange={setVenueName}
                  savedVenues={savedVenues}
                />
                <p className="mt-1 text-xs text-ink-500 dark:text-umber-300">
                  {t("wedding_site_editor.venue_hint")}
                </p>
              </div>
              <div className="mt-3">
                <label htmlFor="guest-page-cover" className="field-label">
                  {t("wedding_site_editor.cover_image_label")}
                  {todoCover && <TodoPill label={todoPillLabel} />}
                </label>
                {/* Upload row — thumbnail of the current cover (if any) +
                 *  Tallózás button. Hidden <input type="file"> so we can style
                 *  the trigger as a regular outline button. Accept attribute
                 *  mirrors the server-side MIME allowlist. */}
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
                </div>
                <input
                  id="guest-page-cover"
                  type="text"
                  className="input mt-2"
                  value={coverImageUrl}
                  onChange={(e) => setCoverImageUrl(e.target.value)}
                  placeholder={t("wedding_site_editor.cover_image_placeholder")}
                  maxLength={2048}
                  inputMode="url"
                  autoComplete="off"
                />
                <p className="mt-1 text-xs text-ink-500 dark:text-umber-300">
                  {t("wedding_site_editor.cover_image_hint")}
                </p>
              </div>
              <div className="mt-3">
                <label htmlFor="guest-page-intro" className="field-label">
                  {t("guest_page_editor.intro_label")}
                  {todoIntro && <TodoPill label={todoPillLabel} />}
                </label>
                <textarea
                  id="guest-page-intro"
                  className="input"
                  rows={4}
                  value={guestPageIntro}
                  onChange={(e) => setGuestPageIntro(e.target.value)}
                  placeholder={t("guest_page_editor.intro_placeholder")}
                  maxLength={4000}
                />
                <p className="mt-1 text-xs text-ink-500 dark:text-umber-300">
                  {t("guest_page_editor.intro_hint")}
                </p>
              </div>
            </section>

            {/* ── Post-RSVP unlocked content ────────────────────────────── */}
            <section className="card mt-6">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-lg">{t("guest_page_editor.section_unlocked_title")}</h2>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-blush-700 dark:text-blush-300">
                  <Lock size={12} aria-hidden /> {t("guest_page_editor.section_unlocked_eyebrow")}
                </span>
              </div>
              <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
                {t("guest_page_editor.section_unlocked_hint")}
              </p>
              <ul className="mt-3 flex flex-wrap items-center gap-2">
                <li className="inline-flex items-center">
                  <Link to="/app/schedule" className="btn-outline btn-sm">
                    {t("guest_page_editor.section_unlocked_link_schedule")}
                  </Link>
                  {todoSchedule && <TodoPill label={todoPillLabel} />}
                </li>
                <li className="inline-flex items-center">
                  <Link to="/app/settings/workspace" className="btn-outline btn-sm">
                    {t("guest_page_editor.section_unlocked_link_profile")}
                  </Link>
                  {todoCoords && <TodoPill label={todoPillLabel} />}
                </li>
              </ul>
              <div className="mt-3">
                <label htmlFor="guest-page-post-rsvp" className="field-label">
                  {t("guest_page_editor.post_rsvp_label")}
                  {todoPostRsvp && <TodoPill label={todoPillLabel} />}
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
                <p className="mt-1 text-xs text-ink-500 dark:text-umber-300">
                  {t("guest_page_editor.post_rsvp_hint")}
                </p>
              </div>
            </section>

            {error && (
              <p className="field-error mt-4" role="alert">
                {error}
              </p>
            )}

            <div className="mt-6">
              <button type="submit" className="btn-primary" disabled={!dirty || saving}>
                {saving
                  ? t("wedding_site_editor.save_saving")
                  : t("wedding_site_editor.save_button")}
              </button>
            </div>
          </form>
        </div>
      </details>

      {/* ── Divider into guest-view preview ─────────────────────────────
       *  Visual break so it's obvious where the editor ends and the
       *  read-only "this is what your guest sees" view begins. The divider
       *  is the only boundary signal now — the preview heading below was
       *  redundant with this label and got removed in the polish pass. */}
      <div
        className="my-8 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-500 dark:text-umber-200"
        role="separator"
        aria-label={t("guest_page_editor.preview_divider_label")}
      >
        <span className="h-px flex-1 bg-paper-300 dark:bg-umber-700" aria-hidden />
        <span>{t("guest_page_editor.preview_divider_label")}</span>
        <span className="h-px flex-1 bg-paper-300 dark:bg-umber-700" aria-hidden />
      </div>

      {/* ── Live preview ────────────────────────────────────────────── */}
      <section>
        <p className="mb-3 text-sm text-ink-600 dark:text-umber-200">
          {t("guest_page_editor.preview_subtitle")}
        </p>
        {loading ? (
          <p className="text-sm text-ink-500 dark:text-umber-300">{t("common.loading")}</p>
        ) : preview ? (
          <GuestPortalView data={preview} locale={locale} />
        ) : (
          <p className="text-sm text-ink-500 dark:text-umber-300">{t("guest_preview.empty")}</p>
        )}
      </section>
    </>
  );
}
