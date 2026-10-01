import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpDown,
  Baby,
  CakeSlice,
  CalendarClock,
  Check,
  CheckCheck,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleSlash,
  Clock3,
  Coins,
  Filter,
  Handshake,
  Inbox,
  Layers,
  Loader,
  Mail,
  MailX,
  Megaphone,
  Pencil,
  Search,
  Send,
  Sparkles,
  TriangleAlert,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import type {
  Couple,
  EnvelopeTip,
  Guest,
  GuestKind,
  GuestMessage,
  GuestMessageAudience,
  GuestMessageStatus,
  GuestMessageTemplate,
  RsvpStatus,
} from "@shared/types";
import {
  type ConfirmOptions,
  SegmentedControl,
  Skeleton,
  Switch,
  TagChip,
  useConfirm,
  useToast,
  ViewSelect,
} from "../components/ui";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { ExpandingSearch } from "../components/ExpandingSearch";
import { InfoHint } from "../components/InfoHint";
import { MoneyInput } from "../components/MoneyInput";
import { coupleApi, guestApi, guestMessageApi } from "../lib/endpoints";
import { formatMoney, formatTimestamp } from "../lib/format";
import { useT } from "../lib/i18n";

const AUDIENCES: GuestMessageAudience[] = ["all", "pending", "confirmed"];

/** Where a guest sits in the invite pipeline: nobody has been told yet, they
 *  were told and haven't answered, or they answered (yes/no/maybe all count —
 *  a decline is still a decision, unlike "pending"). Drives both the filter
 *  pills and the OPT-IN "needs attention first" order, so the two can never
 *  disagree about what "needs attention" means — and it deliberately does not
 *  drive the default order, because a guest's status is not a request to
 *  re-sort the list (see `SortMode` below). */
type GuestBucket = "not_invited" | "awaiting" | "responded";
type StatusFilter = "all" | GuestBucket;
const FILTERS: StatusFilter[] = ["all", "not_invited", "awaiting", "responded"];
const BUCKET_ORDER: Record<GuestBucket, number> = { not_invited: 0, awaiting: 1, responded: 2 };

function guestBucket(g: Guest): GuestBucket {
  const invited = g.invited_online_at !== null || g.invited_physical_at !== null;
  if (!invited) return "not_invited";
  return g.rsvp_status === "pending" ? "awaiting" : "responded";
}

/** ── Ordering ──
 *
 *  `list` is the DEFAULT and is deliberately NOT a sort: it keeps the order
 *  `guests` arrived in, which is the guest list's own `created_at ASC`
 *  (`listGuestsByCouple`). Before this the rows were sorted actionable-first,
 *  so marking one guest "online" moved them from the `not_invited` bucket into
 *  `awaiting` and dropped their row to the bottom of the list — the rows
 *  reshuffled themselves under the finger that was working down them, and the
 *  next tap landed on a different person. A list you are clicking THROUGH has
 *  to hold still until you ask it to move, and no status a guest happens to be
 *  in is the couple asking for a re-sort.
 *
 *  The other two orders stay, and both are opt-in now. `attention` is exactly
 *  the old behaviour and remains the right answer for someone opening the page
 *  to find out who is missing; it is simply not the answer for someone working
 *  a list top to bottom. The choice is remembered, because re-deciding it on
 *  every visit is the same annoyance in a smaller box. */
type SortMode = "list" | "attention" | "name";
const SORT_MODES: SortMode[] = ["list", "attention", "name"];
const SORT_STORAGE_KEY = "weddly.invites.sort";

/** Read the remembered order. A value we do not recognise — a hand-edited key,
 *  a stale build — falls back to `list`, which is the safe reading: an
 *  unrecognised order must never become a surprise re-sort. */
function readStoredSort(): SortMode {
  try {
    const v = window.localStorage.getItem(SORT_STORAGE_KEY);
    return SORT_MODES.includes(v as SortMode) ? (v as SortMode) : "list";
  } catch {
    return "list";
  }
}

/** How many of the two invite channels actually reached a guest. The three
 *  states are MUTUALLY EXCLUSIVE on purpose: "invited online" and "invited in
 *  person" overlap — one guest can be both — so a filter built out of those
 *  two numbers cannot add up to anything. Completeness is a partition, and
 *  "invited through only one channel" is the question a couple actually has. */
type ChannelState = "none" | "one" | "both";
const CHANNEL_STATES: ChannelState[] = ["none", "one", "both"];

function channelState(g: Guest): ChannelState {
  const n = (g.invited_online_at !== null ? 1 : 0) + (g.invited_physical_at !== null ? 1 : 0);
  return n === 0 ? "none" : n === 1 ? "one" : "both";
}

/** Whether a guest can be reached by a broadcast at all. Not cosmetic: a guest
 *  with no address is silently skipped by the server's `resolveRecipients`, so
 *  the audience counts below are always lower than the guest count. Showing
 *  them apart is what explains that gap instead of leaving it as a mystery. */
type Mailable = "yes" | "no";
const MAILABLES: Mailable[] = ["yes", "no"];

const isMailable = (g: Guest): Mailable => ((g.email ?? "").trim() !== "" ? "yes" : "no");

/** Pending first in both places this appears: it is the answer a couple is
 *  scanning for ("who hasn't replied"), and the default state every guest
 *  starts in. */
const RSVP_ORDER: RsvpStatus[] = ["pending", "yes", "no", "maybe"];

/** Every answer carries a SHAPE and a colour, never colour alone. The shape is
 *  what survives a colour-blind read, a greyscale print and the dark-mode
 *  inversion, the legend below the list teaches it on first use, and the
 *  element itself keeps the full word as its accessible name — so the glyph
 *  replaces the label a sighted user reads, not the label a screen reader
 *  speaks. */
const RSVP_ICON: Record<RsvpStatus, LucideIcon> = {
  pending: CircleDashed,
  yes: CircleCheck,
  no: CircleSlash,
  maybe: CircleHelp,
};
const RSVP_SURFACE: Record<RsvpStatus, string> = {
  pending:
    "border-dashed border-paper-300 bg-paper-100 text-umber-500 dark:border-umber-600 dark:bg-umber-800 dark:text-umber-400",
  yes: "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-900/30 dark:text-emerald-300",
  no: "border-blush-200 bg-blush-50 text-blush-700 dark:border-blush-400/30 dark:bg-blush-900/30 dark:text-blush-300",
  maybe:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-900/30 dark:text-amber-300",
};
/** The left rail on each row and the dot beside it in the legend — the same
 *  colour as the badge, so a long list is scannable from the edge without
 *  reading a single glyph. */
const RSVP_DOT: Record<RsvpStatus, string> = {
  pending: "bg-paper-300 dark:bg-umber-600",
  yes: "bg-emerald-500",
  no: "bg-blush-500",
  maybe: "bg-amber-500",
};

const BROADCAST_ICON: Record<GuestMessageStatus, LucideIcon> = {
  sent: CheckCheck,
  scheduled: CalendarClock,
  sending: Loader,
  failed: TriangleAlert,
};
const BROADCAST_SURFACE: Record<GuestMessageStatus, string> = {
  sent: "bg-sage-100 text-sage-700 dark:bg-sage-900/40 dark:text-sage-300",
  scheduled: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  sending: "bg-paper-200 text-umber-600 dark:bg-umber-800 dark:text-umber-300",
  failed: "bg-blush-100 text-blush-700 dark:bg-blush-900/40 dark:text-blush-300",
};

const KIND_ICON: Record<GuestKind, LucideIcon> = {
  adult: UserRound,
  child: CakeSlice,
  baby: Baby,
};
const KIND_DOT: Record<GuestKind, string> = {
  adult: "bg-umber-500 dark:bg-umber-400",
  child: "bg-amber-500",
  baby: "bg-blush-400",
};

