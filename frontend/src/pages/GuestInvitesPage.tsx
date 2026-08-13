import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  CalendarClock,
  Check,
  CheckCheck,
  Clock3,
  Coins,
  Mail,
  Megaphone,
  Pencil,
  Search,
  Send,
  Sparkles,
  TriangleAlert,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import type {
  Couple,
  EnvelopeTip,
  Guest,
  GuestMessage,
  GuestMessageAudience,
  GuestMessageTemplate,
  RsvpStatus,
} from "@shared/types";
import {
  type ConfirmOptions,
  SegmentedControl,
  Skeleton,
  Switch,
  useConfirm,
  useToast,
} from "../components/ui";
import { InfoHint } from "../components/InfoHint";
import { coupleApi, guestApi, guestMessageApi } from "../lib/endpoints";
import { formatMoney, formatTimestamp } from "../lib/format";
import { useT } from "../lib/i18n";

const AUDIENCES: GuestMessageAudience[] = ["all", "pending", "confirmed"];

/** Where a guest sits in the invite pipeline: nobody has been told yet, they
 *  were told and haven't answered, or they answered (yes/no/maybe all count —
 *  a decline is still a decision, unlike "pending"). Drives both the filter
 *  pills and the default sort, so the two can never disagree about what
 *  "needs attention" means. */
type GuestBucket = "not_invited" | "awaiting" | "responded";
type StatusFilter = "all" | GuestBucket;
const FILTERS: StatusFilter[] = ["all", "not_invited", "awaiting", "responded"];
const BUCKET_ORDER: Record<GuestBucket, number> = { not_invited: 0, awaiting: 1, responded: 2 };

function guestBucket(g: Guest): GuestBucket {
  const invited = g.invited_online_at !== null || g.invited_physical_at !== null;
  if (!invited) return "not_invited";
  return g.rsvp_status === "pending" ? "awaiting" : "responded";
}

/** One glyph per audience, so the picker can be three small pills carrying the
 *  HEADCOUNT rather than three long labels that scroll off a narrow card. */
const AUDIENCE_ICON: Record<GuestMessageAudience, LucideIcon> = {
  all: Users,
  pending: Clock3,
  confirmed: CheckCheck,
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
                  <input
                    id="gi_tip_override"
                    type="number"
                    min={0}
                    className="input h-9 min-w-[7rem] flex-1 py-1"
                    aria-label={t("guest_invites.envelope_tip_amount_label")}
                    title={t("guest_invites.envelope_tip_amount_label")}
                    value={overrideInput}
                    onChange={(e) => setOverrideInput(e.target.value)}
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

/** One KPI tile: group icon + label, the headline number, a quiet breakdown
 *  line, and — only when something in this group actually needs the couple's
 *  attention — a highlighted action line. This replaces a cramped inline stat
 *  row with three tiles a CRM dashboard would recognise: what's the number,
 *  what's it made of, and is there anything to do about it. */
function KpiTile({
  icon: Icon,
  label,
  value,
  breakdown,
  alert,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  breakdown: string;
  alert?: string;
}) {
  return (
    <div className="rounded-xl border border-paper-300 bg-paper-50 p-4 dark:border-umber-700 dark:bg-umber-900">
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
        {value}
      </p>
      <p className="mt-1.5 text-xs text-umber-600 dark:text-umber-300">{breakdown}</p>
      {alert && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-blush-600 dark:text-blush-300">
          <TriangleAlert size={13} aria-hidden="true" className="shrink-0" />
          {alert}
        </p>
      )}
    </div>
  );
}

/** RSVP as a coloured badge instead of plain text — colour + label together
 *  (never colour alone), matching the badge language the guest list itself
 *  uses. "Maybe" gets its own tone rather than sharing pending's, since a
 *  declared "talán" is a different fact from silence. */
