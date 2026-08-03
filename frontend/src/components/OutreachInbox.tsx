// Supplier Outreach Inbox — couple-initiated cold mail to shortlisted
// vendors. It has TWO mounts and no page of its own: a section at the bottom of
// /app/vendors, so the "shop → message" flow stays on one screen, and the
// Megkeresések tab of /app/messages, where sent history sits beside the replies
// it produced. `variant` is the only difference between them. (It used to also
// be a standalone /app/outreach page; that URL now redirects to the tab.)
//
// v1 scope:
//   - campaigns list (newest first), counted by message_count
//   - campaign detail — messages list + status badges, plus
//     a banner explaining v1 replies arrive in the user's own email
//   - new-campaign modal: subject + body + supplier-id picker (free-text
//     id input for v1; v1.5 wires the "Add to outreach" button on the
//     /app/suppliers cards so the input pre-fills)
//
// Deferred to v1.5: in-app reply thread (needs the Resend inbound
// webhook + `reply.weddly.xyz` MX), Add-to-outreach picker from the
// suppliers page, supplier-name autocomplete in the modal.

import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Mail, MessageCircle, Send, Plus, Search, Sparkles, X } from "lucide-react";
import { InfoHint } from "./InfoHint";
import {
  type CreateOutreachCampaignInput,
  OUTREACH_BODY_MAX_LEN,
  OUTREACH_MESSAGES_PER_WEEK_CAP,
  OUTREACH_SUBJECT_MAX_LEN,
  OUTREACH_SUPPLIERS_PER_CAMPAIGN_CAP,
  type OutreachCampaign,
  type OutreachCampaignDetail,
} from "@shared/outreach";
import type { DirectorySupplier } from "@shared/suppliers";
import type { Couple } from "@shared/types";
import { Dialog } from "./ui/Dialog";
import { useConfirm } from "./ui/ConfirmDialogProvider";
import { useToast } from "./ui/ToastProvider";
import { ApiError } from "../lib/api";
import { guestCountBaseline } from "../lib/budget";
import { categoryIcon } from "../lib/category_icons";
import { coupleApi, outreachApi, supplierApi } from "../lib/endpoints";
import { formatDate, intlLocale } from "../lib/format";
import { useT } from "../lib/i18n";

/** Where the inbox is being rendered.
 *  - `section` — a band at the bottom of /app/vendors, under the directory it
 *    shares a page with, so it needs its own h2 and top margin to read as a
 *    separate thing.
 *  - `tab` — the Megkeresések tab of /app/messages. The page header and the tab
 *    label already name it twice; a third h2 would be noise, so only the
 *    one-line "what this is" survives. */
export type OutreachInboxVariant = "section" | "tab";