const CHANNEL_ICON: Record<ChannelState, LucideIcon> = {
  none: CircleSlash,
  one: Send,
  both: Layers,
};
const CHANNEL_DOT: Record<ChannelState, string> = {
  none: "bg-paper-300 dark:bg-umber-600",
  one: "bg-sage-500",
  both: "bg-umber-500 dark:bg-umber-400",
};
/** The two ends already have names on the page (`not_invited`, `invited_both`);
 *  the middle case is the one that needed one. */
const CHANNEL_FILTER_KEY: Record<ChannelState, string> = {
  none: "guest_invites.not_invited",
  one: "guest_invites.filter_channel_one",
  both: "guest_invites.invited_both",
};

/** Delay a staggered reveal by row index, CAPPED. A guest list runs to a few
 *  hundred rows and an uncapped stagger would leave the last one invisible for
 *  seconds — the animation is there to make the list arrive, not to make the
 *  couple wait for it. */
function staggerMs(index: number, step = 22, cap = 14): number {
  return Math.min(index, cap) * step;
}

/** Add or remove one value from a filter set, as a NEW set. Mutating in place
 *  is how a filter chip goes on looking selectable while the list never
 *  re-renders, and this is the one function every filter chip goes through. */
function toggleIn<T>(current: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** One labelled group of filter chips. The label is what makes four groups of
 *  multi-selects readable at a glance — without it the panel is twelve pills
 *  and a couple has to read every one to know what dimension it is choosing. */
function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-umber-400 dark:text-umber-500">
        {label}
      </span>
      {children}
    </div>
  );
}

/** One glyph per audience, so the picker can be three small pills carrying the
 *  HEADCOUNT rather than three long labels that scroll off a narrow card. */
const AUDIENCE_ICON: Record<GuestMessageAudience, LucideIcon> = {
  all: Users,
  pending: Clock3,
  confirmed: CheckCheck,
};

/** One glyph per broadcast template, so the history rows carry the same
 *  visual anchor as the composer cards they came from. */
const TEMPLATE_ICON: Record<GuestMessageTemplate, LucideIcon> = {
  invite: Mail,
  major_update: Megaphone,
  pre_wedding_info: CalendarClock,
};

/** How many people each audience would actually reach. Mirrors the server's
 *  `resolveRecipients`: an address is required, and one address is one send
 *  however many rows carry it. */
export type AudienceCounts = Record<GuestMessageAudience, number>;