function RsvpStatusBadge({ status }: { status: RsvpStatus }) {
  const { t } = useT();
  const cls =
    status === "yes"
      ? "border-sage-200 bg-sage-100 text-sage-700 dark:border-sage-400/30 dark:bg-sage-900/30 dark:text-sage-300"
      : status === "no"
        ? "border-blush-200 bg-blush-50 text-blush-700 dark:border-blush-400/30 dark:bg-blush-900/30 dark:text-blush-300"
        : status === "maybe"
          ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-900/30 dark:text-amber-300"
          : "border-dashed border-paper-300 bg-paper-100 text-umber-500 dark:border-umber-600 dark:bg-umber-800 dark:text-umber-400";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-medium ${cls}`}
    >
      {t(`guest_invites.rsvp_${status}`)}
    </span>
  );
}

/** One invite channel, toggled by tapping it. A filled sage pill with a check
 *  reads as "done" on sight; the label is always visible text, never an icon
 *  standing alone for the channel — that ambiguity ("what does the handshake
 *  mean?") is exactly what this replaces. */
function ChannelChip({
  label,
  active,
  guestName,
  onToggle,
}: {
  label: string;
  active: boolean;
  guestName: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${guestName}: ${label}`}
      title={label}
      onClick={onToggle}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-sage-300 bg-sage-100 text-sage-700 dark:border-sage-400/40 dark:bg-sage-900/30 dark:text-sage-300"
          : "border-paper-300 bg-white text-umber-500 hover:border-umber-400 hover:text-umber-800 dark:border-umber-700 dark:bg-umber-900 dark:text-umber-400 dark:hover:border-umber-500 dark:hover:text-umber-100"
      }`}
    >
      {active && <Check size={11} aria-hidden="true" />}
      {label}
    </button>
  );
}

/** `/app/invites` — full-screen guest invitations & communication center. */
export default function GuestInvitesPage() {
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

  const filterCount: Record<StatusFilter, number> = {
    all: stats.total,
    not_invited: stats.notInvited,
    awaiting: stats.awaiting,
    responded: stats.responded,
  };

  /** Filtered by pipeline bucket + name search, then sorted actionable-first
   *  (not yet invited, then awaiting reply, then responded) so the guests who
   *  need something from the couple surface at the top of "Mind" without
   *  requiring a filter tap. */
  const visibleGuests = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = eligible.filter((g) => {
      if (statusFilter !== "all" && guestBucket(g) !== statusFilter) return false;
      if (q && !g.full_name.toLowerCase().includes(q)) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      const d = BUCKET_ORDER[guestBucket(a)] - BUCKET_ORDER[guestBucket(b)];
      return d !== 0 ? d : a.full_name.localeCompare(b.full_name, locale);
    });
  }, [eligible, statusFilter, query, locale]);

  async function toggleChannel(guest: Guest, channel: "online" | "physical") {
    try {
      const body =
        channel === "online"
          ? { invited_online: guest.invited_online_at === null }
          : { invited_physical: guest.invited_physical_at === null };
      await guestApi.update(guest.id, body);
      await loadGuests();
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
    <div className="min-h-screen bg-paper-50 dark:bg-umber-950">
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

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8 xl:px-10">
        {/* The page's own explanation lives behind the "i" rather than as a
            paragraph under every heading — the same treatment the three
            composer cards get. */}
        <div className="flex items-center gap-2">
          <h1 className="font-grotesk text-3xl font-semibold text-umber-900 dark:text-paper-50 sm:text-4xl">
            {t("guest_invites.title")}
          </h1>
          <InfoHint
            text={t("guest_invites.subtitle")}
            className="text-umber-500 dark:text-umber-300"
          />
        </div>

        {loading ? (
          <div className="mt-8 flex flex-col gap-4">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <>
            {/* ── A) Monitoring ── */}
            <section className="mt-6">
              <h2 className="font-grotesk text-xl font-semibold text-umber-900 dark:text-paper-50">
                {t("guest_invites.monitoring_title")}
              </h2>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <KpiTile
                  icon={Users}
                  label={t("guest_invites.guests_section_title")}
                  value={stats.total}
                  breakdown={`${stats.adults} ${t("guest_invites.stat_adults").toLowerCase()} · ${stats.children} ${t("guest_invites.stat_children").toLowerCase()} · ${stats.babies} ${t("guest_invites.stat_babies").toLowerCase()}`}
                />
                <KpiTile
                  icon={Send}
                  label={t("guest_invites.channel_section_title")}
                  value={stats.total - stats.notInvited}
                  breakdown={`${stats.online} ${t("guest_invites.invited_online").toLowerCase()} · ${stats.physical} ${t("guest_invites.invited_physical").toLowerCase()}`}
                  alert={
                    stats.notInvited > 0
                      ? t("guest_invites.not_invited_alert", { count: stats.notInvited })
                      : undefined
                  }
                />
                <KpiTile
                  icon={CheckCheck}
                  label={t("guest_invites.rsvp_title")}
                  value={stats.yes}
                  breakdown={`${stats.no} ${t("guest_invites.rsvp_no").toLowerCase()} · ${stats.maybe} ${t("guest_invites.rsvp_maybe").toLowerCase()}`}
                  alert={
                    stats.pending > 0
                      ? t("guest_invites.pending_alert", { count: stats.pending })
                      : undefined
                  }
                />
              </div>

              {/* Filter + search — a pipeline the couple can actually work
                  from, not just a number. */}
              {eligible.length > 0 && (
                <div className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
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
                  <div className="relative w-full sm:w-56">
                    <Search
                      size={14}
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-umber-400"
                    />
                    <input
                      type="search"
                      className="input h-9 py-1 pl-9"
                      placeholder={t("guest_invites.search_placeholder")}
                      aria-label={t("guest_invites.search_label")}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* Per-guest list */}
              <div className="mt-3 overflow-hidden rounded-xl border border-paper-300 dark:border-umber-700">
                {eligible.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-umber-500 dark:text-umber-400">
                    {t("guest_invites.table_empty")}
                  </p>
                ) : visibleGuests.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-umber-500 dark:text-umber-400">
                    {t("guest_invites.list_empty_filtered")}
                  </p>
                ) : (
                  <ul className="divide-y divide-paper-200 dark:divide-umber-800">
                    {visibleGuests.map((g) => {
                      const onlineOn = g.invited_online_at !== null;
                      const physicalOn = g.invited_physical_at !== null;
                      const initial = g.full_name.trim().charAt(0).toUpperCase() || "?";
                      return (
                        <li
                          key={g.id}
                          className="flex flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <span
                              aria-hidden="true"
                              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-paper-200 font-grotesk text-sm font-semibold text-umber-700 dark:bg-umber-800 dark:text-umber-200"
                            >
                              {initial}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-umber-900 dark:text-paper-50">
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
                              active={onlineOn}
                              guestName={g.full_name}
                              onToggle={() => void toggleChannel(g, "online")}
                            />
                            <ChannelChip
                              label={t("guest_invites.channel_physical")}
                              active={physicalOn}
                              guestName={g.full_name}
                              onToggle={() => void toggleChannel(g, "physical")}
                            />
                            <RsvpStatusBadge status={g.rsvp_status} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
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
                <p className="mt-3 rounded-xl border border-paper-300 px-4 py-8 text-center text-sm text-umber-500 dark:border-umber-700 dark:text-umber-400">
                  {t("guest_invites.broadcasts_empty")}
                </p>
              ) : (
                <ul className="mt-3 flex flex-col gap-2">
                  {messages.map((m) => (
                    <li
                      key={m.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-paper-300 bg-paper-50 px-4 py-3 dark:border-umber-700 dark:bg-umber-900"
                    >
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
                              : t(`guest_invites.status_${m.status}`)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            m.status === "sent"
                              ? "bg-sage-100 text-sage-700 dark:bg-sage-900/40 dark:text-sage-300"
                              : m.status === "failed"
                                ? "bg-blush-100 text-blush-700 dark:bg-blush-900/40 dark:text-blush-300"
                                : "bg-paper-200 text-umber-600 dark:bg-umber-800 dark:text-umber-300"
                          }`}
                        >
                          {t(`guest_invites.status_${m.status}`)}
                        </span>
                        {m.status === "scheduled" && (
                          <button
                            type="button"
                            aria-label={t("guest_invites.cancel_confirm_yes")}
                            title={t("guest_invites.cancel_button")}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-umber-500 transition-colors hover:bg-paper-200 hover:text-umber-900 dark:text-umber-300 dark:hover:bg-umber-800 dark:hover:text-paper-50"
                            onClick={() => void handleCancel(m.id)}
                          >
                            <X size={16} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
