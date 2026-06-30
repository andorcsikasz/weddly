import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type {
  Couple,
  EnvelopeTip,
  Guest,
  GuestMessage,
  GuestMessageAudience,
  GuestMessageTemplate,
} from "@shared/types";
import { SegmentedControl, Skeleton, useConfirm, useToast } from "../components/ui";
import { coupleApi, guestApi, guestMessageApi } from "../lib/endpoints";
import { formatMoney, formatTimestamp } from "../lib/format";
import { useT } from "../lib/i18n";

const AUDIENCES: GuestMessageAudience[] = ["all", "pending", "confirmed"];

/** Build the `scheduled_at` epoch-ms (or null for "send now") from the picker. */
function scheduledAtFrom(mode: "now" | "schedule", value: string): number | null {
  if (mode === "now" || !value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Shared audience + send-timing controls reused by all three composer cards. */
function SendControls({
  audience,
  onAudience,
  mode,
  onMode,
  scheduledValue,
  onScheduledValue,
}: {
  audience: GuestMessageAudience;
  onAudience: (a: GuestMessageAudience) => void;
  mode: "now" | "schedule";
  onMode: (m: "now" | "schedule") => void;
  scheduledValue: string;
  onScheduledValue: (v: string) => void;
}) {
  const { t } = useT();
  return (
    <div className="mt-4 flex flex-col gap-4">
      <div>
        <span className="field-label">{t("guest_invites.audience_label")}</span>
        <SegmentedControl
          ariaLabel={t("guest_invites.audience_label")}
          className="mt-1"
          value={audience}
          onChange={onAudience}
          options={AUDIENCES.map((a) => ({
            value: a,
            label: t(`guest_invites.audience_${a}`),
          }))}
        />
      </div>
      <div>
        <span className="field-label">{t("guest_invites.send_mode_label")}</span>
        <SegmentedControl
          ariaLabel={t("guest_invites.send_mode_label")}
          className="mt-1"
          value={mode}
          onChange={onMode}
          options={[
            { value: "now", label: t("guest_invites.send_mode_now") },
            { value: "schedule", label: t("guest_invites.send_mode_schedule") },
          ]}
        />
      </div>
      {mode === "schedule" && (
        <div>
          <label htmlFor="gi_schedule" className="field-label">
            {t("guest_invites.schedule_label")}
          </label>
          <input
            id="gi_schedule"
            type="datetime-local"
            className="input"
            value={scheduledValue}
            onChange={(e) => onScheduledValue(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}

/** ── Invite card ── plain invitation + RSVP link. */
function InviteCard({ onSent }: { onSent: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const [audience, setAudience] = useState<GuestMessageAudience>("pending");
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [scheduledValue, setScheduledValue] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSend() {
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
    <section className="card">
      <h2 className="font-grotesk text-xl font-semibold text-umber-900 dark:text-paper-50">
        {t("guest_invites.template_invite")}
      </h2>
      <p className="mt-1 text-sm text-umber-600 dark:text-umber-300">
        {t("guest_invites.invite_desc")}
      </p>
      <SendControls
        audience={audience}
        onAudience={setAudience}
        mode={mode}
        onMode={setMode}
        scheduledValue={scheduledValue}
        onScheduledValue={setScheduledValue}
      />
      <button
        type="button"
        className="btn-primary mt-5 w-full"
        disabled={sending}
        onClick={() => void handleSend()}
      >
        {sending
          ? t("guest_invites.sending")
          : mode === "now"
            ? t("guest_invites.send_now_button")
            : t("guest_invites.schedule_button")}
      </button>
    </section>
  );
}

/** ── Major update card ── free-form announcement with subject + body. */
function MajorUpdateCard({ onSent }: { onSent: () => void }) {
  const { t } = useT();
  const toast = useToast();
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
    <section className="card">
      <h2 className="font-grotesk text-xl font-semibold text-umber-900 dark:text-paper-50">
        {t("guest_invites.template_major_update")}
      </h2>
      <p className="mt-1 text-sm text-umber-600 dark:text-umber-300">
        {t("guest_invites.major_update_desc")}
      </p>
      <div className="mt-4 flex flex-col gap-4">
        <div>
          <label htmlFor="gi_mu_subject" className="field-label">
            {t("guest_invites.subject_label")}
          </label>
          <input
            id="gi_mu_subject"
            className="input"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={t("guest_invites.subject_placeholder")}
          />
        </div>
        <div>
          <label htmlFor="gi_mu_body" className="field-label">
            {t("guest_invites.body_label")}
          </label>
          <textarea
            id="gi_mu_body"
            className="input min-h-[120px] resize-y"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("guest_invites.body_placeholder")}
          />
        </div>
      </div>
      <SendControls
        audience={audience}
        onAudience={setAudience}
        mode={mode}
        onMode={setMode}
        scheduledValue={scheduledValue}
        onScheduledValue={setScheduledValue}
      />
      <button
        type="button"
        className="btn-primary mt-5 w-full"
        disabled={sending}
        onClick={() => void handleSend()}
      >
        {sending
          ? t("guest_invites.sending")
          : mode === "now"
            ? t("guest_invites.send_now_button")
            : t("guest_invites.schedule_button")}
      </button>
    </section>
  );
}

/** ── Pre-wedding info card ── subject + body + the optional envelope tip. */
function PreWeddingCard({
  couple,
  onSent,
}: {
  couple: Couple | null;
  onSent: () => void;
}) {
  const { t, locale } = useT();
  const toast = useToast();
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

  function handleToggleEnabled() {
    void persistTip({ enabled: !(tip?.enabled ?? false) });
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
    <section className="card">
      <h2 className="font-grotesk text-xl font-semibold text-umber-900 dark:text-paper-50">
        {t("guest_invites.template_pre_wedding_info")}
      </h2>
      <p className="mt-1 text-sm text-umber-600 dark:text-umber-300">
        {t("guest_invites.pre_wedding_desc")}
      </p>
      <div className="mt-4 flex flex-col gap-4">
        <div>
          <label htmlFor="gi_pw_subject" className="field-label">
            {t("guest_invites.subject_label")}
          </label>
          <input
            id="gi_pw_subject"
            className="input"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={t("guest_invites.subject_placeholder")}
          />
        </div>
        <div>
          <label htmlFor="gi_pw_body" className="field-label">
            {t("guest_invites.body_label")}
          </label>
          <textarea
            id="gi_pw_body"
            className="input min-h-[120px] resize-y"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("guest_invites.body_placeholder")}
          />
        </div>
      </div>

      {/* Envelope tip */}
      <div className="mt-5 rounded-xl border border-paper-300 p-4 dark:border-umber-700">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-umber-900 dark:text-paper-50">
              {t("guest_invites.envelope_tip_title")}
            </p>
            <p className="mt-0.5 text-xs text-umber-600 dark:text-umber-300">
              {t("guest_invites.envelope_tip_desc")}
            </p>
          </div>
          <label className="inline-flex shrink-0 cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-umber-700"
              checked={tip?.enabled ?? false}
              disabled={savingTip}
              onChange={handleToggleEnabled}
            />
            <span className="text-xs text-umber-700 dark:text-umber-200">
              {t("guest_invites.envelope_tip_include")}
            </span>
          </label>
        </div>

        {(tip?.enabled ?? false) && (
          <div className="mt-4 flex flex-col gap-3">
            <SegmentedControl
              ariaLabel={t("guest_invites.envelope_tip_mode_label")}
              value={tipManual ? "manual" : "auto"}
              onChange={(v) => (v === "auto" ? handleModeAuto() : handleModeManual())}
              options={[
                { value: "auto", label: t("guest_invites.envelope_tip_auto") },
                { value: "manual", label: t("guest_invites.envelope_tip_manual") },
              ]}
            />

            {tipManual ? (
              <div>
                <label htmlFor="gi_tip_override" className="field-label">
                  {t("guest_invites.envelope_tip_amount_label")}
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    id="gi_tip_override"
                    type="number"
                    min={0}
                    className="input flex-1"
                    value={overrideInput}
                    onChange={(e) => setOverrideInput(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-outline shrink-0"
                    disabled={savingTip}
                    onClick={handleSaveOverride}
                  >
                    {t("common.save")}
                  </button>
                </div>
              </div>
            ) : null}

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

      <SendControls
        audience={audience}
        onAudience={setAudience}
        mode={mode}
        onMode={setMode}
        scheduledValue={scheduledValue}
        onScheduledValue={setScheduledValue}
      />
      <button
        type="button"
        className="btn-primary mt-5 w-full"
        disabled={sending}
        onClick={() => void handleSend()}
      >
        {sending
          ? t("guest_invites.sending")
          : mode === "now"
            ? t("guest_invites.send_now_button")
            : t("guest_invites.schedule_button")}
      </button>
    </section>
  );
}

/** A single summary tile. */
function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-paper-300 bg-paper-50 p-4 dark:border-umber-700 dark:bg-umber-900">
      <p className="font-grotesk text-2xl font-semibold text-umber-900 dark:text-paper-50">
        {value}
      </p>
      <p className="mt-0.5 text-xs text-umber-600 dark:text-umber-300">{label}</p>
    </div>
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
    };
  }, [eligible]);

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

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 xl:px-10">
        <h1 className="font-grotesk text-3xl font-semibold text-umber-900 dark:text-paper-50 sm:text-4xl">
          {t("guest_invites.title")}
        </h1>
        <p className="mt-2 text-sm text-umber-600 dark:text-umber-300">
          {t("guest_invites.subtitle")}
        </p>

        {loading ? (
          <div className="mt-8 flex flex-col gap-4">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <>
            {/* ── A) Monitoring ── */}
            <section className="mt-8">
              <h2 className="font-grotesk text-xl font-semibold text-umber-900 dark:text-paper-50">
                {t("guest_invites.monitoring_title")}
              </h2>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatTile label={t("guest_invites.stat_total")} value={stats.total} />
                <StatTile label={t("guest_invites.stat_adults")} value={stats.adults} />
                <StatTile label={t("guest_invites.stat_children")} value={stats.children} />
                <StatTile label={t("guest_invites.stat_babies")} value={stats.babies} />
              </div>

              <h3 className="mt-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-umber-500 dark:text-umber-400">
                {t("guest_invites.channel_section_title")}
              </h3>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatTile label={t("guest_invites.invited_online")} value={stats.online} />
                <StatTile label={t("guest_invites.invited_physical")} value={stats.physical} />
                <StatTile label={t("guest_invites.invited_both")} value={stats.both} />
                <StatTile label={t("guest_invites.not_invited")} value={stats.notInvited} />
              </div>

              <h3 className="mt-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-umber-500 dark:text-umber-400">
                {t("guest_invites.rsvp_title")}
              </h3>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatTile label={t("guest_invites.rsvp_yes")} value={stats.yes} />
                <StatTile label={t("guest_invites.rsvp_no")} value={stats.no} />
                <StatTile label={t("guest_invites.rsvp_maybe")} value={stats.maybe} />
                <StatTile label={t("guest_invites.rsvp_pending")} value={stats.pending} />
              </div>

              {/* Per-guest table */}
              <div className="mt-6 overflow-hidden rounded-xl border border-paper-300 dark:border-umber-700">
                <div className="hidden grid-cols-12 gap-2 border-b border-paper-300 bg-paper-100 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-umber-500 dark:border-umber-700 dark:bg-umber-900 dark:text-umber-400 sm:grid">
                  <span className="col-span-4">{t("guest_invites.col_name")}</span>
                  <span className="col-span-4">{t("guest_invites.col_channel")}</span>
                  <span className="col-span-2">{t("guest_invites.col_rsvp")}</span>
                  <span className="col-span-2">{t("guest_invites.col_responded")}</span>
                </div>

                {eligible.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-umber-500 dark:text-umber-400">
                    {t("guest_invites.table_empty")}
                  </p>
                ) : (
                  <ul className="divide-y divide-paper-200 dark:divide-umber-800">
                    {eligible.map((g) => {
                      const onlineOn = g.invited_online_at !== null;
                      const physicalOn = g.invited_physical_at !== null;
                      return (
                        <li
                          key={g.id}
                          className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-12 sm:items-center"
                        >
                          <span className="font-medium text-umber-900 dark:text-paper-50 sm:col-span-4">
                            {g.full_name}
                          </span>
                          <span className="flex gap-2 sm:col-span-4">
                            <button
                              type="button"
                              aria-pressed={onlineOn}
                              onClick={() => void toggleChannel(g, "online")}
                              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                                onlineOn
                                  ? "border-umber-700 bg-umber-700 text-paper-50 dark:border-umber-400 dark:bg-umber-400 dark:text-umber-900"
                                  : "border-paper-300 text-umber-600 hover:border-umber-400 dark:border-umber-600 dark:text-umber-300"
                              }`}
                            >
                              {t("guest_invites.channel_online")}
                            </button>
                            <button
                              type="button"
                              aria-pressed={physicalOn}
                              onClick={() => void toggleChannel(g, "physical")}
                              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                                physicalOn
                                  ? "border-umber-700 bg-umber-700 text-paper-50 dark:border-umber-400 dark:bg-umber-400 dark:text-umber-900"
                                  : "border-paper-300 text-umber-600 hover:border-umber-400 dark:border-umber-600 dark:text-umber-300"
                              }`}
                            >
                              {t("guest_invites.channel_physical")}
                            </button>
                          </span>
                          <span className="text-sm text-umber-700 dark:text-umber-200 sm:col-span-2">
                            {t(`guest_invites.rsvp_${g.rsvp_status}`)}
                          </span>
                          <span className="text-xs text-umber-500 dark:text-umber-400 sm:col-span-2">
                            {g.rsvp_responded_at !== null
                              ? formatTimestamp(g.rsvp_responded_at, locale)
                              : t("guest_invites.responded_never")}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>

            {/* ── B) Communication ── */}
            <section className="mt-12">
              <h2 className="font-grotesk text-xl font-semibold text-umber-900 dark:text-paper-50">
                {t("guest_invites.comm_title")}
              </h2>
              <p className="mt-1 text-sm text-umber-600 dark:text-umber-300">
                {t("guest_invites.comm_subtitle")}
              </p>

              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <InviteCard onSent={onSent} />
                <MajorUpdateCard onSent={onSent} />
                <PreWeddingCard couple={couple} onSent={onSent} />
              </div>

              {/* Past + scheduled broadcasts */}
              <h3 className="mt-10 font-grotesk text-lg font-semibold text-umber-900 dark:text-paper-50">
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
                            className="btn-ghost text-xs"
                            onClick={() => void handleCancel(m.id)}
                          >
                            {t("guest_invites.cancel_button")}
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