/** Build the `scheduled_at` epoch-ms (or null for "send now") from the picker. */
function scheduledAtFrom(mode: "now" | "schedule", value: string): number | null {
  if (mode === "now" || !value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Ask before an immediate send, and only before an immediate send.
 *
 * These three buttons are the only controls in the workspace that reach the
 * couple's actual guests, and there is no recall: the mail is gone the moment
 * the request lands. A SCHEDULED send deliberately does not ask, because it is
 * already reversible, it sits in "Sent & scheduled" with a Cancel next to it
 * until the worker picks it up.
 *
 * The count is in the question because that is the fact worth checking before
 * saying yes: "Send to 6 guests?" catches a mis-picked audience in a way that
 * "Are you sure?" never does.
 */
async function confirmImmediateSend(
  confirm: (opts: ConfirmOptions) => Promise<boolean>,
  t: (key: string, vars?: Record<string, string | number>) => string,
  mode: "now" | "schedule",
  audience: GuestMessageAudience,
  count: number,
): Promise<boolean> {
  if (mode === "schedule") return true;
  return confirm({
    title: t("guest_invites.send_confirm_title", { count }),
    body: t(`guest_invites.send_confirm_body_${audience}`, { count }),
    confirmLabel: t("guest_invites.send_now_button"),
    cancelLabel: t("common.cancel"),
  });
}

/** Card title row: category glyph, name, and the card's own explanation tucked
 *  behind an "i" instead of sitting under every heading as a paragraph. */
function CardHeader({
  icon: Icon,
  title,
  hint,
}: { icon: LucideIcon; title: string; hint: string }) {
  return (
    <header className="flex items-center gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-paper-100 text-umber-600 dark:bg-umber-800 dark:text-umber-200">
        <Icon className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
      </span>
      <h2 className="min-w-0 flex-1 font-grotesk text-lg font-semibold text-umber-900 dark:text-paper-50">
        {title}
      </h2>
      <InfoHint text={hint} className="shrink-0 text-umber-500 dark:text-umber-300" />
    </header>
  );
}

/** Audience picker + the scheduling field, shared by all three composer cards.
 *
 *  The picker shows the COUNT on each pill and names only the selected one: the
 *  three labels together are wider than a card in the three-up grid, so they
 *  used to scroll sideways, and the number is the fact the couple is actually
 *  choosing on ("who is this going to" is answered by 42, not by the word). */
function SendControls({
  audience,
  onAudience,
  counts,
}: {
  audience: GuestMessageAudience;
  onAudience: (a: GuestMessageAudience) => void;
  counts: AudienceCounts;
}) {
  const { t } = useT();
  return (
    <div className="mt-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SegmentedControl
          size="sm"
          ariaLabel={t("guest_invites.audience_label")}
          value={audience}
          onChange={onAudience}
          options={AUDIENCES.map((a) => {
            const Icon = AUDIENCE_ICON[a];
            return {
              value: a,
              label: String(counts[a]),
              ariaLabel: `${t(`guest_invites.audience_${a}`)}: ${counts[a]}`,
              icon: <Icon size={14} aria-hidden="true" />,
            };
          })}
        />
        {/* The pills carry a count and an icon, never a word: the three labels
            together are wider than a card in the three-up grid. So this line is
            the only place the chosen audience is spelled out, which makes it
            worth a full phrase rather than a bare label. Clicking through the
            pills rewrites it, which is how the other two options explain
            themselves on a touch device that has no hover. */}
        <span className="text-xs text-umber-600 dark:text-umber-300">
          {t(`guest_invites.audience_sending_${audience}`, { count: counts[audience] })}
        </span>
      </div>
    </div>
  );
}

/** Bottom-pinned send row: one primary action plus a clock that flips it to
 *  scheduling. `mt-auto` anchors it so the buttons sit on one baseline across
 *  the grid.
 *
 *  It used to be a Send-now/Schedule segmented control ABOVE a button that also
 *  said "Send now", i.e. the same two words twice with different meanings. The
 *  button is the only thing that sends; the clock only says when. */
function SendButton({
  sending,
  mode,
  onMode,
  onClick,
  scheduledValue,
  onScheduledValue,
}: {
  sending: boolean;
  mode: "now" | "schedule";
  onMode: (m: "now" | "schedule") => void;
  onClick: () => void;
  scheduledValue: string;
  onScheduledValue: (v: string) => void;
}) {
  const { t } = useT();
  const scheduling = mode === "schedule";
  return (
    <div className="mt-auto pt-5">
      {/* The date input belongs NEXT TO the clock that summons it. It used to
          render up in SendControls, which on the two cards with a subject and a
          message body put it a couple of hundred pixels above the button that
          reveals it: you pressed the clock at the bottom of the card and the
          only visible change happened off-screen, which reads exactly like a
          dead control. */}
      {scheduling && (
        <input
          type="datetime-local"
          aria-label={t("guest_invites.schedule_label")}
          title={t("guest_invites.schedule_label")}
          className="input mb-2 w-full"
          value={scheduledValue}
          onChange={(e) => onScheduledValue(e.target.value)}
        />
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-primary inline-flex flex-1 items-center justify-center gap-2"
          disabled={sending}
          onClick={onClick}
        >
          {scheduling ? (
            <CalendarClock size={16} aria-hidden="true" />
          ) : (
            <Send size={16} aria-hidden="true" />
          )}
          {sending
            ? t("guest_invites.sending")
            : scheduling
              ? t("guest_invites.schedule_button")
              : t("guest_invites.send_now_button")}
        </button>
        <button
          type="button"
          aria-pressed={scheduling}
          aria-label={t("guest_invites.send_mode_schedule")}
          title={t("guest_invites.send_mode_schedule")}
          onClick={() => onMode(scheduling ? "now" : "schedule")}
          className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors ${
            scheduling
              ? "border-umber-700 bg-umber-700 text-paper-50 dark:border-umber-400 dark:bg-umber-400 dark:text-umber-900"
              : "border-paper-300 text-umber-500 hover:border-umber-400 hover:text-umber-900 dark:border-umber-600 dark:text-umber-300 dark:hover:border-umber-400 dark:hover:text-paper-50"
          }`}
        >
          <Clock3 size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** ── Invite card ── plain invitation + RSVP link. */
function InviteCard({ counts, onSent }: { counts: AudienceCounts; onSent: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [audience, setAudience] = useState<GuestMessageAudience>("pending");
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [scheduledValue, setScheduledValue] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSend() {
    if (mode === "schedule" && scheduledAtFrom(mode, scheduledValue) === null) {
      toast.error(t("guest_invites.schedule_required"));
      return;
    }
    if (!(await confirmImmediateSend(confirm, t, mode, audience, counts[audience]))) return;
    setSending(true);
    try {
      await guestMessageApi.send({
        template: "invite",
        audience,
        scheduled_at: scheduledAtFrom(mode, scheduledValue),
      });
      toast.success(t("guest_invites.send_success"));
      onSent();
    } catch {
      toast.error(t("guest_invites.send_error"));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="card flex flex-col">
      <CardHeader
        icon={Mail}
        title={t("guest_invites.template_invite")}
        hint={t("guest_invites.invite_desc")}
      />
      <SendControls audience={audience} onAudience={setAudience} counts={counts} />
      <SendButton
        sending={sending}
        mode={mode}
        onMode={setMode}
        onClick={() => void handleSend()}
        scheduledValue={scheduledValue}
        onScheduledValue={setScheduledValue}
      />
    </section>
  );
}

/** ── Major update card ── free-form announcement with subject + body. */
function MajorUpdateCard({ counts, onSent }: { counts: AudienceCounts; onSent: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [audience, setAudience] = useState<GuestMessageAudience>("all");
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [scheduledValue, setScheduledValue] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSend() {
    if (!subject.trim()) {
      toast.error(t("guest_invites.subject_required"));
      return;
    }
    if (!body.trim()) {
      toast.error(t("guest_invites.body_required"));
      return;
    }
    if (mode === "schedule" && scheduledAtFrom(mode, scheduledValue) === null) {
      toast.error(t("guest_invites.schedule_required"));
      return;
    }
    if (!(await confirmImmediateSend(confirm, t, mode, audience, counts[audience]))) return;
    setSending(true);
    try {
      await guestMessageApi.send({
        template: "major_update",
        audience,
        subject: subject.trim(),
        body: body.trim(),
        scheduled_at: scheduledAtFrom(mode, scheduledValue),
      });
      toast.success(t("guest_invites.send_success"));
      setSubject("");
      setBody("");
      onSent();
    } catch {
      toast.error(t("guest_invites.send_error"));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="card flex flex-col">
      <CardHeader
        icon={Megaphone}
        title={t("guest_invites.template_major_update")}
        hint={t("guest_invites.major_update_desc")}
      />
      <div className="mt-4 flex flex-col gap-3">
        <input
          id="gi_mu_subject"
          className="input"
          aria-label={t("guest_invites.subject_label")}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={t("guest_invites.subject_placeholder")}
        />
        <textarea
          id="gi_mu_body"
          className="input min-h-[88px] resize-y"
          aria-label={t("guest_invites.body_label")}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("guest_invites.body_placeholder")}
        />
      </div>
      <SendControls audience={audience} onAudience={setAudience} counts={counts} />
      <SendButton
        sending={sending}
        mode={mode}
        onMode={setMode}
        onClick={() => void handleSend()}
        scheduledValue={scheduledValue}
        onScheduledValue={setScheduledValue}
      />
    </section>
  );
}

/** ── Pre-wedding info card ── subject + body + the optional envelope tip. */
function PreWeddingCard({
  couple,
  counts,
  onSent,
}: {
  couple: Couple | null;
  counts: AudienceCounts;
  onSent: () => void;
}) {
  const { t, locale } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [audience, setAudience] = useState<GuestMessageAudience>("confirmed");
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [scheduledValue, setScheduledValue] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const [tip, setTip] = useState<EnvelopeTip | null>(null);
  const [tipManual, setTipManual] = useState(false);
  const [overrideInput, setOverrideInput] = useState("");
  const [savingTip, setSavingTip] = useState(false);

  const currency = couple?.currency ?? "HUF";

  const loadTip = useCallback(() => {
    guestMessageApi
      .getEnvelopeTip()
      .then((next) => {
        setTip(next);
        setTipManual(next.override !== null);
        setOverrideInput(next.override !== null ? String(next.override) : "");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadTip();
  }, [loadTip]);

  async function persistTip(patch: { enabled?: boolean; override?: number | null }) {
    setSavingTip(true);
    try {
      const next = await guestMessageApi.updateEnvelopeTip(patch);
      setTip(next);
      setTipManual(next.override !== null);
      setOverrideInput(next.override !== null ? String(next.override) : "");
      toast.success(t("guest_invites.envelope_tip_saved"));
    } catch {
      toast.error(t("guest_invites.envelope_tip_save_error"));
    } finally {
      setSavingTip(false);
    }
  }

  const tipEnabled = tip?.enabled ?? false;

  function handleToggleEnabled() {
    void persistTip({ enabled: !tipEnabled });
  }

  function handleModeAuto() {
    setTipManual(false);
    void persistTip({ override: null });
  }

  function handleModeManual() {
    setTipManual(true);
  }

  function handleSaveOverride() {
    const parsed = Number.parseInt(overrideInput, 10);
    void persistTip({ override: Number.isNaN(parsed) ? null : parsed });
  }

  async function handleSend() {
    if (!subject.trim()) {
      toast.error(t("guest_invites.subject_required"));
      return;
    }
    if (!body.trim()) {
      toast.error(t("guest_invites.body_required"));
      return;
    }
    if (mode === "schedule" && scheduledAtFrom(mode, scheduledValue) === null) {
      toast.error(t("guest_invites.schedule_required"));
      return;
    }
    if (!(await confirmImmediateSend(confirm, t, mode, audience, counts[audience]))) return;
    setSending(true);
    try {
      await guestMessageApi.send({
        template: "pre_wedding_info",
        audience,
        subject: subject.trim(),
        body: body.trim(),
        include_envelope_tip: tip?.enabled ?? false,
        scheduled_at: scheduledAtFrom(mode, scheduledValue),
      });
      toast.success(t("guest_invites.send_success"));
      setSubject("");
      setBody("");
      onSent();
    } catch {
      toast.error(t("guest_invites.send_error"));
    } finally {
      setSending(false);
    }
  }

  const effective = tip?.effective;

  return (
    <section className="card flex flex-col">
      <CardHeader
        icon={CalendarClock}
        title={t("guest_invites.template_pre_wedding_info")}
        hint={t("guest_invites.pre_wedding_desc")}
      />
      <div className="mt-4 flex flex-col gap-3">
        <input
          id="gi_pw_subject"
          className="input"
          aria-label={t("guest_invites.subject_label")}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={t("guest_invites.subject_placeholder")}
        />
        <textarea
          id="gi_pw_body"
          className="input min-h-[88px] resize-y"
          aria-label={t("guest_invites.body_label")}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("guest_invites.body_placeholder")}
        />
      </div>

      {/* Envelope tip. OFF until the couple asks for it (the server treats an
          untouched switch as off), so this block is a switch first and a
          settings panel only once it is on. */}
      <div className="mt-4 rounded-xl border border-paper-300 p-3.5 dark:border-umber-700">
        <div className="flex items-center gap-2">
          <Coins
            className="h-4 w-4 shrink-0 text-umber-500 dark:text-umber-300"
            strokeWidth={1.5}
            aria-hidden="true"
          />
          <span className="text-sm font-medium text-umber-900 dark:text-paper-50">
            {t("guest_invites.envelope_tip_title")}
          </span>
          <InfoHint
            text={t("guest_invites.envelope_tip_desc")}
            className="shrink-0 text-umber-500 dark:text-umber-300"
          />
          <span className="ml-auto shrink-0">
            <Switch
              checked={tipEnabled}
              onChange={handleToggleEnabled}
              disabled={savingTip}
              label={t("guest_invites.envelope_tip_include")}
            />
          </span>
        </div>

        {tipEnabled && (
          <div className="mt-3 flex flex-col gap-2">
            {/* Wraps rather than squeezing: an amount field crushed to 60px in
                the three-up grid can't show a six-digit forint figure. */}
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl
                size="sm"
                ariaLabel={t("guest_invites.envelope_tip_mode_label")}
                value={tipManual ? "manual" : "auto"}
                onChange={(v) => (v === "auto" ? handleModeAuto() : handleModeManual())}
                options={[
                  {
                    value: "auto",
                    label: t("guest_invites.envelope_tip_auto"),
                    icon: <Sparkles size={13} aria-hidden="true" />,
                  },
                  {
                    value: "manual",
                    label: t("guest_invites.envelope_tip_manual"),
                    icon: <Pencil size={13} aria-hidden="true" />,
                  },
                ]}
              />
              {tipManual && (
                <>
                  <MoneyInput
                    id="gi_tip_override"
                    locale={locale}
                    className="input h-9 min-w-[7rem] flex-1 py-1"
                    aria-label={t("guest_invites.envelope_tip_amount_label")}
                    title={t("guest_invites.envelope_tip_amount_label")}
                    value={overrideInput}
                    onChange={setOverrideInput}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveOverride();
                    }}
                  />
                  <button
                    type="button"
                    aria-label={t("common.save")}
                    title={t("common.save")}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-paper-300 text-umber-600 transition-colors hover:border-umber-400 hover:text-umber-900 disabled:opacity-50 dark:border-umber-600 dark:text-umber-200 dark:hover:border-umber-400 dark:hover:text-paper-50"
                    disabled={savingTip}
                    onClick={handleSaveOverride}
                  >
                    <Check size={16} aria-hidden="true" />
                  </button>
                </>
              )}
            </div>

            <p className="text-sm text-umber-700 dark:text-umber-200">
              {effective != null
                ? t("guest_invites.envelope_tip_per_head", {
                    amount: formatMoney(effective, currency, locale),
                  })
                : t("guest_invites.envelope_tip_none")}
            </p>
          </div>
        )}
      </div>

      <SendControls audience={audience} onAudience={setAudience} counts={counts} />
      <SendButton
        sending={sending}
        mode={mode}
        onMode={setMode}
        onClick={() => void handleSend()}
        scheduledValue={scheduledValue}
        onScheduledValue={setScheduledValue}
      />
    </section>
  );
}

/** A proportional bar. Widths transition, so a change in the mix shows the bar
 *  re-balancing instead of snapping — this is the one place on the page where
 *  motion carries information rather than company, which is why the segments
 *  and the words below them are the same three facts in the same colours: the
 *  bar is the "at a glance", the dots are the "exactly", and learning one
 *  teaches the other. A total of 0 renders an empty track, which is what a
 *  brand-new guest list looks like. */
function StackedMeter({
  segments,
  total,
}: {
  segments: { key: string; value: number; className: string }[];
  total: number;
}) {
  return (
    <div
      aria-hidden="true"
      className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-paper-200 dark:bg-umber-800"
    >
      {segments.map((s) => (
        <span
          key={s.key}
          className={`h-full transition-[width] duration-700 ease-out motion-reduce:transition-none ${s.className}`}
          style={{ width: total > 0 ? `${(s.value / total) * 100}%` : "0%" }}
        />
      ))}
    </div>
  );
}

/** One KPI tile: group icon + label, the headline number, a proportional bar of
 *  what the whole guest list is made of, that same composition spelled out
 *  against colour dots, and — only when something in this group actually needs
 *  the couple's attention — a highlighted action line. */
function KpiTile({
  icon: Icon,
  label,
  value,
  segments,
  breakdown,
  alert,
  index = 0,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  /** Always a partition of the WHOLE guest list, never of `value` — so the bar
   *  and the headline can be two different questions without lying about
   *  either. */
  segments: { key: string; value: number; className: string }[];
  breakdown: { dot: string; label: string }[];
  alert?: string;
  index?: number;
}) {
  return (
    <div
      className="animate-fade-in-up rounded-xl border border-paper-300 bg-paper-50 p-4 motion-reduce:animate-none dark:border-umber-700 dark:bg-umber-900"
      style={{ animationDelay: `${staggerMs(index)}ms` }}
    >
      <div className="flex items-center gap-2">
        <Icon
          className="h-4 w-4 shrink-0 text-umber-500 dark:text-umber-300"
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-umber-500 dark:text-umber-400">
          {label}
        </span>
      </div>
      <p className="mt-2 font-grotesk text-3xl font-semibold leading-none text-umber-900 dark:text-paper-50">
        <AnimatedNumber value={value} />
      </p>
      <StackedMeter segments={segments} total={segments.reduce((a, s) => a + s.value, 0)} />
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-umber-600 dark:text-umber-300">
        {breakdown.map((b) => (
          <span key={b.label} className="inline-flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${b.dot}`} aria-hidden="true" />
            {b.label}
          </span>
        ))}
      </p>
      {alert && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-blush-600 dark:text-blush-300">
          <TriangleAlert size={13} aria-hidden="true" className="shrink-0" />
          {alert}
        </p>
      )}
    </div>
  );
}