export function OutreachInbox({ variant = "section" }: { variant?: OutreachInboxVariant } = {}) {
  const { t, locale } = useT();
  const toast = useToast();

  const [campaigns, setCampaigns] = useState<OutreachCampaign[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<OutreachCampaignDetail | null>(null);
  const [composing, setComposing] = useState(false);
  const [loading, setLoading] = useState(true);

  const refreshList = useCallback(async () => {
    try {
      const data = await outreachApi.list();
      setCampaigns(data.campaigns);
      if (data.campaigns.length > 0 && selectedId == null) {
        setSelectedId(data.campaigns[0]!.id);
      }
    } catch {
      toast.error(t("outreach.error_load"));
    } finally {
      setLoading(false);
    }
  }, [selectedId, toast, t]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (selectedId == null) {
      setDetail(null);
      return;
    }
    void outreachApi
      .detail(selectedId)
      .then(setDetail)
      .catch(() => toast.error(t("outreach.error_detail")));
  }, [selectedId, toast, t]);

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(intlLocale(locale), {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );

  const isTab = variant === "tab";

  return (
    <section aria-labelledby="outreach-section-heading" className={isTab ? undefined : "mt-10"}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* The heading stays in the tree either way so the section keeps its
              accessible name; in tab mode the tab itself is the visible label. */}
          <h2
            id="outreach-section-heading"
            className={isTab ? "sr-only" : "flex items-center gap-2 font-grotesk text-2xl"}
          >
            {t("outreach.heading")}
            {/* The "replies land in your own inbox" note used to be a full-width
                banner; tuck it behind a mail glyph so the header stays light. */}
            {!isTab && (
              <InfoHint
                icon={Mail}
                text={t("outreach.reply_note")}
                label={t("outreach.reply_note")}
              />
            )}
          </h2>
          <p
            className={`flex items-center gap-2 text-sm text-ink-600 dark:text-umber-200 ${
              isTab ? "" : "mt-1"
            }`}
          >
            {t("outreach.subheading", { max: OUTREACH_SUPPLIERS_PER_CAMPAIGN_CAP })}
            {isTab && (
              <InfoHint
                icon={Mail}
                text={t("outreach.reply_note")}
                label={t("outreach.reply_note")}
              />
            )}
          </p>
        </div>
        {/* Compose used to exist only inside the empty state, so the couple who
            had already sent one round had no way back to the composer from here
            — they had to go find a vendor card. */}
        {campaigns.length > 0 && (
          <button
            type="button"
            className="btn-accent inline-flex shrink-0 items-center gap-1"
            onClick={() => setComposing(true)}
          >
            <Plus size={16} aria-hidden /> {t("outreach.new_campaign")}
          </button>
        )}
      </div>

      {loading ? (
        <div className="card text-sm text-ink-500 dark:text-umber-300">{t("common.loading")}</div>
      ) : campaigns.length === 0 ? (
        <div className="card text-center">
          <h3 className="font-grotesk text-lg">{t("outreach.empty_title")}</h3>
          <p className="mt-2 text-sm text-ink-600 dark:text-umber-200">
            {t("outreach.empty_body")}
          </p>
          <button
            type="button"
            className="btn-accent mt-4 inline-flex items-center gap-1"
            onClick={() => setComposing(true)}
          >
            <Plus size={16} aria-hidden /> {t("outreach.new_campaign")}
          </button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <aside className="space-y-2">
            {campaigns.map((c) => {
              const active = c.id === selectedId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={`block w-full rounded-2xl border px-4 py-3 text-left transition ${
                    active
                      ? "border-blush-400 bg-blush-50/70 dark:border-blush-400/60 dark:bg-blush-400/15"
                      : "border-paper-300 bg-white hover:border-paper-400 dark:border-umber-700 dark:bg-umber-800 dark:hover:border-umber-600"
                  }`}
                >
                  <p className="truncate font-grotesk text-sm font-semibold">{c.subject}</p>
                  <p className="mt-1 text-xs text-ink-500 dark:text-umber-300">
                    {t("outreach.recipient_count", { n: c.message_count })} ·{" "}
                    {dateFmt.format(c.created_at)}
                  </p>
                </button>
              );
            })}
          </aside>
          <section className="card">
            {detail ? (
              <div className="space-y-4">
                <header>
                  <p className="text-xs uppercase tracking-wider text-ink-500 dark:text-umber-300">
                    {dateFmt.format(detail.created_at)}
                  </p>
                  <h3 className="mt-1 font-grotesk text-2xl">{detail.subject}</h3>
                </header>
                <div className="rounded-xl bg-paper-50 p-4 text-sm leading-relaxed text-ink-700 dark:bg-umber-800/60 dark:text-paper-100">
                  {detail.body_template.split(/\n+/).map((para, idx) => (
                    // Body paragraphs are static text rendered from a frozen
                    // template — index keys are appropriate here because the
                    // list never reorders.
                    <p key={`${detail.id}-p-${idx}`} className="mb-2 last:mb-0">
                      {para}
                    </p>
                  ))}
                </div>
                <div>
                  <h4 className="mb-2 font-grotesk text-base font-medium tracking-tight text-ink-700 dark:text-paper-100">
                    {t("outreach.recipients_header")}
                  </h4>
                  <ul className="space-y-2">
                    {detail.messages.map((m) => {
                      const Glyph = categoryIcon(m.supplier_category ?? "");
                      return (
                        <li
                          key={m.id}
                          className="flex items-center justify-between gap-3 rounded-xl border border-paper-200 px-3 py-2 dark:border-umber-700"
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            {/* Category as a glyph rather than a third line of
                              text; the label rides on the meta line below.
                              Outlined in ink on the bare surface, matching the
                              thread list this tab sits beside: it is the same
                              tile a size down, and one page must not draw it
                              two ways. */}
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-ink-900 text-ink-900 dark:border-paper-200 dark:text-paper-100">
                              <Glyph className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                            </span>
                            <div className="min-w-0">
                              {/* A category means the card still resolves, so it
                                is also what earns the link — same rule as the
                                message threads. */}
                              {m.supplier_category ? (
                                <Link
                                  to={`/app/suppliers/${m.supplier_id}`}
                                  title={t("suppliers.open_card")}
                                  className="inline-flex min-w-0 items-center gap-1 text-sm font-medium hover:underline"
                                >
                                  <span className="min-w-0 truncate">{m.supplier_name}</span>
                                  <ArrowUpRight
                                    className="h-3.5 w-3.5 shrink-0 text-ink-400 dark:text-umber-300"
                                    aria-hidden="true"
                                  />
                                </Link>
                              ) : (
                                <p className="truncate text-sm font-medium">{m.supplier_name}</p>
                              )}
                              {/* The meta line used to end in the vendor's email
                                address. It says where the message LANDED
                                instead: the address is never shown to a user,
                                and "someone's dashboard has this" vs "it is in
                                a mailbox and nothing more" is the one thing the
                                couple can actually act on. The status pill
                                beside it only ever says "sent". */}
                              <p className="truncate text-xs text-ink-500 dark:text-umber-300">
                                {[
                                  m.supplier_category
                                    ? t(`suppliers.cat.${m.supplier_category}`)
                                    : null,
                                  t(`outreach.delivery_${m.delivery}`),
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span
                              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                                // `replied` is the only status the couple can do
                                // something about, so it is the only one that
                                // gets the accent. Sent is now quiet chrome: a
                                // green badge on every row of every campaign
                                // told them nothing and left nowhere for the one
                                // that matters to stand out.
                                m.status === "replied"
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300"
                                  : m.status === "bounced"
                                    ? "bg-blush-100 text-blush-700 dark:bg-blush-400/15 dark:text-blush-300"
                                    : "bg-paper-200 text-ink-600 dark:bg-umber-700 dark:text-paper-200"
                              }`}
                            >
                              {t(`outreach.status_${m.status}`)}
                            </span>
                            {/* The campaign row's way into the conversation it
                              started. Until now the sent history could only send
                              the couple back to the vendor's directory card,
                              even though the inquiry had a thread the whole
                              time and the vendor may already have answered in
                              it. Only an in-account delivery has one to open. */}
                            {m.booking_id !== null && (
                              <Link
                                to={`/app/messages/${m.booking_id}`}
                                title={t("outreach.open_thread")}
                                aria-label={t("outreach.open_thread")}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-paper-300 text-ink-600 transition hover:border-blush-300 hover:bg-blush-50 hover:text-blush-700 dark:border-umber-700 dark:text-umber-200 dark:hover:border-blush-400/40 dark:hover:bg-blush-400/15 dark:hover:text-blush-300"
                              >
                                <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                              </Link>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-500 dark:text-umber-300">
                {t("outreach.detail_loading")}
              </p>
            )}
          </section>
        </div>
      )}

      {composing && (
        <ComposeDialog
          onClose={() => setComposing(false)}
          onSent={async (created) => {
            setComposing(false);
            await refreshList();
            setSelectedId(created.id);
            toast.success(t("outreach.send_success", { n: created.message_count }));
          }}
        />
      )}
    </section>
  );
}

// Quick-fill templates. Each key resolves to two i18n strings:
//   outreach.tpl_<key>          → chip label
//   outreach.tpl_<key>_subject  → subject template with {date}
//   outreach.tpl_<key>_body     → body template with {date} and {guests}
// {date} comes from the couple's wedding_date (locale-formatted) and falls
// back to "[dátum]" / "[date]" so the user sees and edits the placeholder.
// {guests} comes from the budget guest_count_goal (exact or range), with a
// matching placeholder when unset. The date + guest number are wrapped in
// **bold** in the body templates so they stand out in the delivered email.
const TEMPLATE_KEYS = ["quote", "availability", "details", "intro"] as const;
type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** Guest-count display for the outreach templates. Anchored on the budget
 *  baseline (`guestCountBaseline` — the single headcount the cost planner uses)
 *  and presented as a TIGHT range so vendors get a realistic spread instead of
 *  the couple's raw planning range, which is often wildly wide (e.g. 40–150).
 *  The shown range never exceeds base ±10%; a tighter couple range is honoured
 *  as-is. An exact target renders as a single number. Returns null when the
 *  couple has no real headcount yet, so the caller falls back to "[létszám]". */
function outreachGuestLabel(couple: Couple | null): string | null {
  if (!couple) return null;
  const g = couple.guest_count_goal;
  const hasGoal =
    (g.kind === "exact" && g.exact != null) ||
    (g.kind === "range" && g.min != null && g.max != null) ||
    couple.target_guest_count != null;
  if (!hasGoal) return null;

  // A committed exact count reads cleaner as a single number.
  if (g.kind === "exact" && g.exact != null) return String(g.exact);

  const base = guestCountBaseline(couple, 0);
  const round5 = (n: number) => Math.round(n / 5) * 5;
  // Clamp to base ±10%, but never widen a range the couple set tighter.
  let lo = base * 0.9;
  let hi = base * 1.1;
  if (g.kind === "range" && g.min != null && g.max != null) {
    lo = Math.max(g.min, lo);
    hi = Math.min(g.max, hi);
  }
  const loR = Math.max(1, round5(lo));
  const hiR = round5(hi);
  return loR >= hiR ? String(base) : `${loR}–${hiR}`;
}

/** Diacritic-folded lower-case for accent-insensitive supplier search.
 *  Same shape as the helper on SuppliersPage — duplicated rather than
 *  shared because the page-level helper isn't exported. */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Public seed entry — supply a chip to pre-populate the recipient picker.
 *  Used by the supplier detail page so the "Send inquiry" CTA opens the
 *  composer with the current vendor already attached. */
export type OutreachInitialSupplier = { id: string; name: string; city: string };

export function ComposeDialog({
  onClose,
  onSent,
  initialSuppliers,
}: {
  onClose: () => void;
  onSent: (created: OutreachCampaignDetail) => void | Promise<void>;
  /** Pre-seed the recipient picker with one or more chips. Capped to the
   *  per-campaign limit; extras are silently dropped. */
  initialSuppliers?: OutreachInitialSupplier[];
}) {
  const { t, locale } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  // Picked recipients: id + name (name for the chip, id for the API).
  const [selected, setSelected] = useState<Array<{ id: string; name: string; city: string }>>(() =>
    (initialSuppliers ?? []).slice(0, OUTREACH_SUPPLIERS_PER_CAMPAIGN_CAP),
  );
  const [supplierQuery, setSupplierQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [allSuppliers, setAllSuppliers] = useState<DirectorySupplier[]>([]);
  const [weddingDate, setWeddingDate] = useState<string | null>(null);
  const [couple, setCouple] = useState<Couple | null>(null);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cap = OUTREACH_SUPPLIERS_PER_CAMPAIGN_CAP;

  // Fetch the directory + the couple's date/guest count once when the
  // dialog mounts. Both calls are best-effort: a missing directory just
  // means the picker shows "no matches" and a missing couple means the
  // templates render with the [date]/[guest count] placeholders.
  useEffect(() => {
    void supplierApi
      .list()
      .then((r) => setAllSuppliers(r.suppliers))
      .catch(() => undefined);
    void coupleApi
      .current()
      .then((r) => {
        setWeddingDate(r.couple?.wedding_date ?? null);
        setCouple(r.couple ?? null);
      })
      .catch(() => undefined);
  }, []);

  // Substituted into {date} and {guests} when a template is applied.
  const tplDate = weddingDate
    ? formatDate(weddingDate, locale === "hu" ? "hu" : "en")
    : t("outreach.tpl_placeholder_date");
  const tplGuests = outreachGuestLabel(couple) ?? t("outreach.tpl_placeholder_guests");

  // A template REPLACES subject + body, which is fine while the draft is still
  // ours to overwrite and destructive the moment the couple has typed. So we
  // remember what we last wrote into the box: if the body still matches it (or
  // is empty), swapping templates is a free preview; if it has been edited, the
  // swap asks first. Losing a paragraph someone wrote to a vendor is not
  // something a click on a chip should be able to do.
  const lastAppliedBody = useRef<string>("");
  const applyTemplate = async (key: TemplateKey) => {
    const nextSubject = t(`outreach.tpl_${key}_subject`, { date: tplDate, guests: tplGuests });
    const nextBody = t(`outreach.tpl_${key}_body`, { date: tplDate, guests: tplGuests });
    const edited = body.trim() !== "" && body !== lastAppliedBody.current;
    if (edited) {
      const ok = await confirm({
        title: t("outreach.tpl_overwrite_title"),
        body: t("outreach.tpl_overwrite_body"),
        confirmLabel: t("outreach.tpl_overwrite_confirm"),
        cancelLabel: t("common.cancel"),
      });
      if (!ok) return;
    }
    lastAppliedBody.current = nextBody;
    setSubject(nextSubject);
    setBody(nextBody);
  };

  // Picker: filter suppliers by query (name or city, accent-insensitive),
  // hide already-selected ones, cap to 8 visible. Empty query → no dropdown.
  const queryNorm = useMemo(() => fold(supplierQuery.trim()), [supplierQuery]);
  const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected]);
  const suggestions = useMemo<DirectorySupplier[]>(() => {
    if (!queryNorm) return [];
    return allSuppliers
      .filter((s) => !selectedIds.has(s.id))
      .filter((s) => fold(`${s.name} ${s.city}`).includes(queryNorm))
      .slice(0, 8);
  }, [queryNorm, allSuppliers, selectedIds]);
  // Reset the keyboard cursor whenever the matched set changes so Enter
  // always lands on the first visible row, not a stale index.
  useEffect(() => setActiveIdx(0), [queryNorm, selectedIds.size]);

  const addSupplier = useCallback(
    (s: DirectorySupplier) => {
      setSelected((prev) => {
        if (prev.length >= cap) return prev;
        if (prev.some((p) => p.id === s.id)) return prev;
        return [...prev, { id: s.id, name: s.name, city: s.city }];
      });
      setSupplierQuery("");
      setPickerOpen(false);
      // Stay focused so couples can keep picking without re-clicking.
      inputRef.current?.focus();
    },
    [cap],
  );

  const removeSupplier = useCallback((id: string) => {
    setSelected((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const capped = selected.length >= cap;

  const onPickerKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && suggestions.length > 0) {
      e.preventDefault();
      setPickerOpen(true);
      setActiveIdx((i) => Math.min(suggestions.length - 1, i + 1));
    } else if (e.key === "ArrowUp" && suggestions.length > 0) {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && suggestions.length > 0) {
      e.preventDefault();
      const pick = suggestions[Math.min(activeIdx, suggestions.length - 1)];
      if (pick) addSupplier(pick);
    } else if (e.key === "Backspace" && supplierQuery === "" && selected.length > 0) {
      // Email-style: empty input + backspace → pop the last chip.
      removeSupplier(selected[selected.length - 1]!.id);
    } else if (e.key === "Escape") {
      setPickerOpen(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (sending) return;
    if (selected.length === 0) {
      toast.error(t("outreach.err_no_suppliers"));
      return;
    }
    if (selected.length > cap) {
      toast.error(t("outreach.err_too_many_suppliers", { max: cap }));
      return;
    }
    const payload: CreateOutreachCampaignInput = {
      subject: subject.trim(),
      body_template: body.trim(),
      supplier_ids: selected.map((s) => s.id),
    };
    setSending(true);
    try {
      const created = await outreachApi.create(payload);
      await onSent(created);
    } catch (err) {
      const code = err instanceof ApiError ? (err.detail as { code?: string })?.code : undefined;
      const message =
        code === "campaign_rate_limited"
          ? t("outreach.err_rate_limited", { max: OUTREACH_MESSAGES_PER_WEEK_CAP })
          : code === "supplier_cap_exceeded"
            ? t("outreach.err_too_many_suppliers", { max: cap })
            : code === "supplier_not_found"
              ? t("outreach.err_supplier_not_found")
              : code === "supplier_no_email"
                ? t("outreach.err_supplier_no_email")
                : code === "supplier_no_contact"
                  ? t("outreach.err_supplier_no_contact")
                  : t("outreach.err_generic");
      toast.error(message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("outreach.compose_title")}
      size="lg"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={sending}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            form="outreach-compose-form"
            className="btn-accent"
            disabled={sending}
          >
            <Send size={16} aria-hidden />
            {sending ? t("outreach.sending") : t("outreach.send")}
          </button>
        </>
      }
    >
      <form id="outreach-compose-form" onSubmit={onSubmit} className="space-y-3">
        {/* Recipients come FIRST, like the To: line of any mail composer — and
            because the autocomplete drops DOWNWARD inside the dialog's scroll
            box. As the last field it opened into the footer and got clipped to
            one visible row; above the subject and the message it has the whole
            form to open into. Selected vendors render as chips with an
            × button; the input below filters the directory by name/city as
            you type and shows a dropdown of matches. Couples never have to
            know the internal supplier id — the chip carries the display
            name and the API request uses the id under the hood. */}
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="field-label" id="outreach-suppliers-label">
              {t("outreach.label_suppliers")}
            </span>
            <span className="text-[11px] tabular-nums text-ink-500 dark:text-umber-300">
              {t("outreach.suppliers_count", { n: selected.length, max: cap })}
            </span>
          </div>
          <div
            className="relative mt-1 rounded-xl border border-paper-300 bg-paper-50 px-2 py-1.5 transition focus-within:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:focus-within:border-umber-500"
            onClick={() => inputRef.current?.focus()}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              {selected.map((s) => (
                <span
                  key={s.id}
                  className="inline-flex items-center gap-1 rounded-full bg-ink-700 px-2.5 py-0.5 text-xs text-paper-100 dark:bg-paper-50 dark:text-umber-900"
                >
                  <span className="max-w-[14rem] truncate">{s.name}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSupplier(s.id);
                    }}
                    aria-label={t("outreach.suppliers_remove_aria", { name: s.name })}
                    className="-mr-1 ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-paper-200 transition hover:bg-white/20 hover:text-paper-100 dark:text-umber-700 dark:hover:bg-black/10 dark:hover:text-umber-900"
                  >
                    <X size={11} aria-hidden />
                  </button>
                </span>
              ))}
              <span className="relative inline-flex min-w-[12rem] flex-1 items-center">
                <Search
                  size={12}
                  aria-hidden
                  className="absolute left-1 top-1/2 -translate-y-1/2 text-ink-400 dark:text-umber-300"
                />
                <input
                  ref={inputRef}
                  type="text"
                  aria-labelledby="outreach-suppliers-label"
                  aria-autocomplete="list"
                  aria-expanded={pickerOpen && suggestions.length > 0}
                  aria-controls="outreach-suppliers-listbox"
                  value={supplierQuery}
                  onChange={(e) => {
                    setSupplierQuery(e.target.value);
                    setPickerOpen(true);
                  }}
                  onFocus={() => setPickerOpen(true)}
                  onBlur={() => {
                    // Delay the close so a mousedown on a suggestion lands
                    // before the dropdown unmounts.
                    window.setTimeout(() => setPickerOpen(false), 120);
                  }}
                  onKeyDown={onPickerKeyDown}
                  disabled={capped}
                  placeholder={
                    capped
                      ? t("outreach.suppliers_picker_capped", { max: cap })
                      : selected.length === 0
                        ? t("outreach.suppliers_picker_placeholder")
                        : ""
                  }
                  className="w-full bg-transparent pl-5 pr-1 py-1 text-sm text-ink-800 placeholder:text-ink-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:text-paper-100 dark:placeholder:text-umber-300"
                />
              </span>
            </div>
            {pickerOpen && queryNorm && !capped && (
              <div
                id="outreach-suppliers-listbox"
                role="listbox"
                className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-xl border border-paper-300 bg-white py-1 shadow-lg dark:border-umber-700 dark:bg-umber-800"
              >
                {suggestions.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-ink-500 dark:text-umber-300">
                    {t("outreach.suppliers_picker_no_matches", { q: supplierQuery.trim() })}
                  </p>
                ) : (
                  suggestions.map((s, idx) => {
                    const active = idx === Math.min(activeIdx, suggestions.length - 1);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        // mousedown fires before the input's blur → click would
                        // race the dropdown's unmount. mousedown wins cleanly.
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addSupplier(s);
                        }}
                        onMouseEnter={() => setActiveIdx(idx)}
                        className={`flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm transition ${
                          active
                            ? "bg-paper-100 dark:bg-umber-700"
                            : "hover:bg-paper-100 dark:hover:bg-umber-700"
                        }`}
                      >
                        <span className="truncate font-medium text-ink-800 dark:text-paper-100">
                          {s.name}
                        </span>
                        <span className="shrink-0 text-xs text-ink-500 dark:text-umber-300">
                          {s.city}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
          <p className="field-help">
            {capped
              ? t("outreach.suppliers_picker_capped", { max: cap })
              : t("outreach.suppliers_picker_help", { max: cap })}
            {/* Only once they have actually hit it. A limit stated with no
                reason reads either as arbitrary or as a tier that could be paid
                off, and it is neither: cold volume burns the same sending
                domain that email verification and RSVP delivery run on. */}
            {capped && (
              <InfoHint
                icon={Mail}
                text={t("outreach.suppliers_picker_capped_why")}
                label={t("outreach.suppliers_picker_capped_why")}
              />
            )}
          </p>
        </div>
        {/* Quick-fill templates. One row of chips; click replaces subject +
            body with a friendly draft that already names the wedding date
            and guest count (or shows a [placeholder] when those aren't set).
            Not a wizard step — couples can still write from scratch. */}
        <div>
          <span className="field-label inline-flex items-center gap-1.5">
            <Sparkles size={12} aria-hidden className="text-ink-400 dark:text-umber-300" />
            {t("outreach.tpl_section_label")}
          </span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {TEMPLATE_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => void applyTemplate(key)}
                className="inline-flex items-center gap-1 rounded-full border border-paper-300 bg-paper-50 px-3 py-1 text-xs text-ink-700 transition hover:border-ink-400 hover:bg-paper-100 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-500 dark:hover:bg-umber-700"
              >
                {t(`outreach.tpl_${key}`)}
              </button>
            ))}
          </div>
        </div>

        <label className="block" htmlFor="outreach-subject">
          <span className="field-label">{t("outreach.label_subject")}</span>
          <input
            id="outreach-subject"
            className="input"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={OUTREACH_SUBJECT_MAX_LEN}
            required
          />
        </label>
        <label className="block" htmlFor="outreach-body">
          <span className="field-label">{t("outreach.label_body")}</span>
          <textarea
            id="outreach-body"
            className="input min-h-[10rem]"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={OUTREACH_BODY_MAX_LEN}
            required
          />
        </label>
      </form>
    </Dialog>
  );
}