/** The reply, as one glyph in a badge.
 *
 *  It used to be the WORD — "Jön" / "Függőben" — in a coloured pill, and on a
 *  phone that word was the widest thing on the row: it shoved the two channel
 *  chips aside and turned a list of names into a column of badges to scroll
 *  past rather than names to scan. The glyph answers the same question in
 *  18px, and the badge keeps the three things that keep it legible — a SHAPE
 *  that differs per answer (so nothing is carried by colour alone), the colour
 *  itself, and the full word as the accessible name plus a tooltip for anyone
 *  who hovers. */
function RsvpStatusIcon({ status }: { status: RsvpStatus }) {
  const { t } = useT();
  const label = t(`guest_invites.rsvp_${status}`);
  const Icon = RSVP_ICON[status];
  return (
    <span
      className={`inline-grid h-8 w-8 shrink-0 place-items-center rounded-full border ${RSVP_SURFACE[status]}`}
      title={label}
    >
      <Icon size={17} strokeWidth={1.75} role="img" aria-label={label} />
    </span>
  );
}

/** Teaches the four glyphs once, under the list. Replacing the word with a
 *  glyph saves each row ~40px, and an un-introduced glyph is a riddle — so the
 *  key sits right under the thing it explains, carrying the same words and the
 *  same dots as the row rails. */
function RsvpLegend() {
  const { t } = useT();
  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5"
      data-testid="gi-rsvp-legend"
    >
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-umber-400 dark:text-umber-500">
        {t("guest_invites.status_legend_label")}
      </span>
      {RSVP_ORDER.map((s) => {
        const Icon = RSVP_ICON[s];
        return (
          <span
            key={s}
            className="inline-flex items-center gap-1.5 text-xs text-umber-600 dark:text-umber-300"
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${RSVP_DOT[s]}`}
              aria-hidden="true"
            />
            <Icon size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
            {t(`guest_invites.rsvp_${s}`)}
          </span>
        );
      })}
    </div>
  );
}

/** One invite channel, toggled by tapping it. A filled sage pill with a check
 *  reads as "done" on sight; the label is always visible text, never an icon
 *  standing alone for the channel — that ambiguity ("what does the handshake
 *  mean?") is exactly what this replaces. */
function ChannelChip({
  label,
  icon: Icon,
  active,
  guestName,
  justToggled,
  onToggle,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  guestName: string;
  /** True only for the chip the couple just pressed. The tick pops on the
   *  ACTION and never on arrival: a list that re-plays its own finished work
   *  on every load is a list that says the work is still happening. */
  justToggled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${guestName}: ${label}`}
      title={label}
      onClick={onToggle}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors active:scale-95 ${
        active
          ? "border-sage-300 bg-sage-100 text-sage-700 dark:border-sage-400/40 dark:bg-sage-900/30 dark:text-sage-300"
          : "border-paper-300 bg-white text-umber-500 hover:border-umber-400 hover:text-umber-800 dark:border-umber-700 dark:bg-umber-900 dark:text-umber-400 dark:hover:border-umber-500 dark:hover:text-umber-100"
      }`}
    >
      {active ? (
        <Check
          size={13}
          strokeWidth={2.5}
          aria-hidden="true"
          className={justToggled ? "animate-tick-pop motion-reduce:animate-none" : undefined}
        />
      ) : (
        <Icon size={13} strokeWidth={1.5} aria-hidden="true" />
      )}
      {label}
    </button>
  );
}

/** The standalone page is now only a thin shell (kept so the component can
 *  be exercised on its own); the route itself redirects to the guest list,
 *  which embeds the same center under its "invited" lens. */
export default function GuestInvitesPage() {
  return <GuestInvitesCenter />;
}

/** Guest invitations and communication: monitoring, the per-guest channel
 *  list, the three composers and the broadcast history. Merged into
 *  `/app/guests?household=closed&invited=1` (owner direction), where it renders
 *  `embedded`: no full-screen header, no back link, no page title. */
export function GuestInvitesCenter({
  embedded = false,
  onGuestsChanged,
}: {
  embedded?: boolean;
  /** A channel toggle here changes a guest row the host page also renders. */
  onGuestsChanged?: () => void;
}) {
  const { t, locale } = useT();
  const confirm = useConfirm();
  const toast = useToast();

  const [guests, setGuests] = useState<Guest[]>([]);
  const [couple, setCouple] = useState<Couple | null>(null);
  const [messages, setMessages] = useState<GuestMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const loadGuests = useCallback(async () => {
    const r = await guestApi.list();
    setGuests(r.guests);
  }, []);

  const loadMessages = useCallback(async () => {
    const r = await guestMessageApi.list();
    setMessages(r.messages);
  }, []);

  useEffect(() => {
    Promise.all([guestApi.list(), coupleApi.current(), guestMessageApi.list()])
      .then(([g, c, m]) => {
        setGuests(g.guests);
        setCouple(c.couple);
        setMessages(m.messages);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // The couple themselves and any suppliers on the list are not invitees.
  const eligible = useMemo(
    () => guests.filter((g) => !g.is_supplier && g.partner_role === null),
    [guests],
  );

  /** Headcount per audience, shown on the picker pills so the couple can see
   *  who a broadcast reaches before sending it. Mirrors the server's
   *  `resolveRecipients`: an address is required (a guest without one cannot be
   *  mailed at all) and one address counts once, however many rows carry it. */
  const audienceCounts = useMemo<AudienceCounts>(() => {
    const all = new Set<string>();
    const pending = new Set<string>();
    const confirmed = new Set<string>();
    for (const g of eligible) {
      const key = (g.email ?? "").trim().toLowerCase();
      if (!key) continue;
      all.add(key);
      if (g.rsvp_status === "pending" || g.rsvp_status === "maybe") pending.add(key);
      else if (g.rsvp_status === "yes") confirmed.add(key);
    }
    return { all: all.size, pending: pending.size, confirmed: confirmed.size };
  }, [eligible]);

  const stats = useMemo(() => {
    let adults = 0;
    let children = 0;
    let babies = 0;
    let online = 0;
    let physical = 0;
    let both = 0;
    let notInvited = 0;
    let yes = 0;
    let no = 0;
    let maybe = 0;
    let pending = 0;
    let awaiting = 0;
    let responded = 0;
    for (const g of eligible) {
      if (g.kind === "adult") adults += 1;
      else if (g.kind === "child") children += 1;
      else if (g.kind === "baby") babies += 1;

      const on = g.invited_online_at !== null;
      const ph = g.invited_physical_at !== null;
      if (on) online += 1;
      if (ph) physical += 1;
      if (on && ph) both += 1;
      if (!on && !ph) notInvited += 1;

      if (g.rsvp_status === "yes") yes += 1;
      else if (g.rsvp_status === "no") no += 1;
      else if (g.rsvp_status === "maybe") maybe += 1;
      else pending += 1;

      const bucket = guestBucket(g);
      if (bucket === "awaiting") awaiting += 1;
      else if (bucket === "responded") responded += 1;
    }
    return {
      total: eligible.length,
      adults,
      children,
      babies,
      online,
      physical,
      both,
      notInvited,
      yes,
      no,
      maybe,
      pending,
      awaiting,
      responded,
    };
  }, [eligible]);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>(readStoredSort);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [rsvpFilter, setRsvpFilter] = useState<ReadonlySet<RsvpStatus>>(() => new Set());
  const [channelFilter, setChannelFilter] = useState<ReadonlySet<ChannelState>>(() => new Set());
  const [kindFilter, setKindFilter] = useState<ReadonlySet<GuestKind>>(() => new Set());
  const [mailableFilter, setMailableFilter] = useState<ReadonlySet<Mailable>>(() => new Set());
  /** The one chip the couple just pressed, so its tick can pop. Cleared on a
   *  timer, and the timer is torn down with the page so a pending setState can
   *  never land on an unmounted tree. */
  const [justToggled, setJustToggled] = useState<string | null>(null);
  const toggleTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (toggleTimerRef.current !== null) window.clearTimeout(toggleTimerRef.current);
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SORT_STORAGE_KEY, sort);
    } catch {
      // A browser refusing storage is not a reason to break the page; the
      // order simply does not survive the reload.
    }
  }, [sort]);

  const filterCount: Record<StatusFilter, number> = {
    all: stats.total,
    not_invited: stats.notInvited,
    awaiting: stats.awaiting,
    responded: stats.responded,
  };

  /** Headcount per chip in the filter panel. Every group is a PARTITION of the
   *  guest list, so the three numbers in a row add up to the total — a chip
   *  whose count could not be reconciled with its neighbours would be a chip
   *  nobody can trust enough to filter by. */
  const filterCounts = useMemo(() => {
    const rsvp: Record<RsvpStatus, number> = { pending: 0, yes: 0, no: 0, maybe: 0 };
    const channel: Record<ChannelState, number> = { none: 0, one: 0, both: 0 };
    const kind: Record<GuestKind, number> = { adult: 0, child: 0, baby: 0 };
    const mailable: Record<Mailable, number> = { yes: 0, no: 0 };
    for (const g of eligible) {
      rsvp[g.rsvp_status] += 1;
      channel[channelState(g)] += 1;
      kind[g.kind] += 1;
      mailable[isMailable(g)] += 1;
    }
    return { rsvp, channel, kind, mailable };
  }, [eligible]);

  const activeFilterCount =
    rsvpFilter.size + channelFilter.size + kindFilter.size + mailableFilter.size;

  function clearAllFilters() {
    setRsvpFilter(new Set());
    setChannelFilter(new Set());
    setKindFilter(new Set());
    setMailableFilter(new Set());
  }

  /** Filtered by the pipeline bucket, the four filter groups and the name
   *  search — then ordered, and only ordered if the couple picked an order.
   *
   *  `list` returns the array UNTOUCHED. That is the whole point: the server
   *  already hands the rows over in a stable `created_at ASC`, so preserving
   *  that order is what keeps a row exactly where it was while its status
   *  changes underneath. Sorting it again, even stably, would re-derive the
   *  order from state the couple never asked to sort by. */
  const visibleGuests = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = eligible.filter((g) => {
      if (statusFilter !== "all" && guestBucket(g) !== statusFilter) return false;
      if (rsvpFilter.size > 0 && !rsvpFilter.has(g.rsvp_status)) return false;
      if (channelFilter.size > 0 && !channelFilter.has(channelState(g))) return false;
      if (kindFilter.size > 0 && !kindFilter.has(g.kind)) return false;
      if (mailableFilter.size > 0 && !mailableFilter.has(isMailable(g))) return false;
      if (q && !g.full_name.toLowerCase().includes(q)) return false;
      return true;
    });
    if (sort === "list") return filtered;
    const byName = (a: Guest, b: Guest) => a.full_name.localeCompare(b.full_name, locale);
    if (sort === "name") return [...filtered].sort(byName);
    return [...filtered].sort((a, b) => {
      const d = BUCKET_ORDER[guestBucket(a)] - BUCKET_ORDER[guestBucket(b)];
      return d !== 0 ? d : byName(a, b);
    });
  }, [
    eligible,
    statusFilter,
    rsvpFilter,
    channelFilter,
    kindFilter,
    mailableFilter,
    query,
    sort,
    locale,
  ]);

  async function toggleChannel(guest: Guest, channel: "online" | "physical") {
    try {
      const body =
        channel === "online"
          ? { invited_online: guest.invited_online_at === null }
          : { invited_physical: guest.invited_physical_at === null };
      await guestApi.update(guest.id, body);
      const key = `${guest.id}:${channel}`;
      setJustToggled(key);
      if (toggleTimerRef.current !== null) window.clearTimeout(toggleTimerRef.current);
      toggleTimerRef.current = window.setTimeout(() => {
        setJustToggled((c) => (c === key ? null : c));
      }, 450);
      await loadGuests();
      onGuestsChanged?.();
    } catch {
      toast.error(t("common.error_generic"));
    }
  }

  async function handleCancel(id: number) {
    const ok = await confirm({
      title: t("guest_invites.cancel_confirm_title"),
      body: t("guest_invites.cancel_confirm_body"),
      confirmLabel: t("guest_invites.cancel_confirm_yes"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    try {
      await guestMessageApi.cancel(id);
      toast.success(t("guest_invites.cancel_success"));
      await loadMessages();
    } catch {
      toast.error(t("common.error_generic"));
    }
  }

  const onSent = useCallback(() => {
    void loadMessages();
  }, [loadMessages]);

  return (
    <div className={embedded ? "mb-8" : "min-h-screen bg-paper-50 dark:bg-umber-950"}>
      {!embedded && (
        <header className="sticky top-0 z-30 border-b border-paper-300 bg-paper-50/85 backdrop-blur dark:border-umber-700 dark:bg-umber-900/85">
          <div className="mx-auto flex max-w-5xl items-center px-4 py-3 sm:px-6 lg:px-8 xl:px-10">
            <Link
              to="/app/guests"
              className="inline-flex h-11 items-center gap-2 text-sm text-umber-700 transition-colors hover:text-umber-900 dark:text-umber-200 dark:hover:text-paper-50"
            >
              <ArrowLeft size={16} aria-hidden="true" />
              {t("guest_invites.back_to_guests")}
            </Link>
          </div>
        </header>
      )}

      <main
        className={embedded ? undefined : "mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8 xl:px-10"}
      >
        {/* The page's own explanation lives behind the "i" rather than as a
            paragraph under every heading — the same treatment the three
            composer cards get. */}
        {!embedded && (
          <div className="flex items-center gap-2">
            <h1 className="font-grotesk text-3xl font-semibold text-umber-900 dark:text-paper-50 sm:text-4xl">
              {t("guest_invites.title")}
            </h1>
            <InfoHint
              text={t("guest_invites.subtitle")}
              className="text-umber-500 dark:text-umber-300"
            />
          </div>
        )}

        {loading ? (
          <div className="mt-8 flex flex-col gap-4">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <>
            {/* ── A) Monitoring ── */}
            <section className={embedded ? undefined : "mt-6"}>
              <h2 className="font-grotesk text-xl font-semibold text-umber-900 dark:text-paper-50">
                {t("guest_invites.monitoring_title")}
              </h2>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <KpiTile
                  index={0}
                  icon={Users}
                  label={t("guest_invites.guests_section_title")}
                  value={stats.total}
                  segments={[
                    { key: "adult", value: stats.adults, className: KIND_DOT.adult },
                    { key: "child", value: stats.children, className: KIND_DOT.child },
                    { key: "baby", value: stats.babies, className: KIND_DOT.baby },
                  ]}
                  breakdown={[
                    {
                      dot: KIND_DOT.adult,
                      label: `${stats.adults} ${t("guest_invites.stat_adults")}`,
                    },
                    {
                      dot: KIND_DOT.child,
                      label: `${stats.children} ${t("guest_invites.stat_children")}`,
                    },
                    {
                      dot: KIND_DOT.baby,
                      label: `${stats.babies} ${t("guest_invites.stat_babies")}`,
                    },
                  ]}
                />
                <KpiTile
                  index={1}
                  icon={Send}
                  label={t("guest_invites.channel_section_title")}
                  value={stats.total - stats.notInvited}
                  segments={CHANNEL_STATES.map((c) => ({
                    key: c,
                    value: filterCounts.channel[c],
                    className: CHANNEL_DOT[c],
                  }))}
                  breakdown={CHANNEL_STATES.map((c) => ({
                    dot: CHANNEL_DOT[c],
                    label: `${filterCounts.channel[c]} ${t(CHANNEL_FILTER_KEY[c])}`,
                  }))}
                  alert={
                    stats.notInvited > 0
                      ? t("guest_invites.not_invited_alert", { count: stats.notInvited })
                      : undefined
                  }
                />
                <KpiTile
                  index={2}
                  icon={CheckCheck}
                  label={t("guest_invites.rsvp_title")}
                  value={stats.yes}
                  segments={RSVP_ORDER.map((s) => ({
                    key: s,
                    value: filterCounts.rsvp[s],
                    className: RSVP_DOT[s],
                  }))}
                  breakdown={RSVP_ORDER.map((s) => ({
                    dot: RSVP_DOT[s],
                    label: `${filterCounts.rsvp[s]} ${t(`guest_invites.rsvp_${s}`)}`,
                  }))}
                  alert={
                    stats.pending > 0
                      ? t("guest_invites.pending_alert", { count: stats.pending })
                      : undefined
                  }
                />
              </div>

              {/* Filter + search — a pipeline the couple can actually work
                  from, not just a number. The order picker sits next to the
                  filters rather than buried under them because the ORDER is a
                  first-class choice here: the default deliberately does not
                  move rows, and that is a promise worth being able to break
                  deliberately. */}
              {eligible.length > 0 && (
                <div className="mt-5 flex flex-col gap-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <SegmentedControl
                      size="sm"
                      ariaLabel={t("guest_invites.filter_label")}
                      value={statusFilter}
                      onChange={setStatusFilter}
                      options={FILTERS.map((f) => ({
                        value: f,
                        label: `${t(f === "not_invited" ? "guest_invites.not_invited" : `guest_invites.filter_${f}`)} ${filterCount[f]}`,
                      }))}
                    />
                    <div className="ml-auto flex shrink-0 items-center gap-2">
                      <ViewSelect
                        compact
                        ariaLabel={t("guest_invites.sort_label")}
                        value={sort}
                        onChange={setSort}
                        options={[
                          {
                            value: "list",
                            label: t("guest_invites.sort_list"),
                            icon: <Inbox size={14} aria-hidden="true" />,
                          },
                          {
                            value: "attention",
                            label: t("guest_invites.sort_attention"),
                            icon: <TriangleAlert size={14} aria-hidden="true" />,
                          },
                          {
                            value: "name",
                            label: t("guest_invites.sort_name"),
                            icon: <ArrowUpDown size={14} aria-hidden="true" />,
                          },
                        ]}
                      />
                      <button
                        type="button"
                        className="btn-outline shrink-0 px-3"
                        onClick={() => setFiltersOpen((o) => !o)}
                        aria-expanded={filtersOpen}
                        aria-label={t("guest_invites.filters_button")}
                      >
                        <Filter size={14} aria-hidden="true" />
                        <span className="hidden sm:inline">
                          {t("guest_invites.filters_button")}
                        </span>
                        {activeFilterCount > 0 && (
                          <span className="ml-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-umber-900 px-1.5 text-xs text-paper-50 dark:bg-paper-100 dark:text-umber-900">
                            {activeFilterCount}
                          </span>
                        )}
                      </button>
                    </div>
                  </div>

                  <ExpandingSearch
                    value={query}
                    onChange={setQuery}
                    placeholder={t("guest_invites.search_placeholder")}
                    ariaLabel={t("guest_invites.search_label")}
                    clearLabel={t("guests.search_clear")}
                    openClassName="w-full sm:max-w-xs"
                  />

                  {filtersOpen && (
                    <div className="animate-fade-in-up flex flex-col gap-2.5 rounded-xl border border-paper-300 bg-paper-50/60 p-3 motion-reduce:animate-none dark:border-umber-700 dark:bg-umber-900/40">
                      <FilterGroup label={t("guest_invites.filters_group_reply")}>
                        {RSVP_ORDER.map((s) => {
                          const Icon = RSVP_ICON[s];
                          return (
                            <TagChip
                              key={s}
                              label={`${t(`guest_invites.rsvp_${s}`)} ${filterCounts.rsvp[s]}`}
                              icon={<Icon size={13} strokeWidth={1.75} aria-hidden="true" />}
                              selected={rsvpFilter.has(s)}
                              onToggle={() => setRsvpFilter((p) => toggleIn(p, s))}
                            />
                          );
                        })}
                      </FilterGroup>
                      <FilterGroup label={t("guest_invites.filters_group_channel")}>
                        {CHANNEL_STATES.map((c) => {
                          const Icon = CHANNEL_ICON[c];
                          return (
                            <TagChip
                              key={c}
                              label={`${t(CHANNEL_FILTER_KEY[c])} ${filterCounts.channel[c]}`}
                              icon={<Icon size={13} strokeWidth={1.75} aria-hidden="true" />}
                              selected={channelFilter.has(c)}
                              onToggle={() => setChannelFilter((p) => toggleIn(p, c))}
                            />
                          );
                        })}
                      </FilterGroup>
                      <FilterGroup label={t("guest_invites.filters_group_kind")}>
                        {(Object.keys(KIND_ICON) as GuestKind[]).map((k) => {
                          const Icon = KIND_ICON[k];
                          return (
                            <TagChip
                              key={k}
                              label={`${t(`guest_invites.stat_${k}`)} ${filterCounts.kind[k]}`}
                              icon={<Icon size={13} strokeWidth={1.75} aria-hidden="true" />}
                              selected={kindFilter.has(k)}
                              onToggle={() => setKindFilter((p) => toggleIn(p, k))}
                            />
                          );
                        })}
                      </FilterGroup>
                      <FilterGroup label={t("guest_invites.filters_group_mailable")}>
                        {MAILABLES.map((m) => (
                          <TagChip
                            key={m}
                            label={`${t(`guest_invites.filter_mailable_${m}`)} ${filterCounts.mailable[m]}`}
                            icon={
                              m === "yes" ? (
                                <Mail size={13} strokeWidth={1.75} aria-hidden="true" />
                              ) : (
                                <MailX size={13} strokeWidth={1.75} aria-hidden="true" />
                              )
                            }
                            selected={mailableFilter.has(m)}
                            onToggle={() => setMailableFilter((p) => toggleIn(p, m))}
                          />
                        ))}
                      </FilterGroup>
                    </div>
                  )}

                  {activeFilterCount > 0 && (
                    <div
                      className="flex flex-wrap items-center gap-2"
                      data-testid="gi-active-filters"
                    >
                      {[...rsvpFilter].map((s) => {
                        const Icon = RSVP_ICON[s];
                        return (
                          <TagChip
                            key={`r-${s}`}
                            label={`${t(`guest_invites.rsvp_${s}`)} ${filterCounts.rsvp[s]}`}
                            icon={<Icon size={13} strokeWidth={1.75} aria-hidden="true" />}
                            selected
                            removable
                            onRemove={() => setRsvpFilter((p) => toggleIn(p, s))}
                          />
                        );
                      })}
                      {[...channelFilter].map((c) => {
                        const Icon = CHANNEL_ICON[c];
                        return (
                          <TagChip
                            key={`c-${c}`}
                            label={`${t(CHANNEL_FILTER_KEY[c])} ${filterCounts.channel[c]}`}
                            icon={<Icon size={13} strokeWidth={1.75} aria-hidden="true" />}
                            selected
                            removable
                            onRemove={() => setChannelFilter((p) => toggleIn(p, c))}
                          />
                        );
                      })}
                      {[...kindFilter].map((k) => {
                        const Icon = KIND_ICON[k];
                        return (
                          <TagChip
                            key={`k-${k}`}
                            label={`${t(`guest_invites.stat_${k}`)} ${filterCounts.kind[k]}`}
                            icon={<Icon size={13} strokeWidth={1.75} aria-hidden="true" />}
                            selected
                            removable
                            onRemove={() => setKindFilter((p) => toggleIn(p, k))}
                          />
                        );
                      })}
                      {[...mailableFilter].map((m) => (
                        <TagChip
                          key={`m-${m}`}
                          label={`${t(`guest_invites.filter_mailable_${m}`)} ${filterCounts.mailable[m]}`}
                          icon={
                            m === "yes" ? (
                              <Mail size={13} strokeWidth={1.75} aria-hidden="true" />
                            ) : (
                              <MailX size={13} strokeWidth={1.75} aria-hidden="true" />
                            )
                          }
                          selected
                          removable
                          onRemove={() => setMailableFilter((p) => toggleIn(p, m))}
                        />
                      ))}
                      <button
                        type="button"
                        className="text-sm text-umber-500 underline underline-offset-2 hover:text-umber-900 dark:text-umber-300 dark:hover:text-paper-50"
                        onClick={clearAllFilters}
                      >
                        {t("guest_invites.filters_clear_all")}
                      </button>
                    </div>
                  )}

                  {sort === "list" && (
                    <p className="flex items-center gap-1.5 text-xs text-umber-500 dark:text-umber-400">
                      <Inbox size={13} aria-hidden="true" className="shrink-0" />
                      {t("guest_invites.sort_stable_note")}
                    </p>
                  )}
                </div>
              )}

              {/* Per-guest list */}
              <div className="mt-3 overflow-hidden rounded-xl border border-paper-300 dark:border-umber-700">
                {eligible.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 px-4 py-10">
                    <Users
                      size={20}
                      aria-hidden="true"
                      className="text-umber-300 dark:text-umber-600"
                      strokeWidth={1.5}
                    />
                    <p className="text-sm text-umber-500 dark:text-umber-400">
                      {t("guest_invites.table_empty")}
                    </p>
                  </div>
                ) : visibleGuests.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 px-4 py-10">
                    <Search
                      size={20}
                      aria-hidden="true"
                      className="text-umber-300 dark:text-umber-600"
                      strokeWidth={1.5}
                    />
                    <p className="text-sm text-umber-500 dark:text-umber-400">
                      {t("guest_invites.list_empty_filtered")}
                    </p>
                  </div>
                ) : (
                  <ul
                    className="divide-y divide-paper-200 dark:divide-umber-800"
                    data-testid="gi-guest-list"
                  >
                    {visibleGuests.map((g, i) => {
                      const onlineOn = g.invited_online_at !== null;
                      const physicalOn = g.invited_physical_at !== null;
                      const initial = g.full_name.trim().charAt(0).toUpperCase() || "?";
                      return (
                        <li
                          key={g.id}
                          className="relative animate-fade-in-up pl-[3px] motion-reduce:animate-none"
                          style={{ animationDelay: `${staggerMs(i)}ms` }}
                          data-testid="gi-guest-row"
                        >
                          {/* The answer, as a rail down the edge of the row. One
                              glance down a 60-guest list then reads as a
                              colour run — the same colour the badge and the
                              legend use, so it is learned once. Decorative:
                              the badge in the row carries the same fact with
                              the same accessible name. */}
                          <span
                            aria-hidden="true"
                            className={`absolute inset-y-0 left-0 w-[3px] ${RSVP_DOT[g.rsvp_status]}`}
                          />
                          <div className="flex flex-col gap-2.5 py-3 pl-3 pr-4 sm:flex-row sm:items-center sm:gap-4">
                            <div className="flex min-w-0 flex-1 items-center gap-3">
                              <span
                                aria-hidden="true"
                                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-paper-200 font-grotesk text-sm font-semibold text-umber-700 dark:bg-umber-800 dark:text-umber-200"
                              >
                                {initial}
                              </span>
                              <div className="min-w-0">
                                <p
                                  className="truncate font-medium text-umber-900 dark:text-paper-50"
                                  data-testid="gi-guest-name"
                                >
                                  {g.full_name}
                                </p>
                                <p className="text-xs text-umber-500 dark:text-umber-400">
                                  {g.rsvp_responded_at !== null
                                    ? formatTimestamp(g.rsvp_responded_at, locale)
                                    : t("guest_invites.responded_never")}
                                </p>
                              </div>
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                              <ChannelChip
                                label={t("guest_invites.channel_online")}
                                icon={Mail}
                                active={onlineOn}
                                guestName={g.full_name}
                                justToggled={justToggled === `${g.id}:online`}
                                onToggle={() => void toggleChannel(g, "online")}
                              />
                              <ChannelChip
                                label={t("guest_invites.channel_physical")}
                                icon={Handshake}
                                active={physicalOn}
                                guestName={g.full_name}
                                justToggled={justToggled === `${g.id}:physical`}
                                onToggle={() => void toggleChannel(g, "physical")}
                              />
                              <RsvpStatusIcon status={g.rsvp_status} />
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {visibleGuests.length > 0 && <RsvpLegend />}
            </section>

            {/* ── B) Communication ── */}
            <section className="mt-10">
              <h2 className="font-grotesk text-xl font-semibold text-umber-900 dark:text-paper-50">
                {t("guest_invites.comm_title")}
              </h2>

              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <InviteCard counts={audienceCounts} onSent={onSent} />
                <MajorUpdateCard counts={audienceCounts} onSent={onSent} />
                <PreWeddingCard couple={couple} counts={audienceCounts} onSent={onSent} />
              </div>

              {/* Past + scheduled broadcasts */}
              <h3 className="mt-8 font-grotesk text-lg font-semibold text-umber-900 dark:text-paper-50">
                {t("guest_invites.broadcasts_title")}
              </h3>
              {messages.length === 0 ? (
                <div className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-paper-300 px-4 py-10 dark:border-umber-700">
                  <Megaphone
                    size={20}
                    aria-hidden="true"
                    className="text-umber-300 dark:text-umber-600"
                    strokeWidth={1.5}
                  />
                  <p className="text-sm text-umber-500 dark:text-umber-400">
                    {t("guest_invites.broadcasts_empty")}
                  </p>
                </div>
              ) : (
                <ul className="mt-3 flex flex-col gap-2">
                  {messages.map((m, i) => {
                    const Icon = TEMPLATE_ICON[m.template];
                    const StatusIcon = BROADCAST_ICON[m.status];
                    const statusLabel = t(`guest_invites.status_${m.status}`);
                    return (
                      <li
                        key={m.id}
                        className="animate-card-deal flex flex-wrap items-center justify-between gap-3 rounded-xl border border-paper-300 bg-paper-50 px-4 py-3 motion-reduce:animate-none dark:border-umber-700 dark:bg-umber-900"
                        style={{ animationDelay: `${staggerMs(i, 26)}ms` }}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span
                            aria-hidden="true"
                            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-paper-200 text-umber-600 dark:bg-umber-800 dark:text-umber-200"
                          >
                            <Icon size={16} strokeWidth={1.5} />
                          </span>
                          <div className="min-w-0">
                            <p className="font-medium text-umber-900 dark:text-paper-50">
                              {t(`guest_invites.template_${m.template}`)}
                            </p>
                            <p className="mt-0.5 text-xs text-umber-500 dark:text-umber-400">
                              {t(`guest_invites.audience_${m.audience}`)}
                              {" · "}
                              {t("guest_invites.recipients", { count: m.recipient_count })}
                              {" · "}
                              {m.status === "scheduled" && m.scheduled_at !== null
                                ? t("guest_invites.scheduled_for", {
                                    date: formatTimestamp(m.scheduled_at, locale),
                                  })
                                : m.sent_at !== null
                                  ? t("guest_invites.sent_on", {
                                      date: formatTimestamp(m.sent_at, locale),
                                    })
                                  : statusLabel}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          {/* Same treatment as the guest rows: a shape, a
                              colour, and the full word as the accessible name.
                              `sending` is the one status that MOVES, so it is
                              the one that gets a spinner — the only animated
                              glyph on the page that is reporting work still in
                              flight. */}
                          <span
                            className={`inline-grid h-8 w-8 place-items-center rounded-full ${BROADCAST_SURFACE[m.status]}`}
                            title={statusLabel}
                          >
                            <StatusIcon
                              size={16}
                              strokeWidth={1.75}
                              role="img"
                              aria-label={statusLabel}
                              className={
                                m.status === "sending"
                                  ? "animate-spin motion-reduce:animate-none"
                                  : undefined
                              }
                            />
                          </span>
                          {m.status === "scheduled" && (
                            <button
                              type="button"
                              aria-label={t("guest_invites.cancel_button")}
                              title={t("guest_invites.cancel_button")}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-umber-500 transition-colors hover:bg-paper-200 hover:text-umber-900 dark:text-umber-300 dark:hover:bg-umber-800 dark:hover:text-paper-50"
                              onClick={() => void handleCancel(m.id)}
                            >
                              <X size={16} aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
