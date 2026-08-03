// Type-only contract for the locale tree. en.ts, hu.ts and es.ts must satisfy
// this in full; hr.ts and de.ts satisfy `PartialLocaleMessages` (below).

/** A locale tree that translates SOME of the app. Every key it does define
 *  still has to be a real key at the real path — the deep-partial mapping is
 *  what makes a typo (`vendor.setings`) a compile error rather than a string
 *  that silently never resolves. Keys it omits fall back to EN inside `t()`. */
export type PartialLocaleMessages = DeepPartialMessages<LocaleMessages>;

type DeepPartialMessages<T> = {
  [K in keyof T]?: T[K] extends string ? T[K] : DeepPartialMessages<T[K]>;
};

export interface LocaleMessages {
  common: {
    save: string;
    saving: string;
    edit: string;
    /** Bare "Delete" verb. Carries the confirm button of every delete dialog
     *  and the aria-label + tooltip of the icon-only bin handles.
     *  `confirm_delete` below is the wordier "Yes, delete" variant. */
    delete: string;
    done: string;
    cancel: string;
    dismiss: string;
    next: string;
    back: string;
    loading: string;
    yes: string;
    no: string;
    optional: string;
    error_generic: string;
    sign_out: string;
    confirm_delete_title: string;
    confirm_delete_body: string;
    confirm_delete: string;
    /** Aria-labels for stepper +/− buttons. */
    increment: string;
    decrement: string;
    /** Generic "Remove {label}" aria-label for chip/tag close buttons. */
    remove_item: string;
    /** Bare "Remove" word — short close-button aria-labels with no target. */
    remove: string;
    /** Visually-hidden suffix appended to anchor labels that open in a new
     *  tab — gives screen-reader users the same affordance sighted users
     *  read from the underlined icon / browser chrome. */
    opens_new_tab: string;
    /** aria-label on the wordmark link back to the public home page, for the
     *  standalone guest screens (RSVP, check-in) that carry no app shell. */
    back_home_aria: string;
  };
  app: {
    name: string;
    tagline: string;
  };
  seo: {
    home_title: string;
    home_description: string;
    login_title: string;
    login_description: string;
    register_title: string;
    register_description: string;
    invite_title: string;
    invite_description: string;
    dashboard_title: string;
    dashboard_description: string;
    profile_title: string;
    profile_description: string;
    guests_title: string;
    guests_description: string;
    suppliers_title: string;
    suppliers_description: string;
    budget_title: string;
    budget_description: string;
    seating_title: string;
    seating_description: string;
    logistics_title: string;
    logistics_description: string;
    planning_title: string;
    planning_description: string;
    admin_suppliers_title: string;
    admin_suppliers_description: string;
    admin_feedback_title: string;
    admin_feedback_description: string;
    admin_analytics_title: string;
    admin_analytics_description: string;
    notfound_title: string;
    notfound_description: string;
    onboarding_title: string;
    onboarding_description: string;
    rsvp_checkin_title: string;
    rsvp_checkin_description: string;
    rsvp_legacy_title: string;
    rsvp_legacy_description: string;
    reset_password_title: string;
    reset_password_description: string;
    forgot_password_title: string;
    forgot_password_description: string;
    schedule_title: string;
    schedule_description: string;
    guest_portal_title: string;
    guest_portal_description: string;
    /** Document title for the couple-facing /app/guest-page editor (merged
     *  replacement for the older /app/wedding-site + /app/guest-portal pair). */
    guest_page_title: string;
    guest_page_description: string;
    wedding_site_title: string;
    wedding_site_description: string;
    /** The couple's side of the vendor conversations (/app/messages). */
    messages_title: string;
    messages_description: string;
  };
  /** Post-wedding "rate your vendors" page (/app/rate-vendors). */
  rate_vendors: {
    title: string;
    subtitle: string;
    thanks: string;
    empty_title: string;
    empty_body: string;
    back: string;
    add_comment: string;
    stars_aria: string;
    card_body: string;
    card_cta: string;
  };
  /** Gantt-style task timeline + point-of-contact panel. */
  notifications: {
    /** Bell button + dropdown chrome. */
    aria_label: string;
    title: string;
    empty: string;
    /** Per-kind row labels. `{task}` / `{guest}` / `{status}` / `{name}` /
     *  `{count}` / `{household}` are interpolated client-side from the item's
     *  data payload. */
    timeline_overdue: string;
    timeline_due: string;
    rsvp_received: string;
    rsvp_received_household: string;
    partner_task_added: string;
    partner_task_added_named: string;
    partner_task_added_self: string;
    timeline_email_sent: string;
    /** A vendor wrote on the booking thread. Receives `{vendor}`. */
    vendor_message: string;
    /** A vendor sent a priced offer. Receives `{vendor}`. */
    vendor_quote: string;
    /** RSVP status words used inside `rsvp_received`. */
    rsvp_yes: string;
    rsvp_no: string;
    rsvp_maybe: string;
    /** Profile setting: timeline email escalation. */
    email_setting_label: string;
    email_setting_hint: string;
    email_setting_off: string;
    email_setting_overdue: string;
    email_setting_overdue_due_soon: string;
    /** Dashboard "how are you doing" card. */
    dash_title: string;
    dash_on_track: string;
    dash_overdue: string;
    dash_due_soon: string;
    dash_cta: string;
    settings_title: string;
    settings_method_label: string;
    settings_method_inapp: string;
    settings_method_email: string;
    settings_cadence_label: string;
    settings_cadence_never: string;
    settings_cadence_1_weekly: string;
    settings_cadence_2_weekly: string;
    settings_cadence_4_weekly: string;
    settings_focus_label: string;
    settings_focus_timeline: string;
    settings_focus_rsvp: string;
    settings_focus_partner: string;
    settings_back: string;
    /** One-time feedback survey prompt (120-action gate). */
    feedback_survey: string;
    review_vendors: string;
    feedback_survey_intro: string;
    /** Planning reminder: a dateless task has been sitting 7+ days. */
    planning_stale_task: string;
    /** Planning reminder: a decisions category has 10+ open items untouched 14+ days. */
    planning_decisions_stale: string;
    /** Receives `{count}` and `{group}` — the single stalled theme's title. */
    planning_decisions_stale_group: string;
    /** Receives `{count}` and `{groups}` — several themes stalled at once, so
     *  the bell shows one backlog line instead of one row per theme. */
    planning_decisions_stale_multi: string;
    show_history: string;
    hide_history: string;
    no_new: string;
  };
  timeline: {
    title: string;
    sub: string;
    /** Card titles for the supplier contact panel + the chart itself. */
    poc_title: string;
    poc_empty: string;
    chart_title: string;
    /** "Tasks without dates" fallback list below the chart. */
    no_dates_title: string;
    no_dates_empty: string;
    no_dates_empty_all: string;
    set_dates: string;
    /** Preview-cap toggle for the dateless list (default 15, expand to all). */
    no_dates_show_all: string;
    no_dates_show_less: string;
    /** Schedule wizard ("Ütemező varázsló") launched from the undated card. */
    wand_cta: string;
    wand_title: string;
    wand_subtitle: string;
    wand_no_wedding_date: string;
    wand_move_up: string;
    wand_move_down: string;
    wand_deadline_for: string;
    wand_apply_count: string;
    wand_apply: string;
    wand_applied: string;
    /** Edit drawer. */
    edit_title: string;
    field_start_date: string;
    field_due_date: string;
    field_supplier: string;
    supplier_none: string;
    /** Tooltip label on the vertical "today" marker. */
    today_label: string;
    error_dates: string;
    /** "Not relevant" removal affordance in the Schedule-task dialog. */
    not_relevant_hint: string;
    not_relevant_confirm_title: string;
    not_relevant_confirm_body: string;
    not_relevant_removed: string;
    /** Labels for the zoom selector (day / week / month / quarter / half-year). */
    view_aria: string;
    view_day: string;
    view_week: string;
    view_month: string;
    view_quarter: string;
    view_all: string;
    /** Tooltip + aria for the Maximize2 button that opens the chart full-screen. */
    expand_label: string;
    /** Calendar + Gantt nav cluster (today/prev/next; hidden in the ALL zoom,
     *  which shows the whole plan at once). */
    today_button: string;
    prev_label: string;
    next_label: string;
    /** Sticky task-name column header in the 3M / ALL Gantt. */
    task_column: string;
    /** Tooltip on the wedding-day vertical marker in the 3M / ALL Gantt. */
    wedding_marker: string;
    /** Shown in the task gutter when no tasks fall inside the visible Gantt window. */
    window_empty: string;
    /** Editorial empty-state in the 3M / ALL Gantt task gutter (replaces the
     *  off-screen on-canvas message). Title + body + CTA button. */
    empty_gutter_title: string;
    empty_gutter_sub: string;
    empty_gutter_cta: string;
    empty_add_task: string;
    /** "+N earlier" / "+N later" pluralized hints under the gutter when tasks
     *  sit before or after the visible Gantt window. */
    outside_before_one: string;
    outside_before_other: string;
    outside_after_one: string;
    outside_after_other: string;
    seo_title: string;
    seo_description: string;
    /** Day + Week view chrome: all-day strip header, "now" line, empty hint. */
    all_day_label: string;
    now_label: string;
    day_empty: string;
    /** Header countdown chip: days remaining until the wedding date. */
    countdown_days_one: string;
    countdown_days_other: string;
    countdown_today: string;
    countdown_past_one: string;
    countdown_past_other: string;
    /** Four-month traditional calendar board below the task chart. */
    calendar_title: string;
    calendar_sub: string;
    calendar_event_one: string;
    calendar_event_other: string;
    calendar_no_tasks: string;
    /** Google Calendar push-sync: connect button, connected pill + menu, and
     *  the toasts shown after the OAuth redirect returns. */
    gcal_connect: string;
    gcal_connecting: string;
    gcal_connected_label: string;
    /** Dead-grant state: Google ended our access (revoked, or the grant
     *  expired) and only the person can restore it. */
    gcal_reauth_label: string;
    gcal_reauth_hint: string;
    gcal_reconnect: string;
    /** Shown BEFORE the hand-off to Google while the OAuth app is still in
     *  verification review, because the interstitial Google shows in that
     *  window reads as a security warning to anyone meeting it cold. */
    gcal_unverified_title: string;
    gcal_unverified_body: string;
    gcal_unverified_confirm: string;
    gcal_sync_now: string;
    gcal_syncing: string;
    gcal_disconnect: string;
    gcal_disconnect_title: string;
    gcal_disconnect_body: string;
    gcal_disconnect_confirm: string;
    gcal_menu_aria: string;
    gcal_toast_connected: string;
    gcal_toast_synced: string;
    gcal_toast_disconnected: string;
    gcal_toast_error: string;
    gcal_toast_denied: string;
  };
  a11y: {
    /** Generic close button label (dialogs, sheets). */
    close: string;
    /** Generic dismiss label (toast, banner, notification). */
    dismiss: string;
  };
  auth: {
    login_title: string;
    register_title: string;
    email_label: string;
    password_label: string;
    password_confirm_label: string;
    password_mismatch: string;
    full_name_label: string;
    submit_login: string;
    submit_register: string;
    no_account: string;
    have_account: string;
    /** Mobile-only escape hatch on the couple signup: prompt + links to the
     *  vendor / planner signup flows. */
    register_role_prompt: string;
    register_as_vendor: string;
    register_as_planner: string;
    bad_credentials: string;
    duplicate_email: string;
    planner_invite_banner: string;
    planner_invite_banner_hint: string;
    short_password: string;
    rate_limited: string;
    verify_required_title: string;
    verify_required_body: string;
    verify_resend_button: string;
    verify_resent: string;
    verify_back_to_login: string;
    forgot_link: string;
    forgot_title: string;
    forgot_help: string;
    forgot_submit: string;
    forgot_sent: string;
    forgot_sent_with_email: string;
    forgot_spam_hint: string;
    forgot_wrong_address: string;
    back_to_login: string;
    reset_title: string;
    new_password_label: string;
    reset_submit: string;
    reset_done: string;
    reset_invalid: string;
    show_password: string;
    hide_password: string;
    /** Separator label between Google button and password form. */
    or: string;
    /** Toast when /api/auth/google returns a non-recoverable error. */
    google_failed: string;
    /** Toast when /api/auth/google returns 503 (not configured on this env). */
    google_unavailable: string;
    /** Label on the hand-rolled "Continue with Apple" button. */
    continue_with_apple: string;
    /** Toast when /api/auth/apple returns a non-recoverable error. */
    apple_failed: string;
    /** Toast when /api/auth/apple returns 503 (not configured on this env). */
    apple_unavailable: string;
  };
  verify: {
    banner_title: string;
    banner_body: string;
    banner_resend: string;
    banner_resending: string;
    banner_resent: string;
    banner_dismiss: string;
    page_title: string;
    page_loading: string;
    page_success: string;
    page_invalid: string;
    page_back_to_app: string;
    check_inbox_title: string;
    check_inbox_body: string;
    check_inbox_spam_hint: string;
    check_inbox_skip: string;
    gate_title: string;
    gate_body: string;
    gate_email_intro: string;
    gate_resend: string;
    gate_resending: string;
    gate_resent: string;
    gate_already_verified: string;
    gate_refresh: string;
    gate_logout: string;
    gate_continue_limited: string;
    gate_open_inbox: string;
    banner_done: string;
  };
  /** Subscription / billing — the Settings → Subscription tab + the
   *  read-only banner shown when a couple's free period lapses. */
  billing: {
    title: string;
    subtitle: string;
    plan_label: string;
    plan_trialing: string;
    plan_founding: string;
    plan_active: string;
    plan_past_due: string;
    plan_canceled: string;
    plan_none: string;
    /** Body lines, some with a {date} placeholder. */
    status_trialing: string;
    status_founding: string;
    status_active: string;
    status_past_due: string;
    status_lapsed: string;
    /** Terse one-liners that sit under the big plan name on the Subscription
     *  tab. The long `status_*` sentences above still drive the banners. */
    status_trialing_short: string;
    status_founding_short: string;
    status_active_short: string;
    status_past_due_short: string;
    status_lapsed_short: string;
    /** "{price} / month" — price already formatted with the currency. */
    price_line: string;
    /** "/ month" on its own, so the amount can be set big next to a small
     *  period suffix. */
    price_period: string;
    /** "{n} founding spots left". */
    founding_spots: string;
    subscribe_cta: string;
    manage_cta: string;
    opening: string;
    /** Label for the read-only card-on-file line on the billing tab. */
    card_on_file: string;
    /** Card expiry line; receives `{date}` as "MM/YY". */
    card_expires: string;
    disabled_note: string;
    error_generic: string;
    banner_title: string;
    banner_body: string;
    banner_cta: string;
    /** Celebratory founding-member band, body has a {date} placeholder. */
    founding_banner_title: string;
    founding_banner_body: string;
    /** Solo-workspace nudge: invite your partner to stay free past the paid
     *  launch. Body has a {date} placeholder for the paid-launch date. */
    solo_banner_title: string;
    solo_banner_body: string;
    solo_banner_cta: string;
    grace_banner_title: string;
    grace_banner_body: string;
    grace_banner_cta: string;
    grace_banner_pay: string;
    /** Planner-managed couple in viewer mode: the planner edits, the couple
     *  watches. No subscribe CTA here. */
    planner_managed_banner_title: string;
    planner_managed_banner_body: string;
    referral_title: string;
    referral_couple_title: string;
    referral_couple_cta: string;
    referral_vendor_title: string;
    referral_vendor_cta: string;
    /** The reward each referral pays out, e.g. "1 month free". Carries the
     *  meaning the longer explanatory body used to. */
    referral_couple_reward: string;
    referral_vendor_reward: string;
    referral_copied: string;
    /** Native-share button (shown only where the Web Share API exists). */
    referral_share: string;
    /** Share-sheet message text for each referral link. */
    referral_share_couple_text: string;
    referral_share_vendor_text: string;
    /** "+{months} months" badge — rendered only once something converted. */
    referral_earned: string;
  };
  /** Public couple-branded landing at `/w/:slug` — first version: names,
   *  date, optional schedule, RSVP CTA. Followed by registry / story /
   *  travel sections once the schema picks them up. */
  wedding_site: {
    page_title: string;
    loading: string;
    not_found_title: string;
    not_found_body: string;
    network_error_title: string;
    network_error_body: string;
    back_home: string;
    eyebrow: string;
    date_tbd: string;
    venue_approx: string;
    location_eyebrow: string;
    schedule_eyebrow: string;
    schedule_title: string;
    rsvp_title: string;
    rsvp_body: string;
    rsvp_cta: string;
    /** Phase 2 — copy used on `/w/:slug/:code` when the household
     *  hasn't RSVP'd yes yet. Same component as the public route. */
    invited_eyebrow: string;
    rsvp_personal_title: string;
    rsvp_personal_body: string;
    rsvp_personal_cta: string;
    rsvp_manage_cta: string;
    /** Heading + map-link copy for the post-RSVP unlocked block.
     *  Read only when at least one household member has RSVP'd yes. */
    confirmed_title: string;
    confirmed_open_map: string;
    /** Accessible label for the embedded venue map thumbnail. */
    venue_map_label: string;
    /** Per-member RSVP-status labels (pending / yes / no / maybe).
     *  Used by the household member list in invited/confirmed tier. */
    rsvp_status_pending: string;
    rsvp_status_yes: string;
    rsvp_status_no: string;
    rsvp_status_maybe: string;
    footer_built_with: string;
    /** Editor-preview-only copy. The shared <WeddingSiteView> renders these
     *  ghost placeholders + the click-to-edit hint on /app/guest-page when a
     *  section is still empty; the live public page just omits empty sections. */
    edit_hint: string;
    /** Title on the in-place editable prose (intro / venue / post-RSVP) in the
     *  guest-page preview — clicking the text edits it right there. */
    inline_edit_hint: string;
    /** Muted placeholder shown in the editor preview when the welcome note is
     *  empty — clicking it edits in place (replaces the scroll-to-form ghost). */
    welcome_placeholder: string;
    ghost: {
      cover_title: string;
      cover_cta: string;
      date_cta: string;
      venue_cta: string;
      welcome_title: string;
      welcome_cta: string;
      schedule_title: string;
      schedule_cta: string;
      useful_info_title: string;
      useful_info_cta: string;
      post_rsvp_title: string;
      post_rsvp_cta: string;
      wishlist_cta: string;
      locked_eyebrow: string;
    };
  };
  /** Guest-page venue picker: choose a venue from the couple's own vendors, or
   *  add one on the map (name + address required, optional contact). */
  venue_picker: {
    empty: string;
    legacy_hint: string;
    add_cta: string;
    add_title: string;
    name_label: string;
    address_label: string;
    /** Placeholder on the address field — it carries the "search or tap the
     *  map" instruction that used to be a sentence under the map. */
    address_placeholder: string;
    email_label: string;
    phone_label: string;
    save_cta: string;
    /** Right-hand hint on a suggestion row: picking it uses that listing. */
    suggestion_use: string;
    /** One line under the suggestion list explaining what picking does, since
     *  "use the listing" and "type your own" produce different records. */
    suggestion_hint: string;
  };
  /** Couple-facing editor for the public wedding-website at /w/:slug — flips
   *  the publish toggle and edits venue name + hero image. Reachable at
   *  /app/wedding-site from the sidebar's "For guests" group. */
  wedding_site_editor: {
    page_title: string;
    intro: string;
    /** Helper line shown above the public URL — explains what the link is for. */
    url_label: string;
    url_copied: string;
    url_open: string;
    url_no_slug: string;
    /** Publish toggle card. */
    publish_title: string;
    publish_body_off: string;
    publish_body_on: string;
    publish_label_off: string;
    publish_label_on: string;
    /** Confirm dialog ("double verification") shown before flipping publish. */
    publish_confirm_on_title: string;
    publish_confirm_on_body: string;
    publish_confirm_on_cta: string;
    publish_confirm_off_title: string;
    publish_confirm_off_body: string;
    publish_confirm_off_cta: string;
    /** Venue name + cover-image inputs. `cover_image_hint` explains the
     *  http(s) requirement so a paste of a `data:` URL doesn't silently
     *  fail at the boundary. */
    venue_label: string;
    venue_placeholder: string;
    venue_hint: string;
    /** Separate city/town field shown next to the venue name on the public
     *  site, auto-filled from the place picker. */
    venue_city_label: string;
    venue_city_placeholder: string;
    cover_image_label: string;
    cover_image_placeholder: string;
    cover_image_hint: string;
    cover_image_invalid: string;
    cover_upload_button: string;
    cover_upload_uploading: string;
    cover_upload_replace: string;
    cover_upload_success: string;
    cover_upload_error_generic: string;
    cover_upload_error_too_large: string;
    cover_upload_error_type: string;
    cover_upload_preview_alt: string;
    /** aria-label + tooltip on the icon-only button that clears the cover. */
    cover_image_remove: string;
    /** Cover dropzone helper line (idle) + active drag-over state. */
    cover_drop_hint: string;
    cover_drop_active: string;
    /** Helper line under the cover positioner: the image is dragged to pick
     *  which part of it stays in frame. */
    cover_position_hint: string;
    /** Save state — single shared button at the foot of the form. */
    save_button: string;
    save_saving: string;
    save_success: string;
    save_error_generic: string;
  };
  /** Public "confirm your community-supplier listing" page — reached from the
   *  email sent to the listing's contact_email after submission. */
  verify_supplier: {
    page_title: string;
    page_body: string;
    page_loading: string;
    page_success: string;
    page_already: string;
    page_invalid: string;
    page_expired: string;
    page_missing: string;
    page_home: string;
  };
  /** P2.C — vendor listing-claim flow. Button on directory cards + modal +
   *  email-link landing page that completes the claim. */
  vendor_claim: {
    button_label: string;
    page_title: string;
    page_body: string;
    page_invalid: string;
    page_expired: string;
    page_cancelled: string;
    page_already_verified: string;
    page_home: string;
    modal_title: string;
    /** Receives `{name}` — listing display name. */
    modal_body_intro: string;
    modal_body_email_hidden: string;
    modal_email_label: string;
    modal_email_help: string;
    modal_email_invalid: string;
    modal_submit: string;
    modal_submitting: string;
    modal_close: string;
    /** Receives `{email}` — masked contact email. */
    modal_sent_body: string;
    modal_sent_hint: string;
    modal_err_already_claimed: string;
    modal_err_no_email: string;
    modal_err_not_found: string;
    modal_err_rate_limited: string;
    form_title: string;
    /** Receives `{name}` (listing) + `{email}` (email confirmed). */
    form_intro: string;
    form_name_label: string;
    form_password_label: string;
    form_password_hint: string;
    form_submit: string;
    form_submitting: string;
    form_err_name: string;
    form_err_password: string;
    form_err_email_taken: string;
    form_err_already_claimed: string;
    success_toast: string;
    /** Shown instead of the password form when the listing's category is a
     *  wedding planner's — they get an account on the planner side, not a
     *  vendor one. */
    planner_title: string;
    /** Receives `{name}` — listing display name. */
    planner_body: string;
    planner_cta: string;
  };
  /** Vendor onboarding "activate" screen — the accepted-waitlist → live vendor
   *  flow. Reached via /vendor/activate/:token from the accept email. The first
   *  VENDOR_FOUNDING_CAP vendors are our guests for a year; the copy takes the
   *  cap as a {cap} var rather than spelling it, so raising it moves one
   *  constant. */
  vendor_activate: {
    page_title: string;
    page_body: string;
    /** Receives `{name}` — business name. */
    form_title: string;
    form_intro: string;
    /** Receives `{left}` + `{cap}` — founding spots remaining / total. */
    founding_badge: string;
    founding_note: string;
    /** Second free cohort (three months). Same `{left}` + `{cap}` shape. */
    early_badge: string;
    early_note: string;
    cohort_full_note: string;
    form_name_label: string;
    form_password_label: string;
    form_password_hint: string;
    form_submit: string;
    form_submitting: string;
    form_err_name: string;
    form_err_password: string;
    form_err_email_taken: string;
    form_err_already_completed: string;
    success_toast: string;
    page_invalid: string;
    page_expired: string;
    page_completed: string;
    page_home: string;
  };
  /** Admin-provisioned planner activation landing (/planner/activate/:token).
   *  Password + clickwrap consent flow into a live planner session. */
  planner_activate: {
    page_title: string;
    page_body: string;
    title: string;
    intro: string;
    email_line: string;
    free_line: string;
    submit: string;
    legal_prefix: string;
    error_title: string;
    error_invalid: string;
    error_expired: string;
    error_consumed: string;
  };
  /** DeepL-backed auto-translate for the bilingual "Leírás" fields. */
  translate: {
    from_hu: string;
    from_en: string;
    working: string;
    needs_source: string;
    error: string;
    overwrite_title: string;
    overwrite_body: string;
    overwrite_confirm: string;
  };
  /** Vendor self-serve listing editor (P2.D). The single screen a vendor has
   *  after the claim flow — edits the public listing fields couples see. */
  vendor_home: {
    page_title: string;
    page_body: string;
    /** Receives `{name}` — vendor user's full name. */
    welcome: string;
    intro: string;
    /** Billing banner. founding/trial receive `{date}` (free-until / trial-end). */
    billing_founding: string;
    billing_trial: string;
    /** Receives `{used}` + `{total}` — delivered vs promised lead-window inquiries. */
    billing_lead_window: string;
    billing_lapsed: string;
    billing_lapsed_cta: string;
    availability_locked: string;
    section_marketing: string;
    section_contact: string;
    section_pricing: string;
    /** Same fieldset, for the categories where the capacity block is hidden. */
    section_pricing_only: string;
    label_blurb_hu: string;
    label_blurb_en: string;
    /** Label for the LOCAL-language description box. `{lang}` is that
     *  language's own name, resolved from the vendor's country by
     *  `listingLocalLanguage` — a Croatian vendor is asked for a Croatian
     *  description, not a Hungarian one. Supersedes `label_blurb_hu`, which
     *  only the legacy standalone editor still reads. */
    label_blurb_lang: string;
    /** The HU/EN switch above the single description textarea, and the
     *  screen-reader name for the dot marking a language that has copy. */
    blurb_lang_aria: string;
    blurb_lang_filled: string;
    label_blurb_hint: string;
    label_city: string;
    label_address: string;
    label_website: string;
    label_contact_email: string;
    label_contact_email_hint: string;
    label_contact_phone: string;
    label_hide_contact: string;
    label_hide_contact_hint: string;
    /** The one line that stays on screen; the full text above moved into an
     *  InfoHint next to the toggle's label. */
    label_hide_contact_hint_short: string;
    label_price_band: string;
    label_price_band_help: string;
    /** Anti-fraud cooldown (shared/listings.ts PRICE_BAND_COOLDOWN_DAYS):
     *  shown instead of the help line while the band is locked.
     *  {date} = localised unlock date. */
    price_band_locked_until: string;
    price_band_clear: string;
    price_band_clear_title: string;
    price_band_clear_body: string;
    price_band_clear_confirm: string;
    label_capacity_min: string;
    label_capacity_max: string;
    section_hero: string;
    hero_intro: string;
    hero_upload: string;
    hero_replace: string;
    hero_delete: string;
    hero_uploading: string;
    /** Ring label while bytes are going up. Receives `{pct}` (0-100). */
    upload_progress: string;
    /** Accessible name of the success tick that replaces the ring. */
    upload_done: string;
    hero_upload_success: string;
    hero_upload_failed: string;
    hero_delete_success: string;
    hero_delete_failed: string;
    hero_placeholder_alt: string;
    hero_current_alt: string;
    save: string;
    saving: string;
    save_success: string;
    save_failed: string;
    name_locked: string;
    back_to_directory: string;
    section_availability: string;
    /** Link out of the whole-day block list into the real calendar. */
    availability_open_calendar: string;
    availability_intro: string;
    availability_add_label: string;
    availability_add: string;
    availability_empty: string;
    /** Receives `{date}` — the blocked day to unblock. */
    availability_remove: string;
    /** Receives `{date}` — the next free day. */
    availability_next_free: string;
    availability_none_free: string;
    /** Self-serve pause/unpause card on the listing editor. */
    visibility_title: string;
    visibility_body: string;
    visibility_live: string;
    visibility_paused: string;
    visibility_moderated: string;
    visibility_pause_cta: string;
    visibility_publish_cta: string;
    visibility_paused_toast: string;
    visibility_published: string;
    visibility_failed: string;
    visibility_moderated_note: string;
    availability_blocked: string;
    availability_block_failed: string;
    availability_unblocked: string;
    availability_unblock_failed: string;
    error_load: string;
    error_no_account: string;
    preview_panel_title: string;
    price_band_level_1_name: string;
    price_band_level_2_name: string;
    price_band_level_3_name: string;
    price_band_level_4_name: string;
    price_band_level_5_name: string;
    capacity_range_label: string;
    /** Capacity heading for a category that HAS a room: "Befogadóképesség". */
    capacity_seating_label: string;
    languages_label: string;
    languages_hint: string;
    /** Capacity heading for a category that SERVES guests rather than seating
     *  them (catering, bar, rentals): "Kiszolgálható vendégszám". */
    capacity_service_label: string;
    capacity_min_label: string;
    capacity_max_label: string;
    capacity_invalid: string;
    /** Brand name field on the vendor listing editor. Self-serve since the
     *  moderation freeze was lifted, behind a once-a-week cooldown —
     *  `name_locked_until` carries the exact date the server will accept the
     *  next rename, and `name_change_warning` states the cooldown BEFORE the
     *  rename is saved, since saving it is what spends the week. */
    label_name: string;
    name_locked_until: string;
    name_change_warning: string;
    name_change_confirm: string;
    autosave_saving: string;
    autosave_saved: string;
    autosave_unsaved: string;
    hero_dropzone_cta: string;
    hero_dropzone_hint: string;
    hero_dropzone_replace: string;
    hero_size_hint: string;
    section_gallery: string;
    gallery_intro: string;
    /** Receives `{n}` current count and `{max}` cap. */
    gallery_count: string;
    gallery_add: string;
    gallery_delete: string;
    gallery_upload_success: string;
    gallery_upload_failed: string;
    /** Receives `{max}` cap. */
    gallery_full: string;
    gallery_delete_success: string;
    /** aria-label on a gallery thumbnail (swaps it into the big view). */
    gallery_show_aria: string;
    gallery_delete_failed: string;
    gallery_position_hint: string;
    section_videos: string;
    videos_add: string;
    /** One-word form for the button beside the URL field; the full sentence
     *  stays on its aria-label + title. */
    videos_add_short: string;
    videos_url_label: string;
    videos_url_placeholder: string;
    videos_url_invalid: string;
    /** Receives `{n}` current count and `{max}` cap. */
    videos_count: string;
    /** Receives `{max}` cap. */
    videos_full: string;
    videos_add_success: string;
    videos_add_failed: string;
    videos_update_success: string;
    videos_update_failed: string;
    videos_delete: string;
    videos_delete_success: string;
    videos_delete_failed: string;
    videos_edit: string;
    videos_edit_save: string;
    videos_edit_cancel: string;
    videos_reorder_failed: string;
    videos_move_up: string;
    videos_move_down: string;
    videos_drag: string;
    section_packages: string;
    packages_add: string;
    packages_default_name: string;
    /** Receives `{n}` and `{max}`. */
    packages_count: string;
    /** Receives `{max}`. */
    packages_full: string;
    packages_add_success: string;
    packages_add_failed: string;
    packages_name_label: string;
    /** Pencil affordance on the collapsed package header. */
    packages_rename: string;
    packages_name_placeholder: string;
    packages_suggestions_label: string;
    packages_price_label: string;
    packages_price_placeholder: string;
    packages_desc_label: string;
    packages_desc_placeholder: string;
    packages_save: string;
    packages_unsaved: string;
    packages_saved: string;
    packages_save_failed: string;
    packages_delete: string;
    packages_delete_confirm_title: string;
    /** Receives `{name}`. */
    packages_delete_confirm_body: string;
    packages_delete_success: string;
    packages_delete_failed: string;
    packages_pdf_label: string;
    packages_pdf_upload: string;
    packages_pdf_replace: string;
    packages_pdf_remove: string;
    packages_pdf_hint: string;
    packages_pdf_upload_success: string;
    packages_pdf_upload_failed: string;
    packages_pdf_removed: string;
    /** Receives `{max}`. */
    packages_pdf_too_large: string;
    packages_pdf_invalid: string;
    preview_open: string;
    preview_no_photo: string;
    /** Receives `{min}` - minimum guest capacity. */
    preview_capacity_from: string;
    /** Receives `{max}` - maximum guest capacity. */
    preview_capacity_upto: string;
    /** Receives `{range}` - formatted guest capacity range. */
    preview_capacity_guests: string;
  };
  /** Vendor workspace (the role='vendor' shell at /vendor/*). Nav + the seven
   *  pages: dashboard, clients (Weddly-sourced couples), listing editor, stats,
   *  billing, settings, plus the freemium plan + upgrade-prompt copy. FREE tier
   *  always works; PRO unlocks the CRM detail, payment tracking, advanced
   *  stats, and the respond/status workflow. */
  vendor: {
    /** Header share action + the dialog behind it, pointed at the public
     *  profile URL (the reviews page owns the ?review=1 variant). */
    share: {
      title: string;
      body: string;
      action: string;
    };
    nav: {
      dashboard: string;
      clients: string;
      calendar: string;
      listing: string;
      stats: string;
      reviews: string;
      billing: string;
      settings: string;
      section_workspace: string;
      section_account: string;
      logout: string;
      brand_fallback: string;
      /** aria-label for the unread-inquiry count badge on the clients nav item. */
      new_inquiries: string;
      collapse_sidebar: string;
      expand_sidebar: string;
      /** Phone bottom bar's fifth tab, and the title of the sheet it opens. */
      more: string;
      more_sheet_title: string;
    };
    /** Header profile-menu labels (mirrors planner_shell). */
    shell: {
      menu_label: string;
      menu_plan: string;
      menu_settings: string;
    };
    /** Header notification bell (mirrors the planner shell's). */
    notif: {
      aria: string;
      heading: string;
      none: string;
      /** Receives `{count}` (bookings still in 'requested'). */
      new_inquiries: string;
      /** Receives `{count}` (confirmed events in the next 7 days). */
      upcoming_week: string;
      /** Published reviews from the last 30 days (VendorStats.reviews_recent). */
      new_reviews: string;
      /** Receives `{count}` (unread couple messages across every thread). */
      unread_messages: string;
    };
    /** Listing-setup checklist. Each `step_*` suffix matches a
     *  `VendorListingStepKey` in shared/vendor_clients.ts AND the
     *  `#vendor-section-<key>` anchor on the listing editor, so the three stay
     *  in lockstep by construction. */
    setup: {
      panel_title: string;
      step_cover: string;
      step_gallery: string;
      step_description: string;
      step_contact: string;
      step_pricing: string;
      step_capacity: string;
      step_packages: string;
    };
    /** Weddly Points: the vendor tier currency. Phase 1 is read-only — these
     *  strings describe what the ledger already says, never an offer or a
     *  claim the vendor has to act on. */
    points: {
      /** Small label above the hero number. */
      label: string;
      /** Accessible name of the tier progress ring. */
      ring_label: string;
      /** Receives `{points}` + `{tier}` — how far to the next tier. */
      to_next: string;
      /** Shown instead of `to_next` at the highest tier. */
      at_top: string;
      /** Tier identity names. Keyed by VendorTierKey. */
      tier: {
        blue: string;
        gold: string;
        platinum: string;
        black: string;
      };
      /** Perk lines. `perk_leads` receives `{n}`, `perk_discount` `{pct}`. */
      perk_search: string;
      perk_leads: string;
      perk_discount: string;
      perk_badge: string;
      /** Toggle that opens the earning rules. */
      how_to_earn: string;
      /** One line per rule in EARNABLE_EVENTS, keyed `earn_<event>`. The point
       *  value is rendered from POINTS_BY_EVENT, never written into the copy.
       *  `earn_fast_reply` receives `{hours}`. */
      earn_profile_completeness: string;
      earn_first_review: string;
      earn_review_collected: string;
      earn_fast_reply: string;
      earn_booking_confirmed: string;
      /** Lifetime points from one rule. Receives `{n}`. */
      earned_so_far: string;
      /** Lead-in to the next tier's perks. Receives `{tier}`. */
      next_unlocks: string;
      /** The vendor's place in their own category. Receives `{rank}`,
       *  `{total}` and `{category}`. The category label comes from
       *  `suppliers.cat.<key>`, never written into this string. */
      rank_position: string;
      /** How far behind the vendor immediately above. Receives `{points}`. */
      rank_gap: string;
    };
    dashboard: {
      page_title: string;
      page_body: string;
      /** Receives `{name}` — vendor / business name. Kept as the fallback the
       *  greeting below degrades to; nothing renders it today. */
      welcome: string;
      /** The dashboard's opening line, picked by `greetingKeyFor(new Date())`
       *  in `lib/greeting.ts`. Every key receives `{name}`, and the set must
       *  stay in lockstep with `GreetingKey` there. Holiday lines are shared
       *  across all locales by design: `locale` is the reader's language, not
       *  the country their business is in. */
      greeting: {
        /** 05:00-07:59. */
        early: string;
        /** 08:00-10:59. */
        morning: string;
        /** 11:00-13:59, the band that is neither morning nor afternoon. */
        midday: string;
        /** 14:00-16:59. */
        afternoon: string;
        /** 17:00-18:59, too early for good evening. */
        early_evening: string;
        /** 19:00-21:59. */
        evening: string;
        /** 22:00-04:59. */
        night: string;
        christmas: string;
        new_year: string;
        valentines: string;
        easter: string;
      };
      inquiries_total: string;
      inquiries_30d: string;
      /** KPI label for profile opens in the trailing 30 days. */
      views_30d: string;
      revenue_tracked: string;
      blocked_dates: string;
      upcoming_title: string;
      no_upcoming: string;
      view_clients: string;
      /** Opens the vendor's own public listing page in a new tab. */
      open_preview: string;
      /** Names where the tile goes, so a whole-card Link is legible as one. */
      open_calendar: string;
      view_listing: string;
      /** Receives `{pct}` - listing completeness percentage. */
      completeness_alert: string;
      completeness_alert_body: string;
      /** Compact label on the collapsed setup-progress chip. */
      completeness_chip: string;
      /** Aria-label for the chip that reopens the full setup guidance. */
      completeness_expand: string;
      dismiss: string;
      hero_label: string;
      hero_hint: string;
      actions_title: string;
      /** Receives `{count}` - number of upcoming events. */
      action_upcoming_title: string;
      action_upcoming_body: string;
      action_allset_title: string;
      action_allset_body: string;
    };
    clients: {
      page_title: string;
      page_body: string;
      empty_title: string;
      empty_body: string;
      empty_title_new: string;
      empty_step_1: string;
      empty_step_2: string;
      empty_step_3: string;
      empty_cta_listing: string;
      empty_cta_share: string;
      /** Free-text search over the already-fetched client list (client-side;
       *  composes with the status pills). */
      search_placeholder: string;
      search_clear: string;
      search_no_results: string;
      col_couple: string;
      col_event_date: string;
      col_status: string;
      col_stage: string;
      col_balance: string;
      view: string;
      back_to_clients: string;
      no_event_date: string;
      /** Heading over the couple's own inquiry text on the client detail page. */
      inquiry_message_title: string;
      /** Heading over the two-way thread on the client detail page. */
      thread_title: string;
      /** Shown instead of the composer on FREE. Reading a client's message is
       *  never gated, only writing back is. */
      thread_locked_title: string;
      thread_locked_body: string;
      /** Aria-label on the unread badge in the client list. Receives `{count}`. */
      unread_messages: string;
      /** Aria-label on the dot marking a `requested` inquiry the vendor has
       *  never opened — the rows the Ügyfelek nav badge counts. */
      unopened: string;
      detail_title: string;
      status_label: string;
      status_requested: string;
      status_vendor_seen: string;
      status_confirmed: string;
      status_declined: string;
      status_cancelled: string;
      status_expired: string;
      stage_label: string;
      stage_placeholder: string;
      stage_hint: string;
      contract_value: string;
      deposit_paid: string;
      balance: string;
      notes_label: string;
      notes_placeholder: string;
      contact_email: string;
      no_contact_email: string;
      save: string;
      saving: string;
      saved: string;
      save_failed: string;
      load_failed: string;
    };
    /** Next Best Action — the single primary step for one client. One key per
     *  VendorActionKey (`shared/vendor_next_action.ts`): `action_*` is the CTA
     *  label, `hint_*` the line under it when nothing is flagged. */
    next: {
      title: string;
      action_open: string;
      action_reply: string;
      action_follow_up: string;
      action_await: string;
      action_record_contract: string;
      action_add_schedule: string;
      action_chase_payment: string;
      action_release_or_extend: string;
      action_request_review: string;
      action_prepare: string;
      action_none: string;
      hint_open: string;
      hint_reply: string;
      hint_follow_up: string;
      hint_await: string;
      hint_record_contract: string;
      hint_add_schedule: string;
      hint_chase_payment: string;
      hint_release_or_extend: string;
      hint_request_review: string;
      hint_prepare: string;
      hint_none: string;
    };
    /** The "needs attention" band above the clients list. Every `reason_*`
     *  carries its own number, because a row that only says "needs attention"
     *  is a badge and a badge gets ignored. */
    attention: {
      /** Receives `{count}`. */
      title: string;
      snooze: string;
      /** Receives `{name}`. */
      snoozed: string;
      snooze_failed: string;
      /** Receives `{count}`. */
      more: string;
      /** Receives `{count}`. */
      age_hours: string;
      /** Receives `{count}`. */
      age_days: string;
      /** Receives `{age}`. */
      reason_unopened: string;
      /** Receives `{age}`. */
      reason_unanswered: string;
      /** Receives `{count}` — whole HOURS left on a live date hold, not
       *  elapsed. Forward-anchored like `reason_date_soon`. */
      reason_hold_expiring: string;
      /** Receives `{age}`. */
      reason_payment_overdue: string;
      /** Receives `{count}` — days UNTIL the wedding, not elapsed. */
      reason_date_soon: string;
      /** Receives `{age}`. */
      reason_going_cold: string;
      reason_review_due: string;
    };
    payments: {
      title: string;
      intro: string;
      add: string;
      label_field: string;
      label_placeholder: string;
      amount_field: string;
      due_date_field: string;
      no_due_date: string;
      mark_paid: string;
      mark_unpaid: string;
      paid: string;
      unpaid: string;
      empty: string;
      remove: string;
      remove_confirm_title: string;
      remove_confirm_body: string;
      total: string;
      total_paid: string;
      total_outstanding: string;
      added: string;
      add_failed: string;
      updated: string;
      update_failed: string;
      removed: string;
      remove_failed: string;
    };
    /** The vendor's half of a quote (árajánlat): the section on a client card
     *  and the editor behind it. The card itself is shared with the couple, so
     *  everything printed ON it lives in the top-level `quotes.*`. */
    quotes: {
      title: string;
      empty: string;
      /** Opens the editor. */
      new: string;
      new_title: string;
      edit_title: string;
      title_field: string;
      title_placeholder: string;
      /** One priced row: what it is, how many, what one costs. */
      line_label: string;
      line_placeholder: string;
      line_qty: string;
      line_amount: string;
      line_add: string;
      line_remove: string;
      deposit_field: string;
      valid_until_field: string;
      message_field: string;
      message_placeholder: string;
      saved: string;
      save_failed: string;
      send: string;
      sent: string;
      send_failed: string;
      withdraw: string;
      withdrawn: string;
      withdraw_failed: string;
      withdraw_confirm_title: string;
      withdraw_confirm_body: string;
      remove: string;
      removed: string;
      remove_failed: string;
      remove_confirm_title: string;
      remove_confirm_body: string;
      /** 409 quote_not_draft: a sent offer is no longer editable. */
      not_draft: string;
      /** 403 vendor_pro_required. */
      pro_required: string;
      /** Upgrade card shown in place of the editor on FREE. */
      locked_title: string;
      locked_body: string;
    };
    /** Live date hold: the vendor's temporary reservation of ONE date for ONE
     *  inquiry, on the client detail. State is derived from `hold_until`
     *  (`shared/date_holds.ts`), so every string here describes a fact, never a
     *  stored status. */
    holds: {
      title: string;
      /** One line explaining what a hold does, above the control. */
      intro: string;
      /** Nothing held yet. */
      empty: string;
      /** Receives `{date}` - the day this inquiry is about. */
      for_date: string;
      /** Receives `{remaining}`, e.g. "2 days". */
      state_live: string;
      /** Receives `{date}` - when it lapsed / was let go. */
      state_expired: string;
      state_released: string;
      /** Length picker above the CTA. */
      duration_label: string;
      /** Receives `{count}` - option labels in the length picker. */
      duration_hours: string;
      duration_days: string;
      /** Primary CTA, and the same control once a hold exists. */
      place: string;
      extend: string;
      release: string;
      release_confirm_title: string;
      release_confirm_body: string;
      placed: string;
      extended: string;
      released: string;
      failed: string;
      /** 400 hold_no_date: the inquiry has no scalar date to hold. */
      no_date: string;
      /** 400 hold_date_past. */
      date_past: string;
      /** 409 hold_booking_closed: the vendor archived this lead. */
      booking_closed: string;
      /** Upgrade card shown in place of the control on FREE. */
      locked_title: string;
      locked_body: string;
    };
    stats: {
      page_title: string;
      page_body: string;
      inquiries: string;
      by_status: string;
      upcoming: string;
      completeness: string;
      revenue: string;
      blocked_dates: string;
      status_empty: string;
      revenue_help: string;
      /** Profile-open counters: KPI label, its tooltip, and the trailing-window
       *  line under the funnel's first stage (receives `{n}`). */
      views: string;
      views_help: string;
      views_recent: string;
      trend_title: string;
      trend_empty: string;
      range_7d: string;
      range_30d: string;
      range_90d: string;
      range_365d: string;
      unit_inquiries: string;
      conversion_title: string;
      conversion_confirmed: string;
      conversion_rate: string;
    };
    /** Revenue Pulse: the forward-looking money surface (PRO only, gated on
     *  the existing `payment_tracking` feature). Rendered twice: a compact bar
     *  at the top of the clients list and the full breakdown on the stats page.
     *  See `shared/vendor_revenue.ts` for what each figure means. */
    revenue: {
      title: string;
      body: string;
      booked: string;
      booked_help: string;
      collected: string;
      outstanding: string;
      pipeline: string;
      pipeline_help: string;
      /** The discounted pipeline. NEVER render it without `estimate` beside it. */
      weighted: string;
      weighted_help: string;
      estimate: string;
      /** Receives `{n}`, open leads left out of the pipeline for want of a
       *  recorded value. The count is what keeps the figure honest. */
      unpriced_note: string;
      /** Receives `{n}`, confirmed bookings with no recorded contract value. */
      booked_unpriced_note: string;
      upcoming_title: string;
      /** The three cash-flow horizons. NESTED: 60 contains 30. */
      next_30: string;
      next_60: string;
      next_90: string;
      average_booking: string;
      win_rate: string;
      /** Receives `{n}` (decided leads) + `{days}` (the trailing window). */
      trailing_note: string;
      /** The compact bar's link through to the full breakdown. */
      see_breakdown: string;
    };
    reviews: {
      page_title: string;
      page_body: string;
      /** Receives `{n}` — published review count. */
      count_label: string;
      cold_start_note: string;
      empty_title: string;
      empty_body: string;
      load_more: string;
      share_title: string;
      share_body: string;
      share_copy: string;
      share_copied: string;
      share_whatsapp: string;
      share_email: string;
      /** Native share-sheet button, rendered only where `navigator.share` exists. */
      share_native: string;
    };
    billing: {
      page_title: string;
      page_body: string;
      current_plan: string;
      status_label: string;
      /** Receives `{date}` — end of the founding free window. */
      founding_until: string;
      /** Receives `{date}` — trial end date. */
      trial_until: string;
      entitled_yes: string;
      entitled_no: string;
      /** Receives `{left}` + `{cap}` — founding spots left / total. */
      founding_spots: string;
      manage: string;
      checkout_unavailable: string;
      per_month: string;
      compare_title: string;
      you_are_here: string;
      payment_portal_note: string;
      upgrade_value: string;
      upgrade_cta: string;
      trial_expired_line: string;
      add_card_title: string;
      /** Receives `{total}` — complimentary lead count before billing starts. */
      add_card_body: string;
      add_card_cta: string;
      setup_success_note: string;
      lead_meter_title: string;
      /** Receives `{used}` + `{total}` — lead-window meter. */
      lead_meter_count: string;
      /** Receives `{total}`. */
      lead_window_line: string;
      /** Receives `{total}` + `{date}` — first charge date once leads are delivered. */
      billing_starts_line: string;
      /** Receives `{date}`. */
      next_payment_line: string;
      past_due_line: string;
      leads_exhausted_line: string;
      subscribe_cta: string;
      portal_cta: string;
      /** Payment method + invoice history, read from Stripe. Card details are
       *  never entered here; changing one goes to the hosted portal. */
      payment_title: string;
      payment_none: string;
      payment_change: string;
      payment_add: string;
      invoice_download: string;
      invoice_status_paid: string;
      invoice_status_open: string;
      invoice_status_void: string;
      invoice_status_draft: string;
      redirecting: string;
      action_failed: string;
      feature_direct_messages: string;
      feature_calendar: string;
      invoice_history_title: string;
      invoice_col_date: string;
      invoice_col_amount: string;
      invoice_col_status: string;
      invoice_col_download: string;
      invoice_empty: string;
    };
    settings: {
      page_title: string;
      page_body: string;
      account_name: string;
      locale_label: string;
      password_label: string;
      change_password: string;
      data_export_title: string;
      data_export_body: string;
      export_button: string;
      save: string;
      saving: string;
      saved: string;
      save_failed: string;
      tabs_aria: string;
      tab_account: string;
      tab_company: string;
      tab_billing: string;
      tab_data: string;
      badge_vendor: string;
      company_title: string;
      company_body: string;
      company_name: string;
      company_name_required: string;
      company_display_name: string;
      company_display_name_help: string;
      company_legal_name: string;
      company_legal_name_help: string;
      company_email: string;
      company_phone: string;
      company_vat: string;
      company_registry: string;
      company_legal_form: string;
      company_country: string;
      company_postal: string;
      company_city: string;
      company_address: string;
      company_listing_link: string;
      bio_title: string;
      bio_body: string;
      bio_hu: string;
      bio_en: string;
      data_delete_heading: string;
      data_delete_desc: string;
      data_delete_cta: string;
      /** Intent confirmation before the mailto opens. */
      data_delete_confirm_title: string;
      data_delete_confirm_body: string;
      tab_schedule: string;
      tab_automations: string;
    };
    /** Automatizmusok: the three things Weddly may do on the vendor's behalf,
     *  at /vendor/settings/automations. Every switch is off by default and the
     *  copy has to say what leaves the building and who reads it, because that
     *  is the whole decision the vendor is making. */
    automations: {
      intro: string;
      /** FREE banner: the writes are refused, the configuration is untouched. */
      locked: string;
      saved: string;
      save_failed: string;
      /** Accessible name for each row's switch. */
      toggle_aria: string;
      ack_title: string;
      ack_body: string;
      ack_template_label: string;
      ack_template_none: string;
      ack_no_templates: string;
      ack_templates_link: string;
      /** Server said the automation has no text yet. */
      ack_needs_body: string;
      ack_note: string;
      reminder_title: string;
      reminder_body: string;
      reminder_delay_label: string;
      /** "{min} to {max} hours." */
      reminder_delay_hint: string;
      review_title: string;
      review_body: string;
      proposals_title: string;
      proposals_empty: string;
      approve: string;
      dismiss: string;
      approved: string;
      dismissed: string;
      action_failed: string;
      activity_title: string;
      activity_empty: string;
      status_sent: string;
      status_proposed: string;
      status_approved: string;
      status_dismissed: string;
      status_skipped: string;
      /** Why a run was skipped, keyed off the server's short detail string. */
      detail_opted_out: string;
      detail_send_failed: string;
      key_inquiry_ack: string;
      key_unanswered_reminder: string;
      key_review_request: string;
    };
    /** Munkarend: the recurring weekly working hours + dated exceptions, at
     *  /vendor/settings/schedule. Icon-first by design (the +, copy and remove
     *  affordances are glyphs), so most of these are accessible names rather
     *  than visible labels. */
    schedule: {
      intro: string;
      name_label: string;
      name_placeholder: string;
      from: string;
      to: string;
      /** Accessible names for the per-row glyph buttons. */
      add_interval: string;
      remove_interval: string;
      /** "Add hours to {day}" on an off day's lone + button. */
      add_day: string;
      copy_to: string;
      copy_title: string;
      copy_apply: string;
      day_on_action: string;
      day_off_action: string;
      need_one_day: string;
      saved: string;
      save_failed: string;
      up_to_date: string;
      exceptions_title: string;
      exceptions_intro: string;
      exceptions_empty: string;
      exception_add: string;
      exception_date: string;
      exception_kind_label: string;
      exception_kind_off: string;
      exception_kind_on: string;
      exception_scope_label: string;
      exception_all_day: string;
      exception_hours: string;
      exception_on_hint: string;
      exception_on_label: string;
      exception_off_label: string;
      /** "Busy {from}-{to}" for an hours-only exception. */
      exception_off_hours_label: string;
      exception_saved: string;
      exception_removed: string;
      exception_failed: string;
      exception_remove: string;
      exception_remove_title: string;
      exception_remove_body: string;
      /** Two-way Google Calendar block on the same tab. `gcal_last_pull` takes
       *  `{when}` + `{count}`. */
      public_title: string;
      public_on_body: string;
      public_off_body: string;
      public_on_saved: string;
      public_off_saved: string;
      gcal_title: string;
      gcal_body: string;
      gcal_pull_label: string;
      gcal_privacy: string;
      gcal_primary: string;
      gcal_saved: string;
      gcal_list_failed: string;
      gcal_last_pull: string;
      gcal_never_pulled: string;
      /** Setup / teardown padding. `buffer_hours` takes `{count}`. */
      buffer_title: string;
      buffer_body: string;
      buffer_before: string;
      buffer_after: string;
      buffer_none: string;
      buffer_hours: string;
      buffer_default_hint: string;
    };
    plan: {
      free_label: string;
      pro_label: string;
      free_badge: string;
      pro_badge: string;
    };
    upgrade: {
      title: string;
      body: string;
      cta: string;
      feature_locked: string;
      learn_more: string;
    };
  };
  /** Vendor calendar + to-do board at /vendor/calendar. The calendar mode
   *  mirrors the planner's six views (day / 4day / week / month / year /
   *  schedule) over bookings + inquiries + blocked days + task deadlines;
   *  the tasks mode is the Trello-style board (todo / doing / done). */
  vendor_calendar: {
    /** Optional Google Calendar push-sync. Same key names as `timeline.gcal_*`
     *  (the UI component is shared and takes the namespace as a prefix), but the
     *  copy speaks about bookings rather than the wedding timeline. */
    gcal_connect: string;
    gcal_connecting: string;
    gcal_connected_label: string;
    /** Dead-grant state: Google ended our access (revoked, or the grant
     *  expired) and only the person can restore it. */
    gcal_reauth_label: string;
    gcal_reauth_hint: string;
    gcal_reconnect: string;
    /** Shown BEFORE the hand-off to Google while the OAuth app is still in
     *  verification review, because the interstitial Google shows in that
     *  window reads as a security warning to anyone meeting it cold. */
    gcal_unverified_title: string;
    gcal_unverified_body: string;
    gcal_unverified_confirm: string;
    gcal_sync_now: string;
    gcal_syncing: string;
    gcal_disconnect: string;
    gcal_disconnect_title: string;
    gcal_disconnect_body: string;
    gcal_disconnect_confirm: string;
    gcal_menu_aria: string;
    gcal_toast_connected: string;
    gcal_toast_synced: string;
    gcal_toast_disconnected: string;
    gcal_toast_error: string;
    gcal_toast_denied: string;
    page_title: string;
    mode_calendar: string;
    mode_tasks: string;
    nav_prev: string;
    nav_next: string;
    today: string;
    view_label: string;
    view_day: string;
    view_4day: string;
    view_week: string;
    view_month: string;
    view_year: string;
    view_schedule: string;
    /** Time-grid band label for date-only entries. */
    all_day: string;
    schedule_empty: string;
    legend_blocked: string;
    /** Legend entry for a day blocked only for certain hours. */
    legend_blocked_partial: string;
    legend_booked: string;
    legend_pending: string;
    legend_tasks: string;
    /** Legend entry + cell glyph for a day the WEEKLY SCHEDULE has off. Not a
     *  block: nothing was marked by hand, so it reads neutral. */
    legend_off_day: string;
    /** Link out to /vendor/settings/schedule, where recurring days off live. */
    schedule_link: string;
    /** Busy time pulled from the vendor's own Google calendar: legend entry, and
     *  the block's own label, which takes `{from}` + `{to}` because free/busy
     *  carries no title to show. */
    legend_external: string;
    external_busy_label: string;
    /** Setup / teardown the schedule pads around an event. `buffer_label` takes
     *  `{from}` + `{to}`. */
    legend_buffer: string;
    buffer_label: string;
    /** A live date hold. `hold_label` receives `{name}` (the couple) and
     *  `{remaining}`, which is built from the two below. */
    legend_hold: string;
    hold_label: string;
    /** Receives `{count}`. */
    hold_remaining_hours: string;
    hold_remaining_days: string;
    /** Short label on a blocked day's calendar pill. */
    blocked_pill_label: string;
    /** Receives `{date}` - the day a click would block. */
    block_day_title: string;
    /** Day-block editor modal. `block_editor_title` receives `{date}`. */
    block_editor_title: string;
    /** Aria-label for the whole-day / hours segmented control. */
    /** Accessible name of the calendar/tasks segmented control. */
    mode_label: string;
    block_mode_label: string;
    block_all_day: string;
    block_certain_hours: string;
    block_all_day_hint: string;
    block_from: string;
    block_to: string;
    /** Receives `{count}` - hours blocked in the chosen range. */
    block_hours_summary: string;
    block_save: string;
    block_remove: string;
    /** Compact pill badge on a partial-day block. Receives `{count}`. */
    block_hours_badge: string;
    /** Schedule/agenda + tooltip summary for a whole-day block. */
    blocked_all_day_label: string;
    /** Schedule/agenda + tooltip summary for a partial block. Receives
     *  `{from}`, `{to}`, `{count}`. */
    blocked_hours_label: string;
    section_availability: string;
    availability_intro: string;
    availability_add_label: string;
    availability_add: string;
    availability_empty: string;
    /** Receives `{date}`. */
    availability_remove: string;
    /** Receives `{date}`. */
    availability_next_free: string;
    availability_none_free: string;
    availability_blocked: string;
    availability_block_failed: string;
    availability_unblocked: string;
    availability_unblock_failed: string;
    availability_locked: string;
    availability_no_listing: string;
    task_add_label: string;
    task_add_placeholder: string;
    task_due_label: string;
    task_add: string;
    task_add_failed: string;
    tasks_empty: string;
    board_todo: string;
    board_doing: string;
    board_done: string;
    board_empty: string;
    board_move_prev: string;
    board_move_next: string;
    task_move_error: string;
    task_delete: string;
    task_delete_title: string;
    /** Receives `{title}` - the task title being deleted. */
    task_delete_body: string;
    task_delete_confirm: string;
    task_deleted: string;
    task_delete_failed: string;
  };
  /** Supplier Outreach Inbox (P2.E v1) — the in-app surface where a couple
   *  sends a localised cold-outreach mail to up to 5 shortlisted vendors
   *  per campaign and browses the sent history. Replies arrive in the
   *  couple's own email today; v1.5 wires the in-app thread. */
  outreach: {
    page_title: string;
    page_body: string;
    heading: string;
    subheading: string;
    new_campaign: string;
    reply_note: string;
    empty_title: string;
    empty_body: string;
    recipient_count: string;
    recipients_header: string;
    detail_loading: string;
    error_load: string;
    error_detail: string;
    send: string;
    sending: string;
    send_success: string;
    status_queued: string;
    status_sent: string;
    status_bounced: string;
    status_replied: string;
    compose_title: string;
    /** Confirm before a template chip discards a body the couple has typed. */
    tpl_overwrite_title: string;
    tpl_overwrite_body: string;
    tpl_overwrite_confirm: string;
    label_subject: string;
    label_body: string;
    label_suppliers: string;
    /** Picker input placeholder when the recipient list is empty. */
    suppliers_picker_placeholder: string;
    /** Help text under the picker — receives `{max}` (per-campaign cap). */
    suppliers_picker_help: string;
    /** Shown in the input when the cap is reached — receives `{max}`. */
    suppliers_picker_capped: string;
    /** No-results state — receives `{q}` (the current query). */
    suppliers_picker_no_matches: string;
    /** aria-label for the chip's × button — receives `{name}`. */
    suppliers_remove_aria: string;
    /** "n / max" counter next to the picker label. */
    suppliers_count: string;
    /** Label above the quick-fill template chips. */
    tpl_section_label: string;
    /** Substitute used in templates when wedding_date is missing. */
    tpl_placeholder_date: string;
    /** Substitute used in templates when target_guest_count is missing. */
    tpl_placeholder_guests: string;
    /** Quick-fill chip labels. */
    tpl_quote: string;
    tpl_availability: string;
    tpl_details: string;
    tpl_intro: string;
    /** Subject lines. Each takes `{date}`. */
    tpl_quote_subject: string;
    tpl_availability_subject: string;
    tpl_details_subject: string;
    tpl_intro_subject: string;
    /** Body templates. Each takes `{date}` and `{guests}`. */
    tpl_quote_body: string;
    tpl_availability_body: string;
    tpl_details_body: string;
    tpl_intro_body: string;
    err_no_suppliers: string;
    err_too_many_suppliers: string;
    err_rate_limited: string;
    err_supplier_not_found: string;
    err_supplier_no_email: string;
    /** A listing whose address is in `email_optouts`: the business asked us to
     *  stop mailing it, so a couple campaign cannot reach it either. */
    err_supplier_no_contact: string;
    err_generic: string;
  };
  /** The couple ↔ vendor conversation. One block for both portals, because
   *  `BookingThreadPanel` is one component rendered from either side. */
  thread: {
    empty: string;
    placeholder: string;
    send: string;
    sending: string;
    /** Paperclip button: aria-label + the title tooltip naming the limits. */
    attach: string;
    attach_hint: string;
    remove_file: string;
    /** Canned replies. Vendor-only, the couple never sees the toggle. */
    templates: string;
    templates_manage: string;
    templates_empty: string;
    template_title: string;
    template_body: string;
    /** Sits before the placeholder chips, e.g. "Insert:". */
    template_vars: string;
    template_add: string;
    template_update: string;
    template_cancel: string;
    template_saved: string;
    template_save_failed: string;
    template_delete_title: string;
    template_delete_confirm: string;
    /** Chip labels for the TEMPLATE_VARS tokens. The token itself stays
     *  locale-independent ({client_name}); only the button is translated. */
    var_client_name: string;
    var_event_date: string;
    var_vendor_name: string;
    /** Accessible names for the one / two / two-highlighted tick ladder. Keyed
     *  by MessageDeliveryStatus, so the three must stay in lockstep with it. */
    status_sent: string;
    status_delivered: string;
    status_seen: string;
    attachment_failed: string;
    send_failed: string;
    /** Receives `{max}` (MESSAGE_ATTACHMENTS_MAX). */
    too_many_files: string;
    /** Both receive `{name}` (the rejected file). */
    file_too_large: string;
    unsupported_file: string;
  };
  /** /app/messages — the couple's thread list, a single thread, and (second
   *  tab) the outreach history that used to live at /app/outreach. */
  messages: {
    page_title: string;
    page_body: string;
    empty_body: string;
    empty_cta: string;
    /** Prefix on the last-message preview when the couple wrote it. */
    you: string;
    back: string;
    /** Accessible name for the whole-row link into a conversation. The row also
     *  holds a link to the vendor's card, so neither can rely on the row's text
     *  for its name. */
    open_thread_aria: string;
    /** Tab row over the two halves of the surface. */
    tabs_aria: string;
    tab_threads: string;
    tab_outreach: string;
    call_vendor: string;
  };
  /** A vendor's quote (árajánlat) as BOTH sides read it: the shared
   *  `BookingQuoteCard` plus the couple's answer to it. Top-level rather than
   *  nested under `messages` because the vendor's client card renders the same
   *  card; the vendor's own EDITOR lives under `vendor.quotes`. */
  quotes: {
    /** Heading over the offers on a couple's thread. */
    section_title: string;
    /** Status pill, one per `QuoteStatus`. */
    status_draft: string;
    status_sent: string;
    status_viewed: string;
    status_accepted: string;
    status_declined: string;
    status_withdrawn: string;
    status_expired: string;
    total: string;
    deposit: string;
    /** Receives `{date}`. */
    valid_until: string;
    /** Label over what the couple typed when declining. */
    decline_reason: string;
    accept: string;
    decline: string;
    /** The optional reason prompt behind Decline. */
    decline_title: string;
    decline_label: string;
    decline_placeholder: string;
    /** Toasts on the couple's answer. */
    accepted: string;
    declined: string;
    answer_failed: string;
    /** 409 quote_not_answerable: the offer moved on before the tap landed. */
    not_answerable: string;
  };
  /** Page reached from the email_change_verify confirm link. */
  change_email: {
    page_title: string;
    page_loading: string;
    /** Success copy — receives `{email}` (the new address). */
    page_success: string;
    page_invalid: string;
  };
  onboarding: {
    welcome: string;
    intro: string;
    step1_title: string;
    step1_help: string;
    step1_short: string;
    step2_short: string;
    step3_short: string;
    step4_short: string;
    step5_short: string;
    step6_short: string;
    bride_name_label: string;
    groom_name_label: string;
    bride_name_placeholder: string;
    groom_name_placeholder: string;
    partner_one_label: string;
    partner_two_label: string;
    step2_title: string;
    wedding_date_label: string;
    /** Inline error under the exact-date input when the chosen day is in the
     *  past. */
    date_past_error: string;
    step3_title: string;
    target_guest_count_label: string;
    step4_title: string;
    budget_label: string;
    budget_help: string;
    step5_title: string;
    style_help: string;
    style_classic: string;
    style_modern: string;
    style_rustic: string;
    style_garden: string;
    style_bohemian: string;
    style_minimalist: string;
    style_vintage: string;
    style_destination: string;
    finish: string;
    saving: string;
    /** Submit-failed banner + retry button copy. */
    submit_failed: string;
    submit_retry: string;
    /** "All set" confirmation card shown after onboarding commits. */
    all_set_title: string;
    all_set_body: string;
    all_set_continue: string;
    // ── Country picker (step 5, repurposed from the deprecated style step) ──
    country_label: string;
    country_helper: string;
    country_placeholder: string;
    country_required: string;
    step6_title: string;
    invite_help: string;
    invite_email_label: string;
    invite_email_placeholder: string;
    invite_skip_hint: string;
    // ── Uncertainty: kind selectors and helper copy ───────────────────
    date_kind_question: string;
    date_kind_exact: string;
    date_kind_month: string;
    date_kind_season: string;
    date_kind_year: string;
    date_kind_tbd: string;
    date_year_label: string;
    date_month_label: string;
    date_season_label: string;
    date_kind_help_tbd: string;
    guest_kind_question: string;
    guest_kind_exact: string;
    guest_kind_range: string;
    guest_kind_tbd: string;
    guest_min_label: string;
    guest_max_label: string;
    budget_kind_question: string;
    budget_kind_exact: string;
    budget_kind_range: string;
    budget_kind_tbd: string;
    budget_min_label: string;
    budget_max_label: string;
    budget_preview_label: string;
    /** Currency picker pinned above the budget inputs in step 4. */
    budget_currency_label: string;
    // ── Ceremony kind — optional radio group on the Couple step ───────
    ceremony_kind_question: string;
    ceremony_kind_civil: string;
    ceremony_kind_religious: string;
    ceremony_kind_both: string;
    ceremony_kind_skip: string;
    ceremony_kind_help: string;
    // ── Already-onboarded welcome (partner B lands here after invite) ──
    welcome_existing_eyebrow: string;
    welcome_existing_title: string;
    welcome_existing_body: string;
    welcome_existing_date_label: string;
    welcome_existing_guests_label: string;
    welcome_existing_budget_label: string;
    welcome_existing_style_label: string;
    welcome_existing_edit_hint: string;
    welcome_existing_continue: string;
    // ── Extra-event section shown below the AllSet card ───────────────
    extra_events_heading: string;
    extra_events_body: string;
    extra_preset_civil: string;
    extra_preset_abroad: string;
    extra_preset_custom: string;
    extra_event_name_placeholder: string;
    extra_event_date_label: string;
    extra_enter_cta: string;
    extra_entering: string;
    extra_skip: string;
    /** Shown under the two name inputs once one of them has been refused,
     *  explaining why we care rather than just saying no. */
    real_names_why: string;
  };
  /** The real-name rule: the inline refusals on any name field, the notice a
   *  couple already inside the app gets, and the screen that stands in front of
   *  a workspace whose correction window has passed. */
  real_names: {
    error_too_short: string;
    error_role_word: string;
    error_placeholder: string;
    error_not_a_name: string;
    notice_title: string;
    notice_body: string;
    notice_cta: string;
    notice_deadline: string;
    locked_title: string;
    locked_body: string;
    locked_save: string;
    locked_saving: string;
    bride_label: string;
    groom_label: string;
    saved: string;
  };
  goal: {
    date_tbd: string;
    date_season: string;
    count_exact_one: string;
    count_exact_other: string;
    count_range: string;
    count_tbd: string;
    budget_tbd: string;
  };
  season: {
    spring: string;
    summer: string;
    fall: string;
    winter: string;
  };
  month: {
    "1": string;
    "2": string;
    "3": string;
    "4": string;
    "5": string;
    "6": string;
    "7": string;
    "8": string;
    "9": string;
    "10": string;
    "11": string;
    "12": string;
  };
  dashboard: {
    title: string;
    wedding_in_days: string;
    couple_label: string;
    invite_partner: string;
    invite_partner_help: string;
    partner_linked: string;
    copy_link: string;
    link_copied: string;
    /** Email-or-link invite flow on the dashboard. */
    invite_email_label: string;
    invite_email_placeholder: string;
    invite_email_help: string;
    invite_email_invalid: string;
    /** Client-side block when the inviter types their own email — accepting
     *  would self-link, so we refuse before hitting the API. */
    invite_email_own: string;
    invite_send: string;
    invite_sending: string;
    invite_sent: string;
    invite_pending_hint: string;
    invite_sent_title: string;
    invite_sent_body: string;
    invite_sent_spam_hint: string;
    invite_sent_backup_label: string;
    /** Replaces the old "Send to a different email" — the workspace tops out
     *  at two people, so we void the pending invite before showing the form
     *  again rather than chaining parallel tokens. */
    invite_cancel: string;
    invite_cancelling: string;
    invite_cancelled: string;
    target_guests: string;
    budget_ceiling: string;
    pick_up_where: string;
    coming_soon: string;
    coming_soon_headline: string;
    coming_soon_body: string;
    feature_budget: string;
    feature_guests: string;
    feature_seating: string;
    feature_print: string;
    feature_suppliers: string;
    // ── Kulcsinfó quick-access panel ─────────────────────────────────
    keyinfo_title: string;
    keyinfo_venue_label: string;
    keyinfo_map: string;
    keyinfo_call: string;
    keyinfo_suppliers: string;
    keyinfo_all_suppliers: string;
    keyinfo_no_venue: string;
    keyinfo_add_suppliers: string;
    keyinfo_edit: string;
    keyinfo_edit_title: string;
    keyinfo_coordinator: string;
    keyinfo_emergency: string;
    keyinfo_field_venue_name: string;
    keyinfo_field_venue_city: string;
    keyinfo_field_venue_address: string;
    keyinfo_field_venue_phone: string;
    keyinfo_field_name: string;
    keyinfo_field_phone: string;
    keyinfo_venue_suggestions: string;
    keyinfo_venue_current: string;
    // ── KPI dashboard ────────────────────────────────────────────────
    kpi_days_label: string;
    kpi_days_unit: string;
    kpi_days_tbd: string;
    kpi_days_edit_hint: string;
    kpi_guests_label: string;
    kpi_guests_unit: string;
    kpi_guests_planned: string;
    kpi_guests_no_data: string;
    kpi_budget_label: string;
    kpi_budget_unit: string;
    /** Tiny connector word between the spent total and the cap on the budget
     *  KPI tile. Rendered inline before the (interactive) cap value. */
    kpi_budget_unit_connector: string;
    kpi_budget_no_cap: string;
    /** Toast + tooltip surfaced when the cap value is single-clicked, telling
     *  the user the double-click affordance for editing the planned budget. */
    kpi_budget_edit_hint: string;
    /** Accessible name for the cap edit field while inline editing. */
    kpi_budget_edit_aria: string;
    /** Cost per guest, falling back from actual/confirmed to planned/target. */
    kpi_roi_label: string;
    kpi_roi_unit_actual: string;
    kpi_roi_unit_planned: string;
    kpi_roi_no_data: string;
    rsvp_breakdown_title: string;
    rsvp_yes: string;
    rsvp_no: string;
    rsvp_maybe: string;
    rsvp_pending: string;
    /** Footer summary line in the RSVP breakdown card — receives `{responded}` and `{total}`. */
    rsvp_responded_of_total: string;
    spend_title: string;
    spend_planned: string;
    spend_actual: string;
    spend_cap: string;
    cost_per_guest: string;
    /** Setup-nudge task labels — shown in UpcomingTasksCard until done. */
    task_set_date: string;
    task_lock_budget: string;
    task_lock_guests: string;
    task_invite_partner: string;
    task_add_guests: string;
    task_plan_budget: string;
    task_add_tables: string;
    /** Badge on setup-nudge rows inside the upcoming-tasks card. */
    upcoming_setup_badge: string;
    /** "Your upcoming tasks" — the couple's own dated planning items. */
    upcoming_title: string;
    /** Trailing chip on the upcoming-tasks card: "{n} upcoming". */
    upcoming_count: string;
    /** Footer link to the full planning page. */
    upcoming_view_all: string;
    /** Relative-due chips. Compact ("{n}d") to avoid plural grammar + fit the row. */
    upcoming_due_overdue: string;
    upcoming_due_today: string;
    upcoming_due_in: string;
    /** Empty state when the couple has no planning tasks at all — a nudge. */
    upcoming_empty_none: string;
    upcoming_empty_none_cta: string;
    /** Empty state when tasks exist but none are dated/pending — reassurance. */
    upcoming_empty_clear: string;
    upcoming_next_step_lock_date: string;
    /** Soft hint shown above the recently-added-tasks fallback list (no dates yet). */
    upcoming_undated_hint: string;
    upcoming_settings_topic: string;
    upcoming_settings_topic_wedding: string;
    upcoming_settings_topic_honeymoon: string;
    upcoming_settings_topic_all: string;
    upcoming_settings_count: string;
    quick_links_title: string;
    /** Dashboard spending donuts: paid-vs-planned + category breakdown. */
    charts: {
      title: string;
      paid_title: string;
      paid_center: string;
      planned_label: string;
      paid_label: string;
      remaining_label: string;
      over_label: string;
      distribution_title: string;
      distribution_empty: string;
      other: string;
      of_total: string;
      details_title: string;
      flip_to_details: string;
      flip_to_chart: string;
      lines_count: string;
      settled_count: string;
      over_lines: string;
      avg_per_line: string;
      largest_line: string;
      over_hint: string;
    };
    set_date_dialog_title: string;
    set_date_dialog_body: string;
    set_date_dialog_save: string;
    /** When the wedding date is in the past, the days-to-go tile flips to a celebration. */
    kpi_days_past: string;
    kpi_days_past_sub: string;
    kpi_days_past_seating_pdf: string;
    kpi_days_past_guest_csv: string;
    /** "Total spend" tile shown when eloping / no guest target — replaces
     *  the per-guest cost tile so the dashboard still has 4 KPIs. */
    kpi_total_spend_label: string;
    kpi_total_spend_unit: string;
    /** Date-changed notify CTA — shown when `previous_wedding_date` differs
     *  from the current `wedding_date`. */
    date_changed_title: string;
    date_changed_body: string;
    date_changed_button: string;
    date_changed_dismiss_aria: string;
    date_changed_sending: string;
    date_changed_confirm_title: string;
    date_changed_confirm_body: string;
    date_changed_confirm_yes: string;
    date_changed_done: string;
    date_changed_no_emails: string;
    /** Archive workspace CTA — appears next to the post-wedding download links. */
    archive_workspace_button: string;
    archive_workspace_confirm_title: string;
    archive_workspace_confirm_body: string;
    archive_workspace_confirm_yes: string;
    archive_workspace_done: string;
    // ── Day-of dashboard (daysUntil <= 1) ─────────────────────────────
    /** Hero copy for the day-of layout — replaces the planning KPI grid. */
    day_of_mode_title: string;
    day_of_today_label: string;
    day_of_tomorrow_label: string;
    day_of_checkin_title: string;
    day_of_checkin_intro: string;
    day_of_checkin_copy: string;
    day_of_checkin_copied: string;
    day_of_checkin_no_slug: string;
    /** Inline TODO line shown where the QR code will eventually live. */
    day_of_qr_todo: string;
    welcome_desk_open: string;
    welcome_desk_help: string;
    day_of_stats_yes: string;
    day_of_stats_checked_in: string;
    day_of_dietary_title: string;
    day_of_dietary_empty: string;
    day_of_schedule_title: string;
    day_of_schedule_empty: string;
    day_of_schedule_open: string;
    day_of_print_title: string;
    day_of_print_place_cards: string;
    day_of_print_seating: string;
    // ── Caterer summary tile (planning-mode, daysUntil <= 7) ──────────
    caterer_title: string;
    caterer_sub: string;
    caterer_copy: string;
    caterer_copied: string;
    /** Receives `{n}` — total counted guests. */
    caterer_total: string;
    caterer_label_meat: string;
    caterer_label_fish: string;
    caterer_label_vegetarian: string;
    caterer_label_vegan: string;
    caterer_label_child: string;
    caterer_label_none: string;
    caterer_label_unspecified: string;
    caterer_label_gluten: string;
    caterer_label_lactose: string;
    caterer_label_milk_protein: string;
    caterer_label_nut: string;
    caterer_label_egg: string;
    caterer_label_fish_shellfish: string;
    caterer_label_other: string;
  };
  invite: {
    title: string;
    intro: string;
    expired: string;
    accept: string;
    accepting: string;
    need_account: string;
    /** Shown when the logged-in viewer IS the inviter (owner of the couple).
     *  Replaces the accept button with a share-this-with-X panel. */
    own_invite_title: string;
    own_invite_body: string;
    own_invite_share_label: string;
    own_invite_copy: string;
    own_invite_copied: string;
    /** Per-code 409 error copy that beats the generic "valami félrement". */
    already_in_other_couple: string;
    couple_full: string;
    couple_gone: string;
    /** Shown on the invite page when a logged-in user with their own workspace
     *  visits a valid invite. Replaces the dead-end error with merge context. */
    merge_from_invite_body: string;
    /** Dashboard banner shown when the user has a solo workspace AND there's
     *  a pending partner-invite addressed to their email. Accepting it via
     *  the merge flow purges their solo workspace and links them as partner
     *  B on the inviting couple — irreversible, so the confirm modal asks
     *  the user to type "MERGE" verbatim. */
    merge_banner_body: string;
    merge_banner_warning: string;
    merge_banner_cta: string;
    merge_confirm_title: string;
    merge_confirm_label: string;
    merge_confirm_help: string;
    merge_confirm_button: string;
    merge_confirm_mismatch: string;
    merge_running: string;
    merge_success: string;
  };
  /** Public newsletter capture (landing + blog) and the confirm/unsubscribe
   *  landing pages the emailed links point at. */
  newsletter: {
    title: string;
    email_placeholder: string;
    /** Checkbox label; consent_link is the trailing privacy-policy anchor. */
    consent: string;
    consent_link: string;
    submit: string;
    submitting: string;
    success_title: string;
    success_body: string;
    error_consent: string;
    confirm_working: string;
    confirm_success_title: string;
    confirm_success_body: string;
    confirm_expired_title: string;
    confirm_expired_body: string;
    confirm_invalid_title: string;
    confirm_invalid_body: string;
    unsub_success_title: string;
    unsub_success_body: string;
    back_home: string;
  };
  landing: {
    hero_title: string;
    hero_sub: string;
    cta_signup: string;
    cta_login: string;
    cta_open_app: string;
    /** Wedding-site copy surfaced by the SEO prerender SSR body
     *  (frontend/scripts/prerender.ts). The dedicated landing section was
     *  cut; the React landing now mentions the wedding-site feature as one
     *  bullet inside the Guests block. */
    wsite_title: string;
    wsite_body: string;
    /** Top-of-fold brand tagline — was hardcoded "Budapest · Paper letters"
     *  before the EN parity pass. HU keeps the Budapest reference because
     *  it's accurate for HU readers; EN reads as a neutral product line. */
    brand_tagline_paper: string;
    demo_title: string;
    demo_guests_label: string;
    demo_budget_label: string;
    demo_per_guest_label: string;
    demo_per_guest_sub: string;
    demo_breakdown_eyebrow: string;
    demo_breakdown_sub: string;
    demo_total_label: string;
    /** Directory rail under the calculator (opt-in, see InteractiveBudgetDemo
     *  `vendorTeaser`). `_body` takes {n} = photographed listings in the whole
     *  directory; `_body_plain` is the same line without the count, used while
     *  the number is still too small to help. */
    demo_vendors_title: string;
    demo_vendors_body: string;
    demo_vendors_body_plain: string;
    demo_vendors_cta: string;
    demo_vendors_browse: string;
    demo_cta: string;
    demo_cat_food_drinks: string;
    demo_cat_venue: string;
    demo_cat_photo_video: string;
    demo_cat_decor_floral: string;
    demo_cat_attire_beauty: string;
    demo_cat_music_dj: string;
    demo_cat_ceremony_services: string;
    demo_cat_stationery_smalls: string;
    demo_cat_reserve: string;
    /** Landing-page demo launch card — small tilted sticker on the right
     *  of the hero. Eyebrow + title + button + loading/error states. */
    demo_card_eyebrow: string;
    demo_card_title: string;
    demo_card_cta: string;
    demo_card_loading: string;
    demo_card_error: string;
    faq_title: string;
    /** "+N more questions" button that reveals the collapsed landing FAQ items. */
    faq_show_more: string;
    // FAQ Q&A pairs moved to shared/seo_faq.ts so the visible landing FAQ
    // and the FAQPage JSON-LD share a single source. Only faq_title (the
    // section heading) lives here.
    closing_title: string;
    closing_body: string;
    // ── Soft-Modern redesign additions ───────────────────────────────
    nav_how: string;
    nav_suppliers: string;
    nav_vendors: string;
    /** Header link opening the feedback dialog. */
    nav_feedback: string;
    /** Subject line preserved on the email the backend forwards. */
    nav_feedback_subject: string;
    feedback_title: string;
    feedback_intro: string;
    /** Shown above the form when the dialog was opened from a link we mailed to
     *  a known address (the pause follow-up), so the page answers the question
     *  the email asked instead of restarting the conversation. */
    feedback_preface_invited: string;
    feedback_message_label: string;
    feedback_message_placeholder: string;
    feedback_rating_label: string;
    feedback_rating_hint: string;
    feedback_rating_low: string;
    feedback_rating_high: string;
    feedback_reply_optin: string;
    feedback_email_label: string;
    feedback_email_help: string;
    feedback_submit: string;
    feedback_submitting: string;
    feedback_cancel: string;
    feedback_empty_error: string;
    feedback_success_title: string;
    feedback_success_body: string;
    vendor_pill: string;
    guest_link: string;
    phases_title: string;
    phase_plan_title: string;
    phase_plan_body: string;
    phase_suppliers_title: string;
    phase_suppliers_body: string;
    phase_guests_title: string;
    phase_guests_body: string;
    phase_seating_title: string;
    phase_seating_body: string;
    phase_aftermath_title: string;
    phase_aftermath_body: string;
    audience_title: string;
    card_couples_title: string;
    card_couples_body: string;
    card_couples_cta: string;
    card_vendors_title: string;
    card_vendors_body: string;
    card_vendors_cta: string;
    card_planners_title: string;
    card_planners_cta: string;
    card_guests_title: string;
    card_guests_body: string;
    card_guests_cta: string;
    suppliers_section_title: string;
    /** The three directory doors on the landing suppliers block: find one,
     *  name one, be one. Each row is label + one supporting line. */
    /** The directory typeahead that replaced the "find a supplier" row. */
    suppliers_search_label: string;
    suppliers_search_placeholder: string;
    suppliers_search_submit: string;
    /** Always-present last row: the whole directory, unfiltered. */
    suppliers_search_all: string;
    /** Context line under a town or category hit: how many are listed. */
    suppliers_search_count: string;
    suppliers_search_count_one: string;
    suppliers_action_suggest_label: string;
    suppliers_action_suggest_sub: string;
    suppliers_action_join_label: string;
    suppliers_action_join_sub: string;
    guest_sheet_title: string;
    guest_sheet_body: string;
    guest_sheet_label: string;
    guest_sheet_placeholder: string;
    guest_sheet_cta: string;
    guest_sheet_cancel: string;
    guest_sheet_invalid: string;
    footer_tagline: string;
    footer_social_tiktok: string;
    footer_social_facebook: string;
    footer_social_instagram: string;
    footer_couples: string;
    footer_vendors: string;
    footer_guests: string;
    footer_couples_signup: string;
    footer_couples_signin: string;
    footer_couples_features: string;
    footer_couples_cards: string;
    footer_vendors_waitlist: string;
    footer_vendors_about: string;
    footer_guests_enter: string;
    footer_guests_about: string;
    footer_legal_terms: string;
    footer_legal_privacy: string;
    footer_legal_about: string;
    footer_legal_imprint: string;
    footer_legal_subscription: string;
    /** Replaces the second vendor-direction link in the For-vendors footer
     *  column (the original `footer_vendors_about` also pointed at
     *  /vendors, creating a duplicate). Now links to /about. */
    footer_about_link: string;
    footer_planners: string;
    footer_planners_waitlist: string;
    nav_planners: string;
    footer_band_prompt: string;
    footer_band_cta: string;
    /** Compact guest-chip label for narrow (phone) viewports. */
    footer_band_cta_short: string;
    footer_band_cta_vendor: string;
    footer_band_cta_planner: string;
    footer_band_cta_couples: string;
    skip_to_main: string;
    couple_cards_eyebrow: string;
    couple_cards_title: string;
    // ── Round 2: stats strip + product features + testimonials ────────
    stats_eyebrow: string;
    stats_a_value: string;
    stats_a_label: string;
    stats_b_value: string;
    stats_b_label: string;
    stats_c_value: string;
    stats_c_label: string;
    stats_footnote: string;
    counter_eyebrow: string;
    counter_couples_label: string;
    counter_rsvps_label: string;
    founders_title: string;
    /** One-line promise under the title: first 200 sign-ups are free until
     *  their wedding day. Carries the offer now that the eyebrow is gone. */
    founders_promise: string;
    /** Uppercase tag under the big "200" (e.g. "free spots"). */
    founders_seats_label: string;
    /** Caption after the live booked count in the progress sliver. */
    founders_joined_caption: string;
    /** Caption after the live remaining-seats count (e.g. "left"). */
    founders_left_caption: string;
    founders_body: string;
    founders_note: string;
    founders_cta: string;
    founders_share_prompt: string;
    founders_share_cta: string;
    founders_share_copied: string;
    founders_share_title: string;
    founders_share_text: string;
    product_eyebrow: string;
    product_title: string;
    block_budget_eyebrow: string;
    block_budget_title: string;
    block_budget_body: string;
    block_budget_bullet_1: string;
    block_budget_bullet_2: string;
    block_budget_bullet_3: string;
    block_guests_eyebrow: string;
    block_guests_title: string;
    block_guests_body: string;
    block_guests_bullet_1: string;
    block_guests_bullet_2: string;
    block_guests_bullet_3: string;
    block_guests_bullet_4: string;
    /** Guest-side escape hatch on the RSVP block: a guest who lost their
     *  invite link ends up on the landing page, and /rsvp is the lookup
     *  that gets them to their own page. */
    block_guests_cta: string;
    block_seating_eyebrow: string;
    block_seating_title: string;
    block_seating_body: string;
    block_seating_bullet_1: string;
    block_seating_bullet_2: string;
    block_seating_bullet_3: string;
    testimonials_eyebrow: string;
    testimonials_title: string;
    t1_quote: string;
    t1_name: string;
    t1_meta: string;
    t2_quote: string;
    t2_name: string;
    t2_meta: string;
    t3_quote: string;
    t3_name: string;
    t3_meta: string;
    // ── Round 3: pricing block + why-us + mockup labels ───────────────
    pricing_title: string;
    pricing_body: string;
    /** Big serif number on the price card ("5" / "1 990"). */
    pricing_amount: string;
    /** Superscript decimal shown after the big amount (EUR "90" → ".90");
     *  empty for whole-unit currencies like HUF. */
    pricing_amount_decimal: string;
    /** Per-period suffix beside the price ("/ month" / "/ hó"). */
    pricing_amount_sub: string;
    /** Early-access window + the regular price it reverts to after the cutover. */
    pricing_early_note: string;
    /** Tooltip on the price "i" — the low-cortisol / BigMac value line. */
    pricing_value_note: string;
    /** Highlighted founding-offer callout: free for the first 200 couples. */
    pricing_after: string;
    /** Full founding-offer explanation, surfaced behind the callout's info icon. */
    pricing_after_detail: string;
    pricing_bullet_1: string;
    pricing_bullet_2: string;
    pricing_bullet_3: string;
    pricing_bullet_4: string;
    /** Referral value-prop bullet on the pricing card — the program itself
     *  lives in Settings → Billing once signed in. */
    pricing_bullet_referral: string;
    pricing_v2_note: string;
    /** aria-labels for the four decorative landing-page SVG mockups. */
    mockup_aria_budget: string;
    mockup_aria_guests: string;
    mockup_aria_seating: string;
    mockup_aria_vendor: string;
    mockup_live_budget_label: string;
    mockup_total_spend: string;
    /** Pre-formatted amounts inside the budget SVG mockup. HU shows the
     *  amount in Ft, EN in € so an English-speaking visitor never sees
     *  a Hungarian-forint amount on the landing — that's the "mentally
     *  walks away" friction point a strategic agent flagged. */
    mockup_budget_total_compact: string;
    mockup_search_placeholder: string;
    mockup_filter_all: string;
    mockup_filter_pending: string;
    mockup_col_name: string;
    mockup_col_status: string;
    mockup_col_meal: string;
    mockup_status_pending: string;
    mockup_canvas_label: string;
    mockup_add_table: string;
    mockup_table_family: string;
    mockup_table_friends: string;
    mockup_table_plus_ones: string;
    mockup_table_work: string;
    mockup_table_uni: string;
    mockup_table_head: string;
    mockup_drag_subtitle: string;
    /** Vendor card preview, ride-hailing layout: name + rating on one row,
     *  category / city / price band on the next, no button. Every value is a
     *  placeholder showing the SHAPE of the field, which is why the rating is
     *  a bare number (`4,9` in HU, `4.9` in EN) with no review count beside it
     *  and the price band is the same `$` repeat the real cards use. */
    mockup_vendor_name: string;
    mockup_vendor_category: string;
    mockup_vendor_rating: string;
    mockup_vendor_price: string;
  };
  vendors: {
    seo_title: string;
    seo_description: string;
    pill: string;
    wrong_audience: string;
    couple_escape_link: string;
    planner_escape_link: string;
    /** Hero. The title is an INSTRUCTION to the vendor naming the mechanic
     *  ("get on the short list"), not a claim about us ("couples pick their
     *  suppliers here") — the vendor's own move is the point. It stands alone:
     *  the sub-line that restated the mechanic, the effort claim under the CTA
     *  and the free-window promise (founding / early) are all gone, so nothing
     *  sits between the headline and the button. */
    hero_title: string;
    /** Closing band: headline and the single repeat of the CTA. No sub-line:
     *  it only repeated the hero microcopy. The headline must take a DIFFERENT
     *  angle from the hero title (it used to paraphrase it) — timing, not the
     *  same "couples choose here" claim said twice. */
    closing_title: string;
    closing_cta: string;
    benefit_1_title: string;
    benefit_1_body: string;
    benefit_2_title: string;
    benefit_2_body: string;
    benefit_3_title: string;
    benefit_3_body: string;
    form_title: string;
    form_business_label: string;
    form_email_label: string;
    form_category_label: string;
    form_category_placeholder: string;
    form_location_label: string;
    form_location_placeholder: string;
    form_travel_radius_label: string;
    form_travel_radius_hint: string;
    form_website_label: string;
    form_website_placeholder: string;
    form_submit: string;
    form_submitting: string;
    form_success_title: string;
    form_success_body: string;
    /** New: real waitlist form fields + validation copy. */
    form_message_label: string;
    form_message_placeholder: string;
    form_err_required: string;
    form_err_email: string;
    form_err_category: string;
    form_err_rate_limited: string;
    /** Legacy mailto-based interest CTA — kept around in case the form path
     *  is ever rolled back. */
    contact_title: string;
    contact_body: string;
    contact_cta: string;
    step_1_title: string;
    step_1_short: string;
    step_1_sub: string;
    step_2_title: string;
    step_2_short: string;
    step_2_sub: string;
    step_3_title: string;
    step_3_short: string;
    step_3_sub: string;
    step_4_title: string;
    step_4_short: string;
    step_4_sub: string;
    form_tax_number_label: string;
    form_tax_number_placeholder: string;
    form_tax_number_hint: string;
    form_reg_number_label: string;
    form_reg_number_placeholder: string;
    form_reg_number_hint: string;
    step_next: string;
    step_back: string;
    contact_subject: string;
    /** Recommend-a-supplier share prompt on the vendor site: a shareable link
     *  so word-of-mouth supplier recommendations reach more couples. */
    recommend_title: string;
    /** CTA that opens the register-a-supplier modal (visitor mode). Phrase it
     *  as "I recommend THEM", first person, parallel with the share CTA next
     *  to it: "register a supplier" was read as "sign myself up". */
    recommend_register_cta: string;
    recommend_share_cta: string;
    /** Text put on the clipboard / into the native share sheet (the URL is
     *  appended in code). */
    recommend_share_message: string;
    recommend_copied: string;
    back_to_landing: string;
    /** Beta + future-monetization notice shown above the waitlist form so
     *  vendors understand the directory is free during the beta and that a
     *  paid model will follow once the platform exits beta. */
    beta_notice_title: string;
    beta_notice_body: string;
    /** Inline link under the beta notice that points at the future
     *  paid-tier ÁSZF page. Reads cleaner without the "(draft)" label —
     *  the page itself still carries the draft banner. */
    beta_notice_terms_link: string;
    /** GDPR consent checkbox before submit. Same three-piece split as the
     *  register page so the policy link is a real <Link>. */
    privacy_consent_prefix: string;
    privacy_consent_link: string;
    privacy_consent_suffix: string;
    privacy_required_hint: string;
    form_err_privacy_consent: string;
    /** Numbered section titles in the redesigned waitlist form. The form is
     *  split into three vertical sections so vendors can scan it before
     *  filling — Cég, Kapcsolat, Portfólió. */
    section_business_title: string;
    section_business_sub: string;
    section_contact_title: string;
    section_contact_sub: string;
    section_portfolio_title: string;
    section_portfolio_sub: string;
    /** Small "opcionális" / "optional" suffix shown after a section title
     *  to communicate that the whole section is optional. */
    section_optional_label: string;
    /** Portfolio submission block. The per-category help text is keyed
     *  through `portfolio_hint_<group>` (six groups, mirrors SUPPLIER_GROUPS)
     *  so the form swaps the helper text + placeholder as the category
     *  dropdown changes. */
    portfolio_links_label: string;
    portfolio_links_placeholder: string;
    portfolio_link_remove: string;
    portfolio_add_link: string;
    portfolio_count_hint: string;
    portfolio_hint_default: string;
    portfolio_hint_venue_stay: string;
    portfolio_hint_food_drink: string;
    portfolio_hint_atmosphere: string;
    portfolio_hint_experience: string;
    portfolio_hint_style: string;
    portfolio_hint_details: string;
    instagram_label: string;
    instagram_placeholder: string;
    form_err_portfolio_link: string;
    form_err_travel_radius: string;
    form_err_instagram_handle: string;
    form_err_price_list_size: string;
    price_list_label: string;
    price_list_hint: string;
    price_list_upload_cta: string;
    price_list_remove: string;
    signup_cta: string;
    demo_cta: string;
    demo_loading: string;
    demo_error: string;
  };
  vendor_register: {
    err_listing_exists: string;
    seo_title: string;
    seo_description: string;
    title: string;
    subtitle: string;
    /** Stepper labels: account basics, then company identity. */
    step_account: string;
    step_business: string;
    email_required: string;
    optional_details_toggle: string;
    optional_details_hint: string;
    business_name_label: string;
    business_name_help: string;
    business_name_required: string;
    company_name_label: string;
    company_name_help: string;
    category_label: string;
    category_placeholder: string;
    category_required: string;
    /** The "my service isn't listed" escape hatch in the category select. */
    category_other_option: string;
    /** Redirect for planners, who onboard via /planners, not the vendor flow. */
    planner_hint: string;
    planner_hint_link: string;
    custom_category_label: string;
    custom_category_placeholder: string;
    custom_category_required: string;
    /** Company identity fields (auto-filled by the registry lookup). */
    country_label: string;
    registry_number_label: string;
    vat_number_label: string;
    address_label: string;
    city_label: string;
    postal_code_label: string;
    phone_label: string;
    website_label: string;
    /** Post-signup confetti screen. */
    success_title: string;
    success_body: string;
    /** Shown instead of success_body when the account is already verified
     *  (Google signup). */
    success_body_verified: string;
    /** Step-2 banner when the vendor chose Google on step 1. Takes {email}. */
    google_continue_as: string;
    submit: string;
    continue_to_onboarding: string;
  };
  vendor_onboarding: {
    step_label_profile: string;
    step_label_listing: string;
    your_business: string;
    welcome_title: string;
    welcome_body: string;
    welcome_cta: string;
    profile_title: string;
    profile_body: string;
    city_label: string;
    city_required: string;
    phone_label: string;
    phone_placeholder: string;
    /** Shown under the phone input the moment it loses focus with something
     *  that isn't a number. Field-level, never a form-level "couldn't save". */
    phone_invalid: string;
    website_label: string;
    website_placeholder: string;
    website_invalid: string;
    save_error: string;
    listing_title: string;
    listing_body: string;
    /** No blurb/photo labels: step 2 is laid out as the listing card itself,
     *  so the shape names the parts and the placeholder carries the ask. */
    blurb_placeholder: string;
    price_band_label: string;
    hero_cta: string;
    hero_replace: string;
    hero_uploading: string;
    hero_error: string;
    /** The one question before publishing a listing with neither photo nor
     *  text. `empty_body` states how the card renders; it must never quote a
     *  conversion statistic we can't back. */
    empty_title: string;
    empty_body: string;
    empty_upload: string;
    skip: string;
    done_title: string;
    done_body: string;
    done_cta: string;
  };
  public: {
    menu_open: string;
    menu_close: string;
    /** Landmark labels for the marketing header navs (screen-reader only). */
    nav_audience_aria: string;
    nav_mobile_aria: string;
  };
  nav: {
    dashboard: string;
    guests: string;
    budget: string;
    seating: string;
    /** Accommodation + transfer assignment — sidebar only, sits after seating. */
    logistics: string;
    /** Day-of run-of-show timeline page — sidebar only. */
    schedule: string;
    suppliers: string;
    /** Vendor conversations AND the outreach the couple sent — one rail row,
     *  two tabs of /app/messages. Always carried: one inquiry is enough for a
     *  vendor to write back. */
    messages: string;
    /** Free-form planning surface (tasks / ideas / wedding-day schedule). */
    planning: string;
    /** Gantt-style timeline + point-of-contact panel — sidebar only. */
    timeline: string;
    /** Post-wedding follow-up surfaces — honeymoon planning + photo share. */
    honeymoon: string;
    /** Pre-wedding inspiration — embeds a Pinterest board the couple links. */
    moodboard: string;
    /** Curated visual-identity editor — sits next to the moodboard. */
    design: string;
    media: string;
    print: string;
    /** Merged guest-facing surface — single sidebar entry pointing at
     *  /app/guest-page. Replaces the older split between the wedding-site
     *  editor and the gated guest-portal preview. */
    guest_page: string;
    /** Couple-curated wishlist / gift registry — sidebar + More-sheet entry
     *  sitting just above the guest-page link in the `guest` group. */
    wishlist: string;
    /** Sidebar group headers that bundle the rail into the four phases
     *  of the wedding journey. `guest` is the read-only portal preview;
     *  the other three carry the couple from decisions → wedding-day ops
     *  → before-and-after inspiration. */
    group_planning: string;
    group_executing: string;
    group_dreaming: string;
    group_guest: string;
    /** Accessible label for the locale toggle. */
    switch_language: string;
    /** Word for the *target* language shown next to the globe. */
    switch_to_en: string;
    switch_to_hu: string;
    /** Accessible labels for the dark/light theme toggle in /app header. */
    switch_to_dark: string;
    switch_to_light: string;
    /** Short variants for the bottom nav, in case full labels truncate. */
    tab_dashboard: string;
    tab_guests: string;
    tab_budget: string;
    tab_seating: string;
    tab_suppliers: string;
    /** Mobile bottom nav "more" button — opens a sheet with the remaining flows. */
    tab_more: string;
    unexplored: string;
    more_sheet_title: string;
    /** Aria-labels for the desktop sidebar collapse toggle. Pair shown on the
     *  small chevron button that narrows the rail to icons-only. */
    sidebar_collapse: string;
    sidebar_expand: string;
  };
  /** Free-form planning surface — three tabs over the planning_items table. */
  planning: {
    title: string;
    sub: string;
    /** aria-label for the tablist wrapping the three category tabs. */
    tabs_aria: string;
    tab_tasks: string;
    tab_ideas: string;
    tab_decisions: string;
    tab_schedule: string;
    /** Hover tooltips under each tab name, for instant scannability of what
     *  each surface is for. */
    tab_tasks_tip: string;
    tab_ideas_tip: string;
    tab_decisions_tip: string;
    /** "Döntések" decision-prompt deck. */
    decisions: {
      intake_title: string;
      generate_error: string;
      save_error: string;
      open_count: string;
      consider_count: string;
      total_count: string;
      group_empty: string;
      kind_decision: string;
      kind_check: string;
      kind_todo: string;
      ask_supplier: string;
      resolution_placeholder: string;
      decided_label: string;
      action_decide: string;
      action_record_answer: string;
      action_done: string;
      action_promote: string;
      action_not_relevant: string;
      action_edit: string;
      action_reopen: string;
      action_restore: string;
      promoted_toast: string;
      show_dismissed: string;
      hide_dismissed: string;
      /** Overall decision progress line above the personalization strip. */
      progress_label: string;
      /** Personalization "setup strip": kicker + answered-count chip + collapse bar. */
      setup_start_here: string;
      setup_answered: string;
      setup_label: string;
      setup_done: string;
      setup_continue: string;
      /** Decision-log: add a one-line resolution note to a decided item. */
      action_add_note: string;
    };
    /** Quick-add form CTA. */
    add: string;
    /** Per-tab placeholder for the quick-add title input. */
    task_placeholder: string;
    idea_placeholder: string;
    schedule_placeholder: string;
    /** Inputs surfaced inline next to the quick-add title. */
    start_date_label: string;
    due_date_label: string;
    time_label: string;
    /** Expanded-row notes textarea placeholder. */
    body_placeholder: string;
    /** Label on the chip a bare URL inside a task body is rendered as. */
    body_open_link: string;
    /** Task checkbox a11y labels (one for each toggle direction). */
    mark_done: string;
    mark_undone: string;
    /** Aria + tooltip for the up/down reorder buttons on each row. */
    move_up: string;
    move_down: string;
    delete_confirm_title: string;
    delete_confirm_body: string;
    /** Empty-state copy per tab. */
    empty_task: string;
    empty_idea: string;
    empty_schedule: string;
    /** Wedding-day template (varázspálca) — generator button on the Schedule tab. */
    template_button: string;
    template_button_hint: string;
    template_dialog_title: string;
    template_dialog_body: string;
    template_ceremony_label: string;
    template_confirm: string;
    template_warning_existing: string;
    template_preview_label: string;
    /** Success toast (plural variants). */
    template_done_one: string;
    template_done_other: string;
    /** Assignee chip on tasks + idea-suggester byline. `assignee_add` labels
     *  the dashed "+ owner" affordance shown on tasks with no owner set. */
    assignee_label: string;
    assignee_placeholder: string;
    assignee_add: string;
    assignee_edit_hint: string;
    /** Inline "+ Who does this?" prompt on the quick-add task form. */
    assignee_quick_placeholder: string;
    /** Stand-in for a partner in the owner picker while the couple has typed
     *  no bride/groom name yet. These render where a PERSON's name goes, so
     *  they have to read as one, not as the name of a form field. */
    assignee_bride: string;
    assignee_groom: string;
    idea_suggested_by: string;
    /** Cross-link from the Tasks tab toolbar to the /app/timeline Gantt view. */
    timeline_link: string;
    timeline_link_hint: string;
    /** Section headers above the strictly-separated task groups on the
     *  Tasks tab. Only rendered when at least two groups have items. */
    task_group_wedding: string;
    task_group_honeymoon: string;
    task_group_other: string;
    /** "{done}/{total} done" completion pill on each task group header. */
    group_done_count: string;
    /** SOS / important flag button + filter pills above the task list. */
    priority_filter_aria: string;
    priority_filter_all: string;
    priority_filter_important: string;
    priority_filter_sos: string;
    priority_set_important: string;
    priority_set_sos: string;
    priority_clear: string;
    /** Safe-timeline generator button + dialog on the Tasks tab. Turns the
     *  canonical wedding timeline into dated tasks behind a confirm step.
     *  `*_confirm_count` + `*_done` use plural variants. */
    timeline_gen_button: string;
    timeline_gen_button_hint: string;
    timeline_gen_dialog_title: string;
    timeline_gen_dialog_body: string;
    timeline_gen_no_date: string;
    timeline_gen_already: string;
    timeline_gen_confirm_count_one: string;
    timeline_gen_confirm_count_other: string;
    timeline_gen_done_one: string;
    timeline_gen_done_other: string;
    /** Task row status chips (overdue / due-soon), derived from the due date. */
    status_overdue: string;
    status_due_soon: string;
    /** Task tab wand button + dialog. */
    task_template_button: string;
    task_template_button_hint: string;
    task_template_dialog_title: string;
    task_template_dialog_body: string;
    task_template_default_assignee_label: string;
    task_template_default_assignee_placeholder: string;
    /** Per-item selection inside the wand template dialogs (tasks + ideas).
     *  `template_select_label` takes `{count}` + `{total}`. `template_confirm_count`
     *  is the primary CTA — it shows the count and uses plural variants. */
    template_select_label: string;
    template_select_all: string;
    template_select_none: string;
    template_confirm_count_one: string;
    template_confirm_count_other: string;
    template_tasks_done_one: string;
    template_tasks_done_other: string;
    /** Idea tab wand button + dialog. */
    idea_template_button: string;
    idea_template_button_hint: string;
    idea_template_dialog_title: string;
    idea_template_dialog_body: string;
    template_ideas_done_one: string;
    template_ideas_done_other: string;
    /** Dice (🎲) randomiser on the Idea tab. */
    dice_button: string;
    dice_button_hint: string;
    dice_dialog_title: string;
    dice_dialog_body: string;
    dice_add: string;
    dice_added: string;
    dice_reroll: string;
    dice_close: string;
    dice_added_one: string;
    dice_added_other: string;
    /** Template event titles, in wedding-night order. */
    template_preparations: string;
    template_guests_arrive: string;
    template_ceremony: string;
    template_congrats: string;
    template_group_photo: string;
    template_cocktail: string;
    template_dinner: string;
    template_cake: string;
    template_first_dance: string;
    template_party: string;
    template_bride_dance: string;
    // Board (kanban) view toggle + columns + filter chips.
    view_list: string;
    view_board: string;
    board_col_todo: string;
    board_col_inprogress: string;
    board_col_done: string;
    board_filter_all: string;
    board_filter_tasks: string;
    board_filter_vendors: string;
    board_vendor_paid_badge: string;
    board_vendor_considering_badge: string;
    board_vendor_inprogress_badge: string;
    board_vendor_add: string;
    board_vendor_create_title: string;
    board_vendor_edit_title: string;
    board_vendor_name_label: string;
    board_vendor_category_label: string;
    board_vendor_next_step_label: string;
    board_vendor_next_step_placeholder: string;
    board_vendor_next_step_required: string;
    board_vendor_probability_label: string;
    board_vendor_amount_label: string;
    board_vendor_save: string;
    board_vendor_delete_confirm: string;
    /** "Recommended for you" curated idea section, computed from the
     *  personalization intake answers. */
    recommended_title: string;
    recommended_sub: string;
    recommended_added: string;
    recommended_empty_nudge: string;
    recommended_empty_cta: string;
    /** Dice entry point surfaced on the Ideas empty state. */
    dice_empty_cta: string;
    /** Idea category tag labels (one per IdeaTag) + picker affordances. */
    idea_tag_program: string;
    idea_tag_decor: string;
    idea_tag_surprise: string;
    idea_tag_keepsake: string;
    idea_tag_experience: string;
    idea_tag_set: string;
    idea_tag_none: string;
    /** Idea triage status labels (one per IdeaStatus) + control aria. */
    idea_status_doing: string;
    idea_status_maybe: string;
    idea_status_skip: string;
    idea_status_aria: string;
    /** Ideas -> Tasks bridge prompt shown on a "doing" idea. */
    idea_to_task_prompt: string;
    idea_to_task_confirm: string;
    idea_to_task_dismiss: string;
    idea_to_task_done: string;
  };
  /** Post-wedding follow-up — honeymoon plan + photos shared with guests. */
  honeymoon: {
    title: string;
    sub: string;
    /** Soft warning banner when honeymoon_start_date is before wedding_date —
     *  almost always a typo. Body receives `{wedding}` + `{honeymoon}` short
     *  date strings. */
    before_wedding_title: string;
    before_wedding_body: string;
    /** Inline countdown pill in the Days tile. The `_future` and `_past`
     *  variants take `{count}` (whole days); plural is handled by `_one` /
     *  `_other` suffixes via the t() helper. */
    countdown_future_one: string;
    countdown_future_other: string;
    countdown_today: string;
    countdown_ongoing: string;
    countdown_past_one: string;
    countdown_past_other: string;
    /** Amadeus-powered flight estimate card under the three tiles. Hidden
     *  when no destination/dates or Amadeus isn't configured. `_basis`
     *  receives `{origin}` + `{destination}` (IATA codes) + `{adults}`;
     *  `_attribution` receives `{updated}` (localised short timestamp). */
    flight_estimate_title: string;
    flight_estimate_basis: string;
    flight_estimate_empty: string;
    flight_estimate_prompt: string;
    flight_estimate_search: string;
    flight_estimate_searching: string;
    flight_estimate_retry: string;
    flight_estimate_attribution: string;
    /** Origin IATA badge inside the flight estimate card. The badge value
     *  itself is the 3-letter code; the label sits above it. The edit
     *  control reuses the badge — click swaps to a 3-letter input. */
    flight_estimate_origin_label: string;
    flight_estimate_origin_placeholder: string;
    flight_estimate_origin_invalid: string;
    flight_estimate_origin_edit_aria: string;
    /** Per-offer row chrome — stops + outbound duration. `_stops_other`
     *  takes `{count}`; `_duration` takes `{hours}` + `{minutes}`. */
    flight_estimate_direct: string;
    flight_estimate_stops_one: string;
    flight_estimate_stops_other: string;
    flight_estimate_duration: string;
    /** Compact party summary shown next to the origin badge — receives
     *  `{adults}`. Always round-trip in v1, so the string bakes that in. */
    flight_estimate_party: string;
    /** Per-offer expand chrome — opens / closes the segment detail block. */
    flight_estimate_expand: string;
    flight_estimate_collapse: string;
    /** Section labels inside the expanded view. `_layover` and
     *  `_overnight_layover` take `{airport}` + `{duration}` (e.g. "FRA · 2h
     *  15m"); `_aircraft` takes `{model}`; `_class` takes `{class}`. */
    flight_estimate_layover: string;
    flight_estimate_layover_overnight: string;
    flight_estimate_aircraft: string;
    flight_estimate_class: string;
    /** Baggage row — SerpApi doesn't ship structured allowances in the
     *  free tier, so we link out to Google Flights for the real numbers
     *  rather than guess. */
    flight_estimate_baggage_unknown: string;
    flight_estimate_view_on_google: string;
    /** Collapsible flight-estimate card + "save this flight to the plan"
     *  action (writes a Travel budget line + a buy-ticket todo). */
    flight_expand_aria: string;
    flight_collapse_aria: string;
    flight_price_disclaimer: string;
    flight_price_disclaimer_dated: string;
    flight_save_cta: string;
    flight_save_cta_aria: string;
    flight_save_confirm_title: string;
    flight_save_confirm_body: string;
    flight_save_confirm_cta: string;
    flight_save_todo_title: string;
    flight_save_todo_note: string;
    flight_save_done: string;
    /** Honeymoon-scoped todo checklist that mirrors planning_items
     *  filtered by topic='honeymoon'. `todo_sub_count` receives
     *  `{done}` + `{total}` numbers; the empty body + CTA point to
     *  /app/tervezés where the wand can stamp the honeymoon group. */
    todo_title: string;
    todo_sub_count: string;
    todo_sub_empty: string;
    todo_manage_link: string;
    todo_check_aria: string;
    todo_uncheck_aria: string;
    /** aria-label + tooltip on the per-row delete handle. */
    todo_delete_aria: string;
    /** Inline "Add a task" input shown under the todo list (and in the empty
     *  state) — placeholder doubles as the field's aria-label, the aria
     *  string covers the submit button. */
    todo_add_placeholder: string;
    todo_add_aria: string;
    /** Wand dialog scoped to honeymoon tasks — slimmer cousin of the
     *  planning page's TaskTemplateDialog. `_confirm` receives `{count}` =
     *  picked items; `_already_added` is the per-row badge for entries
     *  already on the couple's list. */
    todo_wand_button: string;
    todo_wand_dialog_title: string;
    todo_wand_dialog_body: string;
    todo_wand_confirm: string;
    todo_wand_already_added: string;
    /** Header tiles (days / destination / budget). */
    tile_days: string;
    tile_destination: string;
    tile_budget: string;
    /** Inline editors for the trip tiles. */
    start_label: string;
    end_label: string;
    end_before_start: string;
    edit_dates: string;
    edit_destination: string;
    set_dates_cta: string;
    destination_empty_cta: string;
    /** Aria-label + tooltip for the small map icon in the destination tile. */
    show_on_map: string;
    /** Body text for the map modal when Nominatim returned no hits. */
    map_not_found: string;
    map_error: string;
    /** Aria-label + tooltip for the "open in OpenStreetMap" link in the map modal. */
    map_open_external: string;
    /** iframe title for the OSM embed — receives `{label}` (place name). */
    map_iframe_title: string;
    /** Day-count plural — receives `{count}`. */
    day_one: string;
    day_other: string;
    /** Budget tile copy. */
    budget_actual_inline: string;
    budget_no_lines: string;
    budget_lines_count_one: string;
    budget_lines_count_other: string;
    /** Cost breakdown section. */
    costs_title: string;
    costs_sub: string;
    /** Compact one-line variant used when the empty state shares a row with
     *  the preset chips — drop the long "kezdd egy kategóriával…" copy. */
    costs_empty_short: string;
    /** Per-card "spent so far" inline label. Receives `{actual}` pre-formatted. */
    cost_actual_inline: string;
    /** Aria-label for the per-card range slider. Receives `{label}`. */
    slider_aria: string;
    /** Click-to-edit label affordance on a cost row (title + aria-label). */
    rename: string;
    /** Preset chip labels — used as the seed `label` when creating a budget
     *  line, and as the chip's display text. */
    preset: {
      travel: string;
      stay: string;
      food: string;
      activities: string;
      insurance: string;
      other: string;
    };
    cover_upload: string;
    cover_drag: string;
    cover_reset: string;
    /** Caption when the auto photo is of a broader place than the headline,
     *  e.g. a Rome shot under a saved church address. */
    /** One-word form of flight_estimate_title, for the trip bar segment. */
    flight_short: string;
    photo_of: string;
    cover_uploading: string;
  };
  /** Honeymoon travel-safety block — Hungarian Konzuli Szolgálat (KonzInfo)
   *  country card + pre-trip checklist. Rendered on HoneymoonPage. */
  travel_safety: {
    title: string;
    intro: string;
    block_title: string;
    loading: string;
    konzinfo_link: string;
    safety_label: string;
    last_update_label: string;
    valid_today_label: string;
    no_match: string;
    index_link: string;
    checklist_title: string;
    check_passport: string;
    check_visa: string;
    check_entry: string;
    check_health: string;
    check_insurance: string;
    check_copies: string;
    check_register: string;
    register_link: string;
    app_link: string;
    insurance_reminder: string;
    disclaimer: string;
  };
  media: {
    title: string;
    dev_badge: string;
    sub: string;
    coming_soon_title: string;
    coming_soon_body: string;
    collect_guests: string;
    collect_photographer: string;
    collect_other: string;
    collect_add: string;
    collect_open: string;
    collect_placeholder: string;
    collect_invalid: string;
    collect_saved: string;
    collect_removed: string;
    collect_delete: string;
    hero_title: string;
    hero_sub: string;
    hero_cta_create: string;
    hero_cta_preview: string;
    from_guests_title: string;
    from_guests_desc: string;
    from_guests_cta: string;
    from_guests_active_label: string;
    from_guests_link_label: string;
    from_guests_photos_zero: string;
    from_guests_photos_count: string;
    from_guests_copy: string;
    from_guests_copied: string;
    from_guests_coming_note: string;
    to_guests_title: string;
    to_guests_desc: string;
    to_guests_cta: string;
    to_guests_feature_1: string;
    to_guests_feature_2: string;
    to_guests_feature_3: string;
    photographer_title: string;
    photographer_desc: string;
    photographer_cta: string;
    /** Terse, middot-separated service examples shown as the CTA row's
     *  subtitle (replaces the old prose "Any link: …" helper). */
    photographer_services: string;
    /** Pressable "add another gallery" row, shown once at least one link is
     *  saved and below the cap. */
    photographer_add_another: string;
    photographer_open: string;
    create_modal_title: string;
    create_modal_desc: string;
    create_modal_submit: string;
    create_modal_creating: string;
    feedback_title: string;
    feedback_intro: string;
    feedback_placeholder: string;
    feedback_submit: string;
    feedback_submitting: string;
    feedback_success: string;
    feedback_empty_error: string;
    film_title: string;
    film_sub: string;
    film_cta_create: string;
    film_cta_view: string;
    film_cta_preview: string;
    film_stats_photos: string;
    film_stats_guests: string;
    film_stats_shots: string;
    film_stats_upload: string;
    film_stats_camera: string;
    film_status_open: string;
    film_status_closed: string;
    film_status_shooting: string;
    film_status_developing: string;
    film_status_revealed: string;
    film_ends_in: string;
    film_reveals_in: string;
    film_revealed: string;
    film_unlimited: string;
    film_how_title: string;
    film_how_1_title: string;
    film_how_1_body: string;
    film_how_2_title: string;
    film_how_2_body: string;
    film_how_3_title: string;
    film_how_3_body: string;
    film_settings_title: string;
    film_settings_name: string;
    film_settings_aesthetic: string;
    film_settings_shots: string;
    film_settings_ends: string;
    film_settings_ends_hint: string;
    film_settings_reveal: string;
    film_settings_reveal_default: string;
    film_settings_reveal_hint: string;
    film_settings_cap: string;
    film_settings_upload: string;
    film_settings_unnamed: string;
    film_empty_title: string;
    film_empty_body: string;
    film_no_app_hint: string;
    film_status_no_film: string;
    film_status_no_photographer: string;
    film_cta_share: string;
    film_header_active: string;
    film_next_steps_title: string;
    film_qr_title: string;
    film_stat_moments: string;
    film_stat_left: string;
    film_stat_closed: string;
    film_stat_people: string;
    film_guest_link: string;
    film_copy: string;
    film_add_own_photos: string;
    film_privacy_notice: string;
    film_save_qr: string;
    film_share_btn: string;
    film_guest_view: string;
    film_collapse: string;
    film_expand: string;
    film_expired_alert: string;
    film_expired_body: string;
    film_expired_action: string;
    film_per_person: string;
    film_no_participants: string;
    reveal_explainer_title: string;
    reveal_explainer_body: string;
    reveal_explainer_unset: string;
    placeholder_warn_title: string;
    placeholder_warn_body: string;
    share_sheet_title: string;
    share_whatsapp: string;
    share_sms: string;
    share_email: string;
    share_copy_link: string;
    share_copy_msg: string;
    share_message_long: string;
    share_message_sms: string;
    share_email_subject: string;
    share_email_body: string;
    early_close: string;
    early_close_hint: string;
    early_close_reopen: string;
    kamera_preview_banner: string;
    slug_label: string;
    slug_hint: string;
    slug_placeholder: string;
    slug_taken: string;
    slug_invalid: string;
    slug_saved: string;
    slug_cleared: string;
    participant_remove: string;
    participant_removed: string;
    participant_remove_title: string;
    participant_remove_body: string;
    participant_remove_with_photos: string;
    participant_remove_confirm: string;
    gallery_link_note: string;
    shared_gallery_teaser: string;
    /** Placeholder carries the whole explanation of the film-name field. */
    film_settings_name_placeholder: string;
    film_price_free: string;
    film_not_set: string;
    film_anonymous: string;
    film_participants_joined: string;
    film_shots_short: string;
    film_uploading: string;
    film_activated: string;
    film_upgrade_body: string;
    film_upgrade_cta: string;
    /** The couple's own view of the film — bypasses the guest reveal lock. */
    gallery_title: string;
    gallery_empty: string;
    gallery_show_all: string;
    gallery_from_you: string;
    gallery_download: string;
    gallery_prev: string;
    gallery_next: string;
  };
  /** /photos/:token — public guest upload page. */
  photos: {
    not_found: string;
    not_found_sub: string;
    uploads_disabled: string;
    uploads_disabled_sub: string;
    /** 429 from register-device: venue wifi is one IP, so this is common. */
    busy: string;
    busy_sub: string;
    busy_retry: string;
    name_heading: string;
    name_placeholder: string;
    name_continue: string;
    limit_heading: string;
    limit_sub: string;
    error_too_large: string;
    error_bad_type: string;
    error_generic: string;
    /** Camera controls — labels live in tooltip + aria only. */
    take_photo: string;
    upload_existing: string;
    flip_camera: string;
    /** getUserMedia refused or absent; the file picker is the way through. */
    camera_blocked: string;
    camera_blocked_sub: string;
    camera_blocked_inapp: string;
    sent_heading: string;
    sent_sub_reveal: string;
    sent_sub_now: string;
    sent_count: string;
    sent_add_more: string;
    sent_invite: string;
    welcome_back_heading: string;
    welcome_back_sub_one: string;
    welcome_back_sub_many: string;
    welcome_back_cta: string;
    developing_heading: string;
    developing_sub: string;
    gallery_count: string;
    guest_subtitle: string;
    guest_subtitle_plain: string;
    preview_banner: string;
    from_couple: string;
  };
  /** Inspiration page that renders pins from a linked public Pinterest board. */
  /** /app/design — the curated wedding visual-identity editor. */
  design: {
    title: string;
    /** InfoHint next to the title. */
    hint: string;
    /** The Sample Table: four finished looks on the couple's own names. */
    choose: string;
    look: { change: string };
    /** The Look Bar stamp always names the surface you are NOT editing. */
    stamp: { to_print: string; to_site: string };
    /** Picking a style discards hand-set colours and fonts, so it asks first. */
    style_switch_confirm: { title: string; body: string; confirm: string };
    /** The fine-tune list. Every label names a thing, never an attribute. */
    tune: {
      heading: string;
      colors: string;
      fonts: string;
      date: string;
      monogram: string;
      dividers: string;
      cards: string;
      sections: string;
      border: string;
    };
    /** Before/after comparison of a style swap. */
    swap: { before: string; after: string; revert: string; done: string };
    /** Corners + shadow collapsed into one three-way card-feel choice. */
    card_feel: { sharp: string; soft: string; round: string };
    /** Custom-colour drawer opener plus its "{n} custom" counter. */
    colors_custom: { open: string; count: string };
    /** Section headings for the three pickers + print toggles. */
    section: {
      style: string;
      palette: string;
      /** Divider label between the pack palettes and the legacy catalog. */
      palette_more: string;
      fonts: string;
      print: string;
      photos: string;
      cards: string;
      monogram: string;
      ornaments: string;
      date: string;
    };
    /** The three numbered studio chapters of the website editor. */
    group: {
      style: string;
      typography: string;
      details: string;
    };
    /** Print-template toggle labels. */
    print: {
      border: string;
      ornament: string;
      qr: string;
    };
    /** Live-preview column label. */
    preview_label: string;
    /** Full-page guest-page preview overlay: open button, viewport toggles and
     *  close control. */
    full_preview: string;
    preview_mobile: string;
    preview_desktop: string;
    preview_close: string;
    /** Mobile floating preview pill (below lg the preview stacks under the
     *  editor, so phones open the full-screen overlay instead). */
    preview_open: string;
    /** Chip flagging that the preview is showing labelled sample beats because
     *  the couple hasn't authored a schedule / wishlist yet. */
    preview_sample_chip: string;
    preview_sample: {
      gift_1: string;
      gift_2: string;
    };
    /** Visually-hidden note: the inline preview is inert (not interactive). */
    preview_sr_note: string;
    /** Publish bridge banner: nudges the couple to publish their guest page
     *  once a slug exists but the page is still private. */
    publish_cta_text: string;
    publish_cta_button: string;
    /** Body sample line shown under the heading sample in a font tile. */
    font_sample_body: string;
    /** Ambient save-status line (saving spinner / saved flash) + error toasts. */
    saved: string;
    saving: string;
    save_blocked: string;
    save_error: string;
    /** One-shot undo pill shown right after a (destructive) pack switch. */
    undo: string;
    /** Finish-line card at the bottom of the website editor. */
    finish: {
      title: string;
      view_live: string;
      copy_link: string;
      link_copied: string;
    };
    /** Wedding-style preset names. */
    style: {
      /** The four active style packs. */
      garden_romance: string;
      modern_monochrome: string;
      blush_romantic: string;
      midnight_luxe: string;
      /** Legacy slugs (kept for back-compat translations). */
      classic_elegant: string;
      botanical_green: string;
      modern_minimal: string;
      romantic_soft: string;
      rustic_natural: string;
      editorial: string;
      mediterranean_terracotta: string;
      blue_porcelain: string;
      black_tie_editorial: string;
    };
    /** Optional one-line mood descriptions shown under each style-pack tile. */
    style_desc: {
      garden_romance: string;
      modern_monochrome: string;
      blush_romantic: string;
      midnight_luxe: string;
    };
    /** Colour-palette names. */
    palette: {
      /** Style-pack palettes. */
      garden: string;
      mono_ink: string;
      blush_rose: string;
      noir: string;
      botanical_green: string;
      espresso: string;
      blush: string;
      stone_minimal: string;
      sage_cream: string;
      champagne: string;
      terracotta: string;
      blue_porcelain: string;
      ink_gold: string;
      noir_ivory: string;
      midnight: string;
    };
    /** Font-preset names. */
    font: {
      /** Style-pack pairings. */
      garden_serif: string;
      mono_sans: string;
      blush_bodoni: string;
      noir_smallcaps: string;
      classic_serif: string;
      modern_clean: string;
      soft_romantic: string;
      /** Heading / body font-family override pickers + the "use preset" option. */
      heading_label: string;
      body_label: string;
      use_preset: string;
    };
    /** Frame drawn around the printed cards — matches the `BorderStyleSlug`
     *  catalog in shared/design.ts (the tiles are visual, so these names carry
     *  the whole accessible label). */
    border: {
      none: string;
      hairline: string;
      double: string;
      thick: string;
    };
    /** Individually-assignable font families (the editable layer). */
    family: {
      cormorant: string;
      inter: string;
      general_sans: string;
      system_serif: string;
      system_sans: string;
      cormorant_italic: string;
      dm_sans: string;
      jost: string;
      bodoni_moda: string;
      crimson_text: string;
      cormorant_sc: string;
      eb_garamond: string;
    };
    /** Custom per-role colour overrides on top of the palette. */
    colors: {
      title: string;
      hint: string;
      primary: string;
      background: string;
      accent: string;
      text: string;
      reset: string;
      low_contrast: string;
      /** Prefix in front of the active palette name in the colours header,
       *  e.g. "Base: Garden" — tells the couple which theme they're tweaking. */
      base_label: string;
      /** Tooltip on the small swatch showing a role's original palette hex. */
      original: string;
      /** Collapsed-disclosure label the swatches live behind (the palette
       *  picker is the curated path; raw hex is the escape hatch). */
      advanced_label: string;
      /** One-tap action beside the low-contrast warning: clears every
       *  custom colour override back to the palette. */
      fix_contrast: string;
    };
    /** Tabs: the Style Kit vs the Cards & printables hub. */
    tab: {
      style_kit: string;
      cards: string;
      /** Surface tabs under the common identity: guest page vs printables. */
      website: string;
      print: string;
    };
    /** One-line helper shown on the Website tab (the controls above drive it). */
    website: {
      helper: string;
    };
    /** Website-only chrome controls (the `web` sub-object). */
    web: {
      card_radius_label: string;
      shadow_label: string;
      button_style_label: string;
      sections_label: string;
      /** Public venue-map opt-in row (in the sections list) + its disabled
       *  tooltip when no venue coordinates are set yet. */
      venue_map_label: string;
      venue_map_needs_location: string;
      image_treatment_label: string;
      /** The two optional fixed-slot site photos (upload tiles + errors). */
      photo_slot: string;
      photo_remove: string;
      photo_upload_error: string;
      /** Curated background-art gallery (pick instead of uploading). */
      photo_gallery_cta: string;
      photo_upload_own: string;
      photo_gallery_title: string;
      cover_label: string;
      cover_upload_cta: string;
      cover_replace: string;
      cover_replace_aria: string;
      cover_remove: string;
      /** Receives `{mb}` — the max upload size. */
      cover_constraints: string;
      cover_too_large: string;
      cover_wrong_type: string;
      cover_adjust: string;
      cover_adjust_hint: string;
      cover_zoom: string;
      photo_art: {
        reception_pergola: string;
        reception_candlelit: string;
        place_setting: string;
        greenery_arch: string;
        draped_arch: string;
        pampas_candles: string;
        candle_still: string;
        dried_flowers: string;
        eucalyptus: string;
        eucalyptus_light: string;
        wedding_cake: string;
        ceremony_aisle: string;
      };
      card_radius: { sharp: string; soft: string; full: string };
      shadow: { none: string; soft: string; pop: string };
      button_style: { lifted: string; flat: string; outline: string };
      section: { intro: string; schedule: string; useful_info: string; wishlist: string };
      image_treatment: { none: string; grayscale: string };
      /** The venue-map opt-in, surfaced in the sections list. */
      map_label: string;
      map_needs_location: string;
      map_confirm_title: string;
      map_confirm_body: string;
      map_confirm_cta: string;
      /** "Venue and map" layout picker: stacked, or side by side
       *  with a square map. Only offered while the map is on. */
      venue_layout_label: string;
      venue_layout: {
        stacked: string;
        side: string;
      };
    };
    /** Instant print-card preview (right column on the Print tab). */
    menu_editor: {
      heading: string;
      empty: string;
      add_course: string;
      remove_course: string;
      course_placeholder: string;
      dishes_placeholder: string;
      saved: string;
    };
    print_preview: {
      sample_name: string;
      sample_couple: string;
      sample_table: string;
      caption: string;
      /** Card-type picker heading + per-card sample copy. */
      template_label: string;
      tpl: {
        place_card: string;
        table_number: string;
        menu: string;
        invitation: string;
        thank_you: string;
        schedule: string;
      };
      /** Print-editor framing: dynamic "{name} design" title, helper line, and
       *  the "shared identity" group label that wraps the common controls. */
      editing_title: string;
      editing_helper: string;
      content_hint: string;
      content_change: string;
      common_identity: string;
      /** Print-tab read-only inherited-identity summary (audit #13). */
      inherited_title: string;
      inherited_change: string;
      table_label: string;
      menu_title: string;
      menu_starter: string;
      menu_main: string;
      menu_dessert: string;
      sample_program: { ceremony: string; dinner: string; party: string };
      preview_exact_pdf: string;
      /** Sample date shown on the invitation + thank-you previews. */
      sample_date: string;
      /** Invitation card preview copy. */
      invitation_eyebrow: string;
      invitation_line: string;
      invitation_venue: string;
      /** Thank-you card preview copy. */
      thank_you_title: string;
      thank_you_line: string;
    };
    /** Style-kit subtitle under the tab. */
    subtitle: string;
    /** Monogram section. */
    monogram: {
      enable: string;
      separator_label: string;
    };
    /** Intermediate decorative dividers (guest-page ornament seams) on/off. */
    ornaments: {
      enable: string;
      hint: string;
    };
    /** Date-format preset names. */
    date: {
      numeric_dot: string;
      numeric_md: string;
      long: string;
      slash: string;
      roman: string;
    };
    /** Cards & printables hub. */
    cards: {
      subtitle: string;
      /** Heading above the on-demand PDF download tiles on the Print tab. */
      downloads_heading: string;
      /** Collapsible print-tips block in the downloads area (audit #15). */
      print_tips_title: string;
      print_tips_bleed: string;
      print_tips_size: string;
      print_tips_stock: string;
      /** "Using your Wedding Style Kit" notice + link. */
      using_style: string;
      using_style_sub: string;
      edit_style_kit: string;
      action_download: string;
      action_open: string;
      downloading: string;
      download_error: string;
      status_ready: string;
      status_needs_data: string;
      place_cards_name: string;
      place_cards_desc: string;
      table_numbers_name: string;
      table_numbers_desc: string;
      menu_name: string;
      menu_desc: string;
      invitation_name: string;
      invitation_desc: string;
      thank_you_name: string;
      thank_you_desc: string;
      seating_chart_name: string;
      seating_chart_desc: string;
      schedule_name: string;
      schedule_desc: string;
    };
  };
  moodboard: {
    title: string;
    sub: string;
    url_label: string;
    url_placeholder: string;
    url_help: string;
    suggestion_label: string;
    save: string;
    change: string;
    clear: string;
    loading: string;
    invalid_url: string;
    empty_title: string;
    empty_body: string;
    open_in_pinterest: string;
    error_title: string;
    error_not_found: string;
    error_private: string;
    error_empty: string;
    error_fetch: string;
    /** Three-source moodboard: a curated preset (default), the couple's own
     *  uploaded images, or a linked Pinterest board. */
    preset_badge: string;
    replace_title: string;
    choose_upload: string;
    choose_pinterest: string;
    upload_help: string;
    add_images: string;
    delete_image: string;
    uploading: string;
    upload_error: string;
    upload_too_large: string;
    upload_bad_type: string;
    upload_limit: string;
    back_to_preset: string;
  };
  /** Read-only "for guests" surface — the same JSX renders the public page
   *  at /g/:slug/:code AND the couple-side preview at /app/guest-portal. */
  guest_portal: {
    date_tbd: string;
    /** Hover/title hint on the run-of-show + venue cards in the couple's
     *  editor preview, where they double as edit shortcuts. */
    edit_section_hint: string;
    /** Live wedding-day countdown at the bottom of the guest page. */
    countdown_title: string;
    countdown_add_date: string;
    countdown_days: string;
    countdown_hours: string;
    countdown_minutes: string;
    countdown_seconds: string;
    /** "Good to know" section heading on the guest page (preview + public). */
    useful_info_title: string;
    /** Couple-curated wishlist deck — confirmed-tier only. Soft, no-money
     *  framing: a group-gift card shows how many households are coordinating
     *  + a non-binding "I'd like to help" toggle. */
    wishlist_section_title: string;
    /** Warm intro paragraph above the gift deck: "you being here is the gift,
     *  but if you'd like ideas, here's what we'd love". */
    wishlist_intro: string;
    /** Heading for the separate "personal requests" deck (letter, photo, ...). */
    wishlist_requests_title: string;
    wishlist_group_gift_help_cta: string;
    wishlist_group_gift_help_active: string;
    /** Receives `{count}` — how many households tapped "I'd like to help". */
    wishlist_interest_count: string;
    /** Prefixes the optional rough target amount on a card. */
    wishlist_target_amount_prefix: string;
    /** Accessible label for the external product / registry link. */
    wishlist_external_link_label: string;
    /** Placeholder for the optional soft-pledge amount input on a group gift. */
    wishlist_pledge_placeholder: string;
    /** aria-label for the soft-pledge amount input. */
    wishlist_pledge_aria: string;
    /** Receives `{pledged}` + `{target}` — the GoFundMe-style "X / Y committed"
     *  line under a group gift's progress bar. */
    wishlist_pledged_progress: string;
    /** Two-step pledge flow strings (gift items with a target amount). */
    wishlist_pledge_simple_cta: string;
    wishlist_pledge_simple_active: string;
    wishlist_pledge_step1_warn: string;
    wishlist_pledge_step1_confirm: string;
    wishlist_pledge_step2_amount_label: string;
    wishlist_pledge_step2_fill_remaining: string;
    wishlist_pledge_step2_email_label: string;
    wishlist_pledge_step2_email_placeholder: string;
    wishlist_pledge_step2_email_note: string;
    wishlist_pledge_step2_submit: string;
    wishlist_pledge_step2_cancel: string;
    wishlist_pledge_success: string;
    wishlist_pledge_withdraw: string;
    wishlist_pledge_contributors_others: string;
    wishlist_pledge_contributors_remaining: string;
    wishlist_pledge_contributors_funded: string;
    wishlist_pledge_error_generic: string;
    schedule_title: string;
    schedule_empty: string;
    /** Label appended to a time when the event lands after midnight (day +1). */
    schedule_next_day: string;
    location_title: string;
    location_open_map: string;
    location_empty: string;
    ceremony_label: string;
    ceremony: {
      civil: string;
      religious: string;
      both: string;
    };
    rsvp: {
      yes: string;
      maybe: string;
      no: string;
      pending: string;
    };
    /** Receives `{label}` — the household's display label. */
    household_title: string;
    gate_title: string;
    gate_body: string;
    gate_cta: string;
    not_found_title: string;
    not_found_body: string;
    not_found_cta: string;
    load_error: string;
    /** Couple-editor preview only — gray dashed "add this" ghost slots shown in
     *  place of empty cover/date/schedule/venue sections. Never on the public view. */
    ghost: {
      cover_title: string;
      cover_cta: string;
      date_cta: string;
      schedule_title: string;
      schedule_cta: string;
      venue_title: string;
      venue_cta: string;
      useful_info_title: string;
      useful_info_cta: string;
      welcome_cta: string;
    };
  };
  /** Couple-facing /app/guest-page editor — single merged surface that
   *  combines the publish/venue/cover form (formerly /app/wedding-site)
   *  with the read-only post-RSVP preview (formerly /app/guest-portal).
   *  Section headers label which content is publicly visible vs which is
   *  unlocked only after an RSVP-yes, so the couple never publishes the
   *  wrong block to the wrong audience. */
  guest_page_editor: {
    coming_soon_title: string;
    coming_soon_body: string;
    title: string;
    subtitle: string;
    /** Planner-managed viewer unlock card: buy back guest-page editing at 70% off. */
    addon_unlock_title: string;
    addon_unlock_body: string;
    addon_unlock_cta: string;
    addon_opening: string;
    addon_error: string;
    /** Publish-state badge beside the page title. */
    status_published: string;
    status_draft: string;
    /** Eye button in the header that opens the live public /w/:slug page. */
    preview_live_label: string;
    preview_live_aria: string;
    preview_live_hint_ready: string;
    preview_live_hint_no_slug: string;
    preview_live_hint_not_published: string;
    section_share_title: string;
    section_share_body: string;
    section_public_eyebrow: string;
    section_public_title: string;
    section_public_hint: string;
    section_unlocked_eyebrow: string;
    section_unlocked_title: string;
    section_unlocked_hint: string;
    section_unlocked_link_schedule: string;
    section_unlocked_link_profile: string;
    /** Phase 2 (Vendégoldal merger) — markdown textarea bound to
     *  `couples.guest_page_intro`. Lives under the Public section. */
    intro_label: string;
    intro_placeholder: string;
    intro_hint: string;
    intro_suggestions_heading: string;
    intro_suggestion_1: string;
    intro_suggestion_2: string;
    intro_suggestion_3: string;
    intro_suggestion_4: string;
    intro_suggestion_5: string;
    intro_suggestion_applied: string;
    /** "Good to know" editor field — parking, getting there, accommodation. */
    useful_info_label: string;
    useful_info_placeholder: string;
    useful_info_hint: string;
    /** Row labels for the structured "Good to know" fields. The label text
     *  (lowercased) must stay in sync with USEFUL_INFO_PREFIXES in
     *  GuestPageEditorPage so saved rows re-parse after a reload / locale flip. */
    useful_field_parking: string;
    useful_field_getting_there: string;
    useful_field_transfer: string;
    useful_field_accommodation: string;
    useful_suggestion_parking: string;
    useful_suggestion_getting_there: string;
    useful_suggestion_transfer: string;
    useful_suggestion_accommodation: string;
    useful_suggestion_apply: string;
    useful_field_other_label: string;
    useful_field_other_placeholder: string;
    /** Date editor sheet (click the hero date) + schedule sheet (click the
     *  schedule band) — replace the old jumps to other pages. */
    date_panel_title: string;
    date_panel_hint: string;
    schedule_panel_title: string;
    schedule_panel_open_full: string;
    schedule_panel_empty: string;
    /** Phase 2 — markdown textarea bound to `couples.post_rsvp_content`.
     *  Lives under the Post-RSVP section. */
    post_rsvp_label: string;
    post_rsvp_placeholder: string;
    post_rsvp_hint: string;
    /** Quick-add chips above the post-RSVP textarea: clicking one appends
     *  a `Label:\n` section template so the couple has a guided starting
     *  point for the common topics guests ask about. */
    post_rsvp_suggestions_heading: string;
    post_rsvp_suggestion_parking: string;
    post_rsvp_suggestion_dress_code: string;
    post_rsvp_suggestion_gifts: string;
    post_rsvp_suggestion_accommodation: string;
    post_rsvp_suggestion_kids: string;
    post_rsvp_suggestion_getting_there: string;
    editor_collapse_summary: string;
    /** Inline indicators flagging which guest-page fields the couple still
     *  has to fill in — pill next to each empty label, plus a one-line
     *  summary at the top of the editor that survives the <details> being
     *  collapsed. */
    todo_pill: string;
    todo_summary_prefix: string;
    todo_item_cover: string;
    todo_item_intro: string;
    todo_item_post_rsvp: string;
    todo_item_coords: string;
    todo_item_schedule: string;
    todo_item_venue: string;
    venue_saved_prefix: string;
    venue_map_label: string;
    venue_map_hint: string;
    venue_map_needs_location: string;
    venue_map_confirm_title: string;
    venue_map_confirm_body: string;
    venue_map_confirm_cta: string;
    venue_pin_title: string;
    venue_pin_hint: string;
    venue_pin_locating: string;
    venue_pin_set_cta: string;
    venue_pin_move_cta: string;
    venue_pin_saved: string;
    preview_divider_label: string;
    /** Divider label marking the start of the editor, below the guest view. */
    editor_divider_label: string;
    preview_title: string;
    preview_subtitle: string;
    /** Per-household share section — lists each household with a personal
     *  link the couple can copy or send via WhatsApp. */
    share_per_household_title: string;
    share_per_household_subtitle: string;
    share_per_household_summary: string;
    share_per_household_empty: string;
    share_per_household_member_count_one: string;
    share_per_household_member_count_other: string;
    share_per_household_copy_link: string;
    share_per_household_copy_link_aria: string;
    share_per_household_whatsapp: string;
    share_per_household_whatsapp_aria: string;
    share_per_household_rotate: string;
    share_per_household_rotate_aria: string;
    share_per_household_rotate_confirm_title: string;
    share_per_household_rotate_confirm_body: string;
    share_per_household_rotate_confirm_action: string;
    share_per_household_rotate_success: string;
    share_per_household_rotate_error: string;
    share_per_household_copy_all: string;
    share_per_household_copy_all_aria: string;
    share_per_household_copy_all_success: string;
    /** WhatsApp deep-link template with {guest_name} and {link} placeholders. */
    whatsapp_message_template: string;
  };
  /** Legacy share-panel + empty-preview copy reused by the merged
   *  guest_page_editor surface above. Once Phase 3 wraps and we
   *  re-author the share strings inline, this namespace can shrink. */
  guest_preview: {
    title: string;
    subtitle: string;
    empty: string;
    share_title: string;
    share_body: string;
    share_slug_label: string;
    share_link_label: string;
    share_copy_slug_aria: string;
    share_copy_link_aria: string;
    share_copied: string;
    share_copy_failed: string;
    share_no_slug: string;
  };
  /** Couple-facing /app/wishlist editor — CRUD over the wishlist_items table.
   *  Mirrors the schedule editor: a list with inline add/edit/delete. No
   *  money moves; the target amount is a wish, not an invoice. */
  wishlist_editor: {
    title: string;
    dev_badge: string;
    subtitle: string;
    add_item: string;
    empty_state: string;
    title_label: string;
    title_placeholder: string;
    kind_label: string;
    /** The two kinds (gifts vs personal requests). */
    kind_gift: string;
    kind_request: string;
    /** Section headers + per-section add buttons. */
    section_gifts_title: string;
    section_requests_title: string;
    /** One-liner under the requests section explaining what it's for. */
    section_requests_subtitle: string;
    add_gift: string;
    add_request: string;
    /** CTA inside an empty section. Deliberately worded differently from
     *  add_gift / add_request: two buttons with the same accessible name in one
     *  section is a screen-reader coin toss. */
    add_first_gift: string;
    add_first_request: string;
    /** Header meta counts, each receiving `{count}`. `count_received` is the
     *  same line on the received-gifts view. */
    count_gifts: string;
    count_requests: string;
    count_received: string;
    /** aria-label for an item's outbound shop link; receives `{host}`. */
    open_link: string;
    /** Empty states per section. */
    gifts_empty: string;
    requests_empty: string;
    description_label: string;
    description_placeholder: string;
    target_amount_label: string;
    /** Framed as a wish, not an invoice — no money moves in-app. */
    target_amount_hint: string;
    /** aria-label for the per-item currency selector next to the rough amount. */
    currency_aria: string;
    url_label: string;
    url_placeholder: string;
    url_hint: string;
    url_preview_loading: string;
    url_preview_miss: string;
    /** Label over the icon strip, shown only while the wish has no picture. */
    icon_label: string;
    /** One plain noun per icon, carried as the tooltip + accessible name of a
     *  button whose face is the glyph alone. Keyed by the slug in
     *  WISHLIST_ICON_SLUGS. */
    icon_choice: {
      Gift: string;
      House: string;
      UtensilsCrossed: string;
      CookingPot: string;
      Coffee: string;
      Wine: string;
      BedDouble: string;
      Armchair: string;
      Flower2: string;
      Smartphone: string;
      Laptop: string;
      Camera: string;
      Plane: string;
      TreePalm: string;
      Ticket: string;
      Music: string;
      Heart: string;
      Mail: string;
    };
    delete_confirm_title: string;
    delete_confirm_body: string;
    saved_toast: string;
    /** Shown when a PATCH 409s because a partner edited the same item. */
    stale_reload: string;
    save_button: string;
    /** aria-label for the dense row ("sávos") view toggle. */
    view_list: string;
    /** aria-label for the card ("kártya") view toggle. */
    view_cards: string;
    /** Receives `{count}` — guests who pledged toward a group gift. */
    pledged_count: string;
    /** Shown in the progress caption when the target is fully covered. */
    progress_fully_funded: string;
    /** Aria-labels / tooltips for the up/down reorder entries. */
    reorder_up: string;
    reorder_down: string;
    /** Accessible name of the "…" button on an item, which holds reorder +
     *  delete. Every item carries one, so it never names the item itself. */
    item_menu: string;
    /** Publish toggle in the editor header: share the list on the guest page. */
    publish_title: string;
    /** Short visible label beside the toggle; publish_title is its aria-label. */
    publish_short: string;
    /** Toggle state labels. */
    publish_on: string;
    publish_off: string;
    /** Toasts after flipping the publish toggle. */
    publish_toast_on: string;
    publish_toast_off: string;
    phase_before: string;
    phase_after: string;
    /** Received-gifts ledger: private "what we got" tracking grid. */
    section_received_title: string;
    section_received_subtitle: string;
    received_private_badge: string;
    received_col_guest: string;
    received_col_gift: string;
    received_col_category: string;
    received_col_amount: string;
    received_col_note: string;
    received_guest_none: string;
    received_gift_placeholder: string;
    received_note_placeholder: string;
    received_cat_gift: string;
    received_cat_money: string;
    received_cat_experience: string;
    received_cat_voucher: string;
  };
  /** Day-of run-of-show — CRUD over the schedule_events table. */
  schedule: {
    title: string;
    sub: string;
    add_event: string;
    edit_event: string;
    delete_event: string;
    key_moment_toggle: string;
    key_moment_max: string;
    download_pdf: string;
    field_label: string;
    field_label_placeholder: string;
    field_time: string;
    field_duration: string;
    field_duration_placeholder: string;
    field_location: string;
    field_location_placeholder: string;
    field_notes: string;
    field_notes_placeholder: string;
    /** Run-sheet fields: responsible person + booked supplier. */
    field_responsible: string;
    field_responsible_placeholder: string;
    field_supplier: string;
    field_supplier_none: string;
    save: string;
    saving: string;
    delete_confirm_title: string;
    delete_confirm_body: string;
    label_required: string;
    time_required: string;
    save_failed: string;
    save_conflict: string;
    empty_title: string;
    empty_body: string;
    wand_button: string;
    wand_button_hint: string;
    wand_dialog_title: string;
    wand_dialog_body: string;
    wand_start_label: string;
    wand_end_label: string;
    /** Inline hint under the End picker once the user has chosen an end
     *  at-or-before the start, signalling we're laying the schedule across
     *  two calendar days. */
    wand_overnight_hint: string;
    wand_window_error: string;
    /** Drawer toggle that flips `starts_at_minutes` by +1440 so the user
     *  can record a single post-midnight event without going through the
     *  wand. */
    field_next_day: string;
    /** Small pill rendered next to the time on schedule rows whose start
     *  falls past midnight (i.e. `starts_at_minutes >= 1440`). Surfaces
     *  the "second calendar day" hint so couples and suppliers don't read
     *  a 01:00 event as 1 AM the same morning. */
    day_two_badge: string;
    wand_warning_existing: string;
    /** Receives `{count}` + `{total}`. */
    wand_select_label: string;
    wand_select_all: string;
    wand_select_none: string;
    /** Receives `{count}`. */
    wand_apply: string;
    /** Receives `{count}`. */
    wand_apply_done: string;
    /** Receives `{n}`. */
    duration_unit: string;
    /** Receives `{label}` — the existing event that blocks the slot. */
    time_conflict: string;
    /** Wand row badge for items whose proposed start falls in a booked slot. */
    wand_item_conflict: string;
    /** Label for events with no duration set (duration_minutes is null). */
    open_ended: string;
    view_proportional: string;
    view_timeline: string;
    view_list: string;
    /** Receives `{n}` — gap in minutes between two consecutive events. */
    gap_label: string;
    /** Day-summary card. Receives `{count}` — number of schedule events. */
    summary_events: string;
    /** Day-summary card. Receives `{count}` — expected guest headcount. */
    summary_guests: string;
    /** Tooltip on the day-summary card's venue name, which links to that
     *  vendor's card (or the vendors hub when the venue isn't a directory
     *  entry). */
    summary_venue_link: string;
    /** Timeline-row badge on key-moment beats — these surface on the public
     *  wedding site, so the badge tells the couple "guests can see this". */
    guest_visible_badge: string;
  };
  guests: {
    title: string;
    add: string;
    add_hint: string;
    import_csv: string;
    import_csv_hint: string;
    download_template_hint: string;
    meals_hint: string;
    csv_help: string;
    full_name: string;
    email: string;
    send_invite_label: string;
    send_invite_help: string;
    send_invite_disabled_help: string;
    invite_send: string;
    invite_send_count: string;
    invite_send_hint: string;
    invite_none_eligible: string;
    invite_confirm_title: string;
    invite_confirm_intro: string;
    invite_confirm_eligible: string;
    invite_confirm_already: string;
    invite_confirm_no_email: string;
    invite_confirm_send: string;
    invite_sent_toast: string;
    invite_failed_toast: string;
    phone: string;
    group: string;
    rsvp: string;
    actions: string;
    edit: string;
    delete: string;
    confirm_delete: string;
    rsvp_pending: string;
    rsvp_yes: string;
    rsvp_no: string;
    rsvp_maybe: string;
    invite_link: string;
    copy_invite: string;
    invite_copied: string;
    plus_one: string;
    household_label: string;
    household_assign_help: string;
    household_new: string;
    household_new_label: string;
    household_existing: string;
    household_code: string;
    household_share_link: string;
    household_guest_message: string;
    household_share_copied: string;
    household_regenerate_code: string;
    household_regenerate_confirm_title: string;
    household_regenerate_confirm_body: string;
    household_add_member: string;
    household_remove_confirm_title: string;
    household_remove_confirm_body: string;
    household_remove: string;
    household_expand: string;
    household_collapse: string;
    /** Bed-icon button toggle in each household header — flips the per-household
     *  `rsvp_offers_accommodation` flag so the public RSVP form for that family
     *  surfaces (or hides) the "needs accommodation?" checkbox. */
    household_accommodation_on: string;
    household_accommodation_off: string;
    household_section_title: string;
    household_section_help: string;
    couple_slug_title: string;
    couple_slug_help: string;
    couple_slug_save: string;
    couple_slug_invalid: string;
    couple_slug_taken: string;
    /** Compact "Check-in: ANDORSARI · + 8-character code (?)" pill at the top
     *  of /app/guests. Expands to slug edit + help text on click. */
    checkin_pill_lead: string;
    checkin_pill_suffix: string;
    checkin_pill_show: string;
    checkin_pill_hide: string;
    /** General RSVP check-in link card (couple identifier pre-filled). */
    checkin_open_title: string;
    checkin_open_help: string;
    checkin_open_rsvp: string;
    checkin_copy_link: string;
    checkin_link_copied: string;
    /** Read-only slug copy — the slug is no longer editable in-app. */
    couple_slug_help_locked: string;
    /** "Invited?" checkbox UX on the household card list. */
    invited_check_label: string;
    invited_short: string;
    invited_progress_help: string;
    /** Header pill that surfaces how many invitations have been physically handed over. */
    delivered_short: string;
    delivered_progress_help: string;
    /** 3-state invite chip labels (not-invited / invited / delivered) + next-state hints. */
    invite_state_not_invited: string;
    invite_state_invited: string;
    invite_state_delivered: string;
    /** Mobile-only short label rendered inside the chip when the screen is
     *  too narrow for icons-with-tooltip discovery. Sub-6-char target. */
    invite_state_not_invited_short: string;
    invite_state_cycle_to_invited: string;
    invite_state_cycle_to_delivered: string;
    invite_state_cycle_to_clear: string;
    invite_email_opened: string;
    invite_email_opened_at: string;
    /** Page-level summary chips above the household list. */
    total_summary_unit: string;
    total_summary_households: string;
    total_summary_invited: string;
    total_summary_households_unit: string;
    total_summary_invited_unit: string;
    total_summary_planned_unit: string;
    stat_planned_action: string;
    stat_total_action: string;
    stat_households_action: string;
    stat_invited_action: string;
    invited_filter_label: string;
    household_filter_label: string;
    household_filter_empty: string;
    filters_button: string;
    filters_clear_all: string;
    filter_group_rsvp: string;
    filter_group_side: string;
    filter_group_more: string;
    filter_invited_chip: string;
    filter_accommodation_chip: string;
    filtered_results_one: string;
    filtered_results_other: string;
    filtered_results_empty: string;
    sort_label: string;
    sort_default: string;
    sort_name: string;
    sort_added: string;
    sort_rsvp: string;
    sort_group: string;
    /** Drag-handle tooltip / aria-label for reordering households. */
    reorder_drag: string;
    /** Toast when persisting the manual household order fails. */
    reorder_failed: string;
    /** Adult / child / baby kind selector. */
    kind_label: string;
    kind_help: string;
    /** Supplier tag (DJ, photographer, ...) on a guest. */
    supplier_label: string;
    supplier_help: string;
    supplier_badge: string;
    /** "+1" chip on a guest auto-created from another guest's plus-one. */
    plus_one_badge: string;
    kind_adult: string;
    kind_child: string;
    kind_baby: string;
    /** 4th guest type — supersedes the old supplier checkbox; routes the guest
     *  into the dedicated supplier household. */
    kind_supplier: string;
    kind_plus_one: string;
    plus_one_type_help: string;
    plus_one_assign_label: string;
    plus_one_assign_help: string;
    plus_one_assign_placeholder: string;
    plus_one_assign_empty: string;
    plus_one_assign_required: string;
    /** "Filled {date}" stamp under the RSVP row once an answer is recorded. */
    rsvp_filled_at: string;
    /** Plus-one block in the guest drawer — the couple fills the guest's +1,
     *  which materialises as a real guest on save. */
    plus_one_label: string;
    plus_one_help: string;
    plus_one_placeholder: string;
    /** Tooltip + a11y label on the Crown icon next to bride / groom rows. */
    partner_role_bride: string;
    partner_role_groom: string;
    /** Free-text search above the household list. */
    search_label: string;
    search_placeholder: string;
    search_empty: string;
    search_clear: string;
    search_load_more: string;
    /** Per-row "Print place card" icon button + toast on click. */
    print_place_card: string;
    print_place_card_started: string;
    /** Cards ↔ table view toggle + spreadsheet-lens table headers. */
    view_label: string;
    view_cards: string;
    view_table: string;
    table_col_name: string;
    table_col_household: string;
    table_col_group: string;
    /** Tooltip on the group cell: the edit propagates to the household. */
    table_group_household_hint: string;
    table_col_rsvp: string;
    table_col_meal: string;
    table_col_dietary: string;
    table_col_accommodation: string;
    table_col_invited: string;
    table_col_actions: string;
    table_meal_unset: string;
    /** Dietary toggle-select placeholder: none vs "{count} selected". */
    table_dietary_none: string;
    table_dietary_selected: string;
    table_sort_hint: string;
    table_household_placeholder: string;
    table_new_name_placeholder: string;
    table_email_placeholder: string;
    dietary: string;
    /** Allergies / free-text dietary notes — separate from `meal` (the picker). */
    allergies: string;
    allergies_placeholder: string;
    /** Re-uses the meal picker label — kept distinct from `dietary`. */
    meal: string;
    notes: string;
    accommodation: string;
    song_request: string;
    song_title_placeholder: string;
    song_add: string;
    song_add_link: string;
    song_remove: string;
    // ── Orphan-guests rescue card ────────────────────────────────────
    orphans_title: string;
    orphans_body: string;
    orphans_assign_button: string;
    orphans_assigning: string;
    orphans_support_link: string;
    orphans_support_url: string;
    // ── Import errors modal ──────────────────────────────────────────
    import_imported_label: string;
    import_skipped_label: string;
    import_errors_label: string;
    import_errors_title: string;
    import_errors_body: string;
    import_errors_close: string;
    import_row_label: string;
    // ── RSVP badge accessible labels (per status) ────────────────────
    rsvp_badge_pending: string;
    rsvp_badge_yes: string;
    rsvp_badge_no: string;
    rsvp_badge_maybe: string;
    // ── Copy-link manual fallback ────────────────────────────────────
    copy_failed_title: string;
    copy_failed_body: string;
    copy_failed_close: string;
    meal_meat: string;
    meal_fish: string;
    meal_vegetarian: string;
    meal_vegan: string;
    meal_child: string;
    meal_none: string;
    group_his_family: string;
    group_her_family: string;
    group_his_friends: string;
    group_her_friends: string;
    group_shared_friends: string;
    group_work: string;
    group_other: string;
    empty_title: string;
    empty_body: string;
    empty_cta_add: string;
    saving: string;
    import_done_one: string;
    import_done_other: string;
    download_template: string;
    guest_section_divider: string;
    hosts_badge: string;
    /** Per-household RSVP settings panel (replaces the legacy Profile-page
     *  pair). Renders inside each expanded household card on /app/guests so
     *  every party can decide which RSVP questions surface for them. */
    rsvp_settings_title: string;
    rsvp_settings_help: string;
    rsvp_offers_accommodation_label: string;
    rsvp_offers_accommodation_help: string;
    rsvp_offers_accommodation_short: string;
    rsvp_collects_meal_label: string;
    rsvp_collects_meal_help: string;
    meals_button: string;
    meals_title: string;
    meals_help: string;
    meals_total_yes: string;
    meals_section_meals: string;
    meals_section_meals_help: string;
    /** Editable meal-menu (custom labels + offered flags). */
    meals_edit_menu: string;
    meals_menu_save: string;
    meals_menu_reset: string;
    meals_menu_saved: string;
    meals_menu_edit_help: string;
    meals_menu_offered: string;
    meals_menu_add_option: string;
    meals_menu_remove_option: string;
    meals_menu_custom_placeholder: string;
    meal_custom_unnamed: string;
    meals_menu_custom_badge: string;
    meals_section_dietary: string;
    meals_section_dietary_help: string;
    meals_pending_label: string;
    meals_pending_help_one: string;
    meals_pending_help_other: string;
    /** "X gyermekkel" — small chip above the stacked bar so the caterer sees
     *  babies separately from the chart (babies don't eat from the menu). */
    meals_baby_count_one: string;
    meals_baby_count_other: string;
    /** Pending count rendered as an amber pill in the chip row above the bar. */
    meals_pending_chip_one: string;
    meals_pending_chip_other: string;
    meals_no_yes_yet: string;
    meals_copy_text: string;
    meals_copy_success: string;
    meals_download_text: string;
    meals_download_success: string;
    meals_csv_col_category: string;
    meals_csv_col_item: string;
    meals_csv_col_count: string;
    meals_csv_cat_meal: string;
    meals_csv_cat_allergen: string;
    meals_summary_header: string;
    meals_close: string;
  };
  budget: {
    title: string;
    sub: string;
    category: string;
    label: string;
    planned: string;
    actual: string;
    paid: string;
    /** Transient acknowledgement on an inline amount field after it commits. */
    saved: string;
    paid_mark_full: string;
    paid_record: string;
    paid_record_help: string;
    paid_needs_actual: string;
    paid_unit: string;
    paid_unit_pct: string;
    paid_unit_amount: string;
    payment_total: string;
    payment_history: string;
    payment_opening: string;
    payment_empty: string;
    payment_add: string;
    payment_date: string;
    payment_delete: string;
    payment_delete_confirm_title: string;
    payment_delete_confirm_body: string;
    payment_pdf_attach: string;
    payment_pdf_view: string;
    payment_pdf_remove: string;
    payment_pdf_attached: string;
    payment_pdf_failed: string;
    payment_remaining: string;
    payment_settled: string;
    /** Overpaid states: recorded payments exceed the line's actual cost, which
     *  happens when the actual is edited down after deposits were logged.
     *  {amount} is the formatted excess. */
    payment_overpaid: string;
    paid_overpaid_by: string;
    payment_added: string;
    payment_amount_required: string;
    docs_title: string;
    docs_empty: string;
    docs_upload: string;
    docs_hint: string;
    docs_uploaded: string;
    docs_too_large: string;
    docs_bad_type: string;
    docs_limit: string;
    docs_upload_failed: string;
    docs_delete_confirm_title: string;
    remaining_label: string;
    delta: string;
    note: string;
    note_placeholder: string;
    add_line: string;
    save_snapshot: string;
    snapshot_name_prompt: string;
    snapshot_name_label: string;
    snapshot_name_help: string;
    snapshot_save_failed: string;
    /** Inline retry toast when a line save fails. */
    save_failed_retry: string;
    /** 409 from optimistic concurrency — another editor touched this row. */
    save_conflict: string;
    snapshots_title: string;
    no_snapshots: string;
    delete: string;
    total_planned: string;
    total_actual: string;
    cap: string;
    over_budget: string;
    over_budget_strip: string;
    cost_per_guest: string;
    slider_scope_note: string;
    // ── Cost-planning panel ─────────────────────────────────────────
    cost_planning_title: string;
    cost_planning_with_count: string;
    /** Eyebrow above the big centred guest-count tile. */
    cost_planning_headline: string;
    cost_planning_help: string;
    cost_planning_baseline_note: string;
    /** Standalone "vendég" / "guests" label rendered under the big count tile. */
    cost_planning_unit_label: string;
    /** Aria-label + tooltip on the big guest-count tile when it's currently
     *  unlocked. Clicking the tile pins the headcount slider; the lock badge
     *  rotates from open → closed and the slider tucks itself away. */
    cost_planning_count_lock_aria: string;
    /** Aria-label + tooltip on the same tile when the headcount is already
     *  pinned. Clicking unlocks and re-expands the slider. */
    cost_planning_count_unlock_aria: string;
    /** "Payments due" roll-up band above the budget table. */
    payments_due_title: string;
    payments_due_sub: string;
    payments_paid: string;
    payments_outstanding: string;
    payments_due_30: string;
    payments_next: string;
    payments_none_dated: string;
    /** Collapsible bucket headings under the roll-up. `payments_due_30` doubles
     *  as the 30-day bucket's heading. Cut by a rolling 7 / 30 days rather than
     *  a calendar week, which no single label can state unambiguously. */
    payments_group_overdue: string;
    payments_group_7: string;
    payments_group_later: string;
    /** Installments with no due date ("balance on the day"). */
    payments_group_undated: string;
    payments_group_paid: string;
    /** "{n} days late" on an overdue row — the direction indicator that keeps
     *  the bucket from relying on colour alone. */
    payments_overdue_by: string;
    /** Aria-label + tooltip on the per-row mark-paid tick. */
    payments_mark_paid_aria: string;
    payments_marked_paid: string;
    lines_title: string;
    lines_sub: string;
    /** Replaces `lines_sub` while every amount is still zero — onboarding seeds
     *  no lines, so the table's first impression is fifteen zero rows. */
    lines_all_zero: string;
    lines_empty: string;
    /** Label for the totals row at the bottom of the budget lines table. */
    lines_totals_label: string;
    /** Hint shown in the aggregated honeymoon row's note cell. */
    honeymoon_breakdown_hint: string;
    /** Aria-label for the chevron link that opens /app/honeymoon. */
    honeymoon_open_aria: string;
    snapshots_sub: string;
    snapshot_default_name: string;
    snapshot_planned_label: string;
    snapshot_actual_label: string;
    snapshot_diff_label: string;
    /** Button label on each snapshot card. */
    snapshot_restore_label: string;
    /** Confirm dialog title before overwriting live lines. */
    snapshot_restore_confirm_title: string;
    /** Confirm dialog body — must explain that DIY supplier lines survive. */
    snapshot_restore_confirm_body: string;
    /** Confirm button label inside the destructive restore dialog. */
    snapshot_restore_confirm_yes: string;
    /** Success toast — receives `{n}` (restored line count). */
    snapshot_restored: string;
    /** Generic failure toast for a restore round-trip. */
    snapshot_restore_failed: string;
    /** Button label on each snapshot card — opens the breakdown dialog. */
    snapshot_breakdown_label: string;
    /** Title of the per-snapshot category breakdown dialog. */
    snapshot_breakdown_title: string;
    /** Row label for the totals row at the bottom of the breakdown table. */
    snapshot_breakdown_total_label: string;
    /** Caption naming the small delta figure in the snapshot breakdown. */
    snapshot_breakdown_vs_now: string;
    snapshot_delta_title: string;
    add_template_help: string;
    edit_planned_aria: string;
    per_guest_unit: string;
    /** Tooltip naming both halves of a row's "actual / planned" pair. The slash
     *  is dense enough to scan but says nothing about which number is which. */
    amount_pair_title: string;
    /** Aria-label on the category toggle button when the row is unfrozen. */
    freeze_aria: string;
    /** Aria-label on the category toggle button when the row is frozen. */
    unfreeze_aria: string;
    /** Aria-label on the per-row amount when it's a deep-link to the budget
     *  table for precise entry. */
    open_table_aria: string;
    /** Toast shown when the backend rejects a write because the category is
     *  frozen. The user needs to unfreeze first. */
    frozen_save_failed: string;
    /** Header pill label when the actual-spend overlay is OFF (clicking turns
     *  it on). Used only on /app/budget. */
    show_actual_overlay: string;
    /** Header pill label when the actual-spend overlay is ON. */
    hide_actual_overlay: string;
    category_locked_hint: string;
    /** Pill at the end of the CostPlanningCard row list — click expands the
     *  inline add-row form. */
    add_custom_row: string;
    /** The same affordance on the mobile card list (`AddCustomRowMobile`),
     *  where the full-width button draws its own "+" beside the label. A
     *  visible label, unlike the `_aria` keys below it. */
    custom_row_add: string;
    /** Placeholder for the label input in the add-row inline form. */
    custom_row_label_placeholder: string;
    /** Placeholder for the amount input in the add-row inline form. */
    custom_row_amount_placeholder: string;
    /** Confirm button on the add-row inline form. */
    custom_row_save: string;
    /** Cancel button on the add-row inline form. */
    custom_row_cancel: string;
    /** aria-label for the per-row X handle on a custom budget row. */
    custom_row_delete_aria: string;
    /** aria-label for the slider on a custom budget row. */
    custom_row_edit_aria: string;
    /** Inline error when the user submits the add-row form with empty label. */
    custom_row_label_required: string;
    /** Toggle next to the icon picker — opt this custom row into headcount
     *  scaling (mirrors `PER_GUEST_CATEGORIES` for built-ins). */
    custom_row_per_guest_toggle: string;
    /** Label above the inline icon picker in the add-row form. */
    custom_row_icon_label: string;
    /** Localised names for the icons offered in the picker. The key matches
     *  the slug stored in `budget_lines.icon`. */
    custom_row_icon_choice: {
      Sparkles: string;
      Heart: string;
      Star: string;
      Bell: string;
      Briefcase: string;
      ShoppingBag: string;
    };
    slider_min_aria: string;
    slider_max_aria: string;
    over_by: string;
    under_by: string;
    /** Why the slider on this row is read-only: the amount is mirrored from a
     *  booked supplier and changes on that supplier's card, not here. */
    supplier_managed_hint: string;
    cat: {
      venue: string;
      catering: string;
      drinks: string;
      attire: string;
      decor_floral: string;
      photo_video: string;
      music_dj: string;
      cake_dessert: string;
      hair_makeup: string;
      transport: string;
      honeymoon: string;
      stationery: string;
      favours: string;
      rings: string;
      other: string;
    };
  };
  /** DIY supplier modal surfaces specific to Loop C₂'s "Already paid" flow.
   *  Kept separate from `suppliers.diy_modal_*` so the snapshot UI loop and
   *  the suppliers page surface don't fight over the same namespace. */
  diy: {
    /** Checkbox label below the price input in DiyEntryModal. */
    paid_label: string;
    /** Help line under the toggle when enabled / enabled-able. */
    paid_help: string;
    /** Help line shown when the toggle is disabled because price is empty. */
    paid_disabled_hint: string;
    /** Payment-schedule editor (DiyEntryModal). */
    schedule_title: string;
    schedule_add: string;
    schedule_empty: string;
    schedule_save_first: string;
    schedule_needs_price: string;
    schedule_paid: string;
    schedule_outstanding: string;
    schedule_mark_paid: string;
    schedule_label_placeholder: string;
    schedule_amount: string;
    schedule_due: string;
    schedule_delete: string;
  };
  /** "Gifts received" money-in ledger on the budget page. */
  income: {
    title: string;
    sub: string;
    received: string;
    spent: string;
    net_cost: string;
    surplus: string;
    recovered_pct: string;
    field_label: string;
    field_label_placeholder: string;
    field_amount: string;
    col_note: string;
    private_badge: string;
  };
  /** Cost-planning panel surfaces that don't belong to the budget *table*:
   *  HU benchmark strip, tiered over-cap warnings, page-level cost-per-guest
   *  rows. Kept separate from `budget.*` so the snapshot UI (Agent B) and the
   *  planning UX (this agent) don't fight over the same namespace. */
  cost_planning: {
    /** Quiet HU benchmark line under the planned total. Receives `{count}` =
     *  current slider count, `{min}`/`{mid}`/`{max}` = compact HUF range, and
     *  `{userTotal}` = formatted full HUF the couple is currently at. */
    benchmark_strip: string;
    /** Tooltip / title attribute for the "where do these numbers come from?"
     *  affordance — methodology disclaimer in one breath. */
    benchmark_methodology: string;
    /** Tiny "(?)" affordance label after the benchmark strip. */
    benchmark_source_hint: string;
    /** Over-cap pill copy, shared by soft (0–5 %) and medium (5–20 %) tiers.
     *  Receives `{amount}` — the soft tier renders the same exact-amount copy
     *  so the user always sees the precise overage, not a vague hand-wave. */
    overcap_medium_label: string;
    /** Always-on planned row under the headline.
     *  Receives `{amount}` (per-guest planned) and `{count}` (slider count). */
    per_guest_planned: string;
    /** Actual row, only when at least one yes-RSVP exists. Receives
     *  `{amount}` (per-guest actual) and `{confirmed}` (yes-RSVP count). */
    per_guest_actual: string;
  };
  /** /app/logistics — drag-and-drop accommodation + transfer assignment. */
  logistics: {
    title: string;
    sub: string;
    tabs_aria: string;
    tab_accommodation: string;
    tab_transfer: string;
    add_accommodation: string;
    add_transfer: string;
    edit_accommodation: string;
    edit_transfer: string;
    sidebar_title: string;
    sidebar_help_accommodation: string;
    sidebar_help_transfer: string;
    sidebar_empty: string;
    drop_guest_here: string;
    no_accommodations: string;
    no_accommodations_hint: string;
    no_transfers: string;
    no_transfers_hint: string;
    name: string;
    /** Specific "name of the accommodation" — replaces the bare "Név" so
     *  couples don't think the field asks for a person's name. */
    accommodation_name: string;
    accommodation_name_placeholder: string;
    address: string;
    address_placeholder: string;
    capacity: string;
    /** Helper text under the capacity stepper. */
    capacity_help: string;
    /** Currency-agnostic "Price" label — symbol shown as an input adornment. */
    price_label: string;
    /** Helper text under the price input. */
    price_help: string;
    link: string;
    link_placeholder: string;
    contact: string;
    contact_placeholder: string;
    notes: string;
    notes_placeholder: string;
    name_required: string;
    label_required: string;
    capacity_invalid: string;
    offer_on_rsvp: string;
    offer_on_rsvp_help: string;
    price_invalid: string;
    save_failed: string;
    accommodation_deleted: string;
    transfer_deleted: string;
    delete_accommodation_title: string;
    delete_accommodation_body: string;
    delete_transfer_title: string;
    delete_transfer_body: string;
    transfer_label: string;
    transfer_label_placeholder: string;
    transfer_direction: string;
    transfer_direction_placeholder: string;
    transfer_direction_outbound: string;
    transfer_direction_return: string;
    transfer_depart_at: string;
    transfer_capacity: string;
    transfer_assigned: string;
    /** Tap-to-assign mode — mirrors SeatingPage so touch users don't need DnD. */
    tap_mode_on: string;
    tap_mode_off: string;
    tap_select_help: string;
    tap_place_hint: string;
    tap_unassign_hint: string;
    /** Full-cap / over-cap blocked toast when a tap target can't take more. */
    full_blocked: string;
    /** Partial placement toast when a household drag/tap exceeds free seats. */
    partial_placed: string;
    /** Inline labels + helper copy for the host/partner placeholder cards
     *  on /app/logistics (mirror the same labels seating uses). */
    bride_label: string;
    groom_label: string;
    partner_placeholder_hint: string;
    /** Household link/unlink + ARIA copy shared with seating. */
    household_unlink: string;
    household_relink: string;
    household_linked_aria: string;
    /** Rooms within an accommodation: CRUD labels, the per-room capacity help,
     *  delete confirm copy (`{name}`), and the "guests at the accommodation but
     *  not yet in a room" strip header. */
    add_room: string;
    edit_room: string;
    room_name: string;
    room_name_placeholder: string;
    room_capacity_help: string;
    room_name_required: string;
    room_deleted: string;
    delete_room_title: string;
    delete_room_body: string;
    unroomed_label: string;
  };
  seating: {
    title: string;
    sub: string;
    add_table: string;
    table_label_prompt: string;
    seats_label: string;
    /** Numbered seat count, e.g. "6 hely" / "6 seats". `{n}` is the count. */
    seats_count: string;
    shape_label: string;
    shape_round: string;
    shape_long: string;
    shape_square: string;
    shape_head: string;
    delete_table: string;
    duplicate_table: string;
    rotate_table: string;
    /** Free-rotation controls: panel section, canvas handle, round-table caption. */
    rotation_label: string;
    rotation_round_hint: string;
    rotate_handle_aria: string;
    /** Snap-to-grid magnet toggle in the map header. */
    snap_toggle_label: string;
    /** Inline zoom pill on the canvas. */
    zoom_in: string;
    zoom_out: string;
    zoom_reset: string;
    layout_label: string;
    toggle_seat: string;
    /** Hint under a bride / groom placeholder card when the partner isn't
     *  yet in the guests list. */
    partner_placeholder_hint: string;
    /** Fallback labels used when couple.bride_name / groom_name are empty. */
    bride_label: string;
    groom_label: string;
    confirm_delete_table: string;
    unassigned_guests: string;
    no_unassigned: string;
    go_to_guests: string;
    no_tables: string;
    add_first_table: string;
    empty_cta_add_table: string;
    empty_body_no_guests: string;
    empty_cta_add_guests: string;
    empty_cta_fallback_table: string;
    drag_help: string;
    /** Household-aware seating affordances: the badge that marks a guest as
     *  part of a linked household, the unlink/relink toggles, and the
     *  toast copy after dropping a multi-member household onto a table. */
    household_linked_aria: string;
    household_unlink: string;
    household_relink: string;
    household_placed_all: string;
    household_placed_partial: string;
    household_no_room: string;
    conflicts_title: string;
    no_conflicts: string;
    conflict_split: string;
    conflict_avoid: string;
    print_a4: string;
    print_a3: string;
    print_chart: string;
    print_place_cards: string;
    print_format_a4: string;
    print_format_a3: string;
    map_title: string;
    map_help: string;
    map_expand: string;
    map_collapse: string;
    map_recenter: string;
    editor_empty: string;
    size_mm_label: string;
    width_mm_label: string;
    length_mm_label: string;
    position_label: string;
    table_default_label: string;
    add_seat: string;
    remove_seat: string;
    preview_title: string;
    preview_help: string;
    confirm_download: string;
    drop_to_unassign: string;
    drop_to_unassign_active: string;
    room_width_aria: string;
    room_height_aria: string;
    preview_open_in_new_tab: string;
    /** Position readout: "Pozíció: {x} m balról, {y} m fentről". */
    position_label_full: string;
    /** Section divider above the seat-grid. */
    assignments_section_title: string;
    assignments_section_hint: string;
    /** Tap-to-place mode toggle + helper banners. */
    tap_mode_on: string;
    tap_mode_off: string;
    tap_select_help: string;
    /** Hint shown after a guest is tap-selected — uses {guest} placeholder. */
    tap_place_hint: string;
    /** Undo system — toast hints + button labels. */
    undo_action: string;
    undo_label: string;
    undo_failed: string;
    undo_hint_mac: string;
    undo_hint_pc: string;
    /** Toast bodies — use {guest}/{table}/{seat}/{a}/{b}/{old}. */
    toast_assigned: string;
    toast_unassigned: string;
    toast_swapped: string;
    toast_replaced: string;
    toast_moved: string;
    toast_resized: string;
    toast_arranged: string;
    toast_arranged_crowded: string;
    arrange_button_label: string;
    /** Conflict (already-occupied seat) prompt. */
    swap_seats_title: string;
    swap_seats_body: string;
    swap_button: string;
    replace_button: string;
    /** Keyboard cheatsheet. */
    shortcuts_button_label: string;
    shortcuts_title: string;
    shortcut_arrows: string;
    shortcut_arrows_shift: string;
    shortcut_brackets: string;
    shortcut_delete: string;
    shortcut_n: string;
    shortcut_undo: string;
    /** aria-label template for SVG table groups. {name}/{seats}. */
    table_aria_label: string;
    /** Network/save-failed toasts for mutations on this page. */
    save_failed: string;
    save_conflict: string;
    /** Toast when a resize / seat-decrement would orphan a seated guest. */
    table_too_small: string;
    /** Toast + inline hint when the user clicks + at the perimeter cap. */
    seats_at_cap: string;
    seats_at_cap_hint: string;
    /** Cap-toast variant when crossed-out seats could be re-enabled instead. */
    seats_at_cap_reenable: string;
    /** Tooltip on the stepper's "/{max}" cap explaining where it comes from. */
    seats_cap_tooltip: string;
    /** Toast when the server clamped a requested seat count to the footprint. */
    seats_clamped_toast: string;
    /** Inline prompt after a resize that freed capacity + its action button. */
    seats_fit_more_prompt: string;
    seats_fit_more_action: string;
    /** "{enabled}/{total} usable" caption on the seat-layout section. */
    layout_enabled_of_total: string;
    /** Toast when disabling a chair that currently has a seated guest. */
    seat_occupied: string;
    /** Feedback toasts for table create/duplicate/delete. */
    toast_duplicated: string;
    toast_table_deleted: string;
    /** Redo controls (mirrors undo_action / undo_failed). */
    redo_action: string;
    redo_failed: string;
    shortcut_redo: string;
    shortcut_rotate: string;
    shortcut_zoom: string;
    /** Autosave chip states in the toolbar. */
    autosave_saving: string;
    autosave_saved: string;
    autosave_failed: string;
    /** Short visible label next to the tap-mode hand icon. */
    tap_mode_short: string;
    /** Guest search in the unassigned panel + the seat-picker popover. */
    guest_search_placeholder: string;
    guest_search_empty: string;
    /** RSVP-aware pool: declined-guest toggle + seated-declined warning. */
    show_declined_toggle: string;
    hide_declined_toggle: string;
    declined_seated_warning: string;
    /** "{chairs} chairs · {confirmed} confirmed" capacity line. */
    capacity_line: string;
    /** Empty-seat CTA in the TableCard grid. */
    empty_seat_add: string;
    /** Title of the inline guest picker opened from an empty chair. */
    seat_picker_title: string;
    /** Advisory aisle-distance chip on the canvas. */
    aisle_warning_count: string;
    aisle_warning_help: string;
    aisle_warning_dismiss: string;
    /** aria-roledescription on canvas table groups ("movable table"). */
    table_roledescription: string;
    pdf_failed: string;
    pdf_cancel: string;
    pdf_loading: string;
    /** Keyboard-driven seat selection announcement for sr-only live region. */
    keyboard_selected_guest: string;
    keyboard_cleared_selection: string;
    /** Aria-label suffix for tap-mode toggle indicating live state. */
    tap_mode_announce_on: string;
    tap_mode_announce_off: string;
    /** Aria-label for each seat circle in SeatingMap when keyboard-focusable. */
    seat_aria_label: string;
    /** Kids-table toggle in the table editor + badge text on the table. */
    kids_table_label: string;
    kids_table_help: string;
    kids_table_badge: string;
    /** Integrated editor mode-switch tabs. */
    mode_edit_tab: string;
    mode_seat_tab: string;
    /** Compact guest panel header in seat mode. */
    seat_mode_panel_title: string;
    /** Hint text under the mode tabs in seat mode. */
    seat_mode_help: string;
    /** Tap instruction shown in seat mode when a guest is selected. */
    seat_tap_place: string;
    /** Used by unassign button that appears when a guest is click-selected in seat mode. */
    seat_unassign_selected: string;
    /** Table seat-roster panel (right side, seat mode, table selected). */
    table_panel_filled: string;
    table_panel_seat_n: string;
    table_panel_empty_seat: string;
    table_panel_assign_here: string;
    table_panel_assign_placeholder: string;
    table_panel_assign_none: string;
    table_panel_assign_no_match: string;
    table_panel_unassign: string;
    table_panel_close: string;
    /** Seat-mode progress summary bar (top of page). */
    progress_label: string;
    progress_remaining: string;
    progress_done: string;
    /** Nudge + placeholder to name auto-default ("Table 4") tables. */
    name_table_hint: string;
    table_name_placeholder: string;
  };
  suppliers: {
    title: string;
    sub: string;
    contact_email: string;
    visit_website: string;
    /** Phone button on a directory card before the number is fetched, and
     *  after a failed fetch. The number is never in the catalogue payload —
     *  it is asked for at the moment somebody means to call. */
    phone_reveal: string;
    phone_failed: string;
    /** Tooltip on any vendor NAME that links to its directory card from outside
     *  the directory — the message threads and the outreach recipient list. */
    open_card: string;
    /** Tooltips on the muted Globe/Phone/Mail chips in the supplier card and
     *  Timeline point-of-contact card when the supplier has no contact data on
     *  file. */
    no_website: string;
    no_phone: string;
    no_email: string;
    filter_all: string;
    show_all_in_category: string;
    community_pill: string;
    community_pill_tooltip: string;
    self_pill: string;
    self_pill_tooltip: string;
    verified_vendor: string;
    /** Same badge, drawn as an outline: registered vendor whose listing setup
     *  isn't finished yet (no photos, no price…). See `<VerifiedBadge>`. */
    verified_vendor_incomplete: string;
    /** Short label for the verified-only filter toggle in the country/price row. */
    verified_filter: string;
    /** Chip that opens the scoping-filter dialog (country / price / guests). */
    filters_button: string;
    filters_clear: string;
    filters_apply: string;
    drop_your_own: string;
    /** Cake & drinks calculator — surfaced from the food/drink category header. */
    calc: {
      open: string;
      open_aria: string;
      title: string;
      intro: string;
      item_toggle_hint: string;
      guests_label: string;
      sweets_buffer_label: string;
      drinks_buffer_label: string;
      qty_edit_hint: string;
      col_item: string;
      col_qty: string;
      col_unit_price: string;
      col_total: string;
      item_sweet_pastry: string;
      item_savory_pastry: string;
      item_cake: string;
      item_spirits: string;
      item_wine: string;
      item_champagne: string;
      item_beer: string;
      unit_kg: string;
      unit_slice: string;
      unit_liter: string;
      unit_bottle: string;
      portion_sweet: string;
      portion_savory: string;
      portion_cake: string;
      portion_spirits: string;
      portion_wine: string;
      portion_champagne: string;
      portion_beer_mugs: string;
      portion_beer_mug_size: string;
      subtotal_sweets: string;
      subtotal_cake: string;
      subtotal_drinks: string;
      grand_total: string;
      note: string;
      reset: string;
      close: string;
      onb_drinks_q: string;
      onb_sweets_q: string;
      onb_hint: string;
      onb_next: string;
      onb_back: string;
      onb_done: string;
    };
    /** "Csinálom magam" / DIY flow — couple-private supplier entries. */
    diy_pill: string;
    diy_button: string;
    diy_button_short: string;
    /** Per-category "I don't need this" tick — marks the active sub-category as
     *  one the couple doesn't need, greening its runner segment. */
    not_needed_toggle: string;
    not_needed_aria: string;
    /** Planner self-organize done-toggle (replaces DIY for planners). */
    self_organize_label: string;
    self_organize_hint: string;
    diy_modal_title: string;
    diy_modal_intro: string;
    diy_modal_name_label: string;
    diy_modal_name_placeholder: string;
    diy_modal_category_label: string;
    diy_modal_notes_label: string;
    diy_modal_notes_placeholder: string;
    diy_modal_price_label: string;
    diy_modal_price_help: string;
    diy_modal_submit: string;
    diy_modal_submitting: string;
    diy_modal_delete: string;
    diy_modal_delete_confirm_title: string;
    diy_modal_delete_confirm_body: string;
    diy_modal_cancel: string;
    diy_modal_privacy: string;
    diy_modal_edit: string;
    diy_action_edit_aria: string;
    diy_action_delete_aria: string;
    diy_price_display: string;
    /** "This vendor is already on Weddly" — shown under the name field of any
     *  form that can mint a private supplier row, when what the couple typed
     *  matches a directory listing. See DirectoryTwinNotice. */
    twin: {
      /** Loose (prefix / contained) match: an offer, the form still saves. */
      title: string;
      /** Exact name match: the save is held until they choose. */
      blocking_title: string;
      /** Why the listed entry is the better one to pick. */
      body: string;
      /** Adopt the listing instead of creating a private copy. */
      use: string;
      /** Escape hatch out of the block: "this is a different vendor". */
      different: string;
      /** Confirmation after adopting. `{name}` = the listing's name. */
      adopted_toast: string;
    };
    /** Free-text search input above the chain. */
    search_label: string;
    search_placeholder: string;
    /** City select / filter. */
    city_label: string;
    city_all: string;
    /** Type tags on the supplier-search typeahead rows. */
    suggest_city: string;
    suggest_category: string;
    suggest_supplier: string;
    /** "+N km" suffix on the city filter when the typed town has no listing
     *  of its own and results come from the surrounding radius. */
    nearby_plus_km: string;
    /** Empty result state when search/city filters out everything. */
    empty_filtered: string;
    /** "Load more" button under the grid; {n} = how many more are hidden. */
    load_more: string;
    /** "Már foglaltam" / "Already booked" card on the directory grid.
     *  Only rendered when the active group AND sub-category are both
     *  set. Couples either pick an existing match via the autocomplete
     *  (adopts it as their selection) or fill the inline form to add
     *  a new vendor; the new entry lands in the same admin moderation
     *  queue as the regular Tipp leadása flow, but the couple never
     *  sees the word "tipp" anywhere on the card. */
    bookedCard: {
      title: string;
      /** Sub-title under the card heading; receives `{category}` (HU
       *  category label like "Esküvői helyszín"). */
      subtitle: string;
      input_label: string;
      placeholder: string;
      address_label: string;
      address_placeholder: string;
      phone_label: string;
      phone_placeholder: string;
      email_label: string;
      email_placeholder: string;
      website_label: string;
      website_placeholder: string;
      match_already_picked: string;
      /** Toast when the couple adopts an existing directory entry from
       *  the autocomplete; receives `{name}` (supplier name). */
      toast_added: string;
      /** Toast after a brand-new entry POSTs successfully; receives
       *  `{name}` (the typed name the couple just submitted). */
      toast_submitted: string;
      /** Generic submission failure copy. */
      err_generic: string;
      /** Primary action button label ("Hozzáadás" / "Add"). */
      add: string;
      /** Loading-state label on the same button. */
      submitting: string;
      /** SR + tooltip label on the collapsed header toggle. */
      expand: string;
      /** SR + tooltip label on the expanded header toggle. */
      collapse: string;
    };
    /** Shown above the result list when the typed city wasn't in the
     *  directory but resolved to a known metro area (e.g. "Zsámbék" →
     *  Budapest). Has `{query}` and `{anchor}` placeholders. */
    nearby_banner: string;
    /** Accommodation category: external booking partner panel. v1 doesn't
     *  list curated hotels, so we steer couples to trusted lodging sites
     *  they can share with guests. */
    accommodation_external_title: string;
    accommodation_external_subtitle: string;
    accommodation_external_booking_blurb: string;
    accommodation_external_airbnb_blurb: string;
    accommodation_external_szallas_hu_blurb: string;
    /** Price-band scale tooltip / legend. */
    price_legend: string;
    /** Saved-supplier star + filter chip. */
    save_aria: string;
    unsave_aria: string;
    save_no_couple: string;
    saved_filter: string;
    /** Per-category "this is our pick" selection — one card per sub-category. */
    pick_aria: string;
    unpick_aria: string;
    picked_filter_idle: string;
    picked_filter_active: string;
    picked_pill: string;
    chain_progress_aria: string;
    /** A settled category shows only what settled it; this pair is the way back
     *  to the rest of the trade. */
    settled_show_all: string;
    settled_collapse: string;
    /** Per-couple planned + final cost row on each supplier card. */
    cost_planned_label: string;
    cost_actual_label: string;
    cost_saved_indicator: string;
    cost_help: string;
    cost_planned_help: string;
    cost_no_line_hint: string;
    /** Capacity chip on the card. */
    capacity_label: string;
    capacity_range: string;
    capacity_max_only: string;
    /** Price-band multi-select pill row above the chain. */
    price_filter_label: string;
    price_filter_help: string;
    price_filter_band_aria: string;
    /** Guest-count input — filters venues whose capacity range covers the value.
     *  Suppliers without a declared capacity pass through. */
    guests_filter_label: string;
    /** The day the couple is shopping for. Seeded with the wedding date. */
    date_filter_label: string;
    /** Tooltip + aria on the marker shown when the date is NOT the wedding
     *  day. The marker is also the one-tap way back, so the copy says so. */
    date_filter_not_wedding: string;
    guests_filter_placeholder: string;
    guests_filter_help: string;
    guests_filter_clear: string;
    /** Tooltip/aria on the wallet link beside the read-only guest count —
     *  the headcount is edited on /app/budget, not here. */
    guests_filter_edit_in_budget: string;
    /** Country picker on the directory filter bar + its "all countries" option. */
    country_filter_label: string;
    country_filter_all: string;
    /** aria-label for the ✕ that resets the country picker to its default. */
    country_filter_reset: string;
    /** Empty state when the active country scope has no matching vendors, plus
     *  the button that widens the scope to all countries. `{country}` is the
     *  localised country name. */
    empty_country: string;
    empty_country_show_all: string;
    /** Heading of the tail block under the results: verified vendors who are
     *  on Weddly but work outside the country being browsed. They are kept out
     *  of the result set entirely, so this label is what explains them. */
    out_of_country_heading: string;
    out_of_country_note: string;
    out_of_country_show_all: string;
    /** Up/downvote buttons + sort. */
    vote_up_aria: string;
    vote_down_aria: string;
    sort_label: string;
    sort_top: string;
    sort_alpha: string;
    sort_price_asc: string;
    sort_price_desc: string;
    /** Grid / line / map view toggle on the directory header. */
    view_label: string;
    view_grid: string;
    view_line: string;
    view_map: string;
    /** Footer note on the map view when some entries aren't geocoded. */
    map_missing_count: string;
    /** Title + popup heading of a map marker several suppliers share (they sit
     *  on the same address, or on the same town-centre fallback coordinate). */
    map_group_count: string;
    submit: {
      title: string;
      intro: string;
      trust_review: string;
      trust_email_private: string;
      next_steps_title: string;
      next_steps_body: string;
      next_steps_review_title: string;
      next_steps_review_body: string;
      category_label: string;
      category_placeholder: string;
      /** Searchable category picker: "change" affordance on the chosen pill,
       *  search input placeholder, empty-result line, common-categories label. */
      category_change: string;
      category_search_placeholder: string;
      category_no_match: string;
      category_common_label: string;
      name_label: string;
      name_placeholder: string;
      city_label: string;
      city_placeholder: string;
      address_label: string;
      address_placeholder: string;
      address_help: string;
      address_resolving: string;
      address_resolved: string;
      address_resolved_partial: string;
      address_resolve_failed: string;
      website_label: string;
      email_label: string;
      email_placeholder: string;
      phone_label: string;
      phone_optional: string;
      blurb_label: string;
      blurb_help: string;
      price_label: string;
      price_help: string;
      submit_button: string;
      submitting: string;
      success_title: string;
      success_body: string;
      cancel: string;
      err_required: string;
      err_invalid_url: string;
      err_invalid_email: string;
      err_too_long: string;
      err_rate_limited: string;
      /** Shown when a contact email is already in the moderation queue: a
       *  re-submission is rejected with a friendly "you're on the waitlist". */
      err_duplicate_email: string;
      /** 409 already-listed toast; receives `{name}` of the live listing. */
      err_already_listed: string;
      /** Live "already on Weddly?" name check on the first step: heading,
       *  thank-you body, the link to the existing listing, and the
       *  in-flight checking hint. */
      already_title: string;
      already_body: string;
      already_view: string;
      already_checking: string;
      /** Visitor-mode email-verify gate (public /vendors register flow). */
      visitor_verify_title: string;
      visitor_verify_body: string;
      /** Toast when a visitor's device token went stale mid-submit. */
      visitor_reverify: string;
      /** Hero "paste a Google Maps link" affordance copy + smart-fill input. */
      magic_title: string;
      magic_help: string;
      magic_placeholder: string;
      magic_or_manual: string;
      magic_resolve: string;
      magic_clear: string;
      /** Section headings on the form side. */
      section_who: string;
      /** "I am the supplier" checkbox label + helper in the Who section.
       *  Drives the trust pill on the public card (Szolgáltató vs Közösségi). */
      is_self_label: string;
      is_self_help: string;
      section_where: string;
      section_contact: string;
      section_pitch: string;
      optional: string;
      /** Live preview pane (right-hand column). */
      preview_title: string;
      preview_caption: string;
      preview_placeholder_name: string;
      preview_placeholder_blurb: string;
      preview_pending_pill: string;
      blurb_count: string;
      progress_label: string;
      /** Word labels paired with the dot price-band cards. */
      band_name: {
        b1: string;
        b2: string;
        b3: string;
        b4: string;
        b5: string;
      };
    };
    /** Abuse-report flow against community-submitted listings. */
    report: {
      aria_label: string;
      title: string;
      /** Body intro — interpolated with {name}. */
      intro: string;
      reason_label: string;
      note_label: string;
      note_placeholder: string;
      submit: string;
      submitting: string;
      thanks_toast: string;
      duplicate_toast: string;
      auto_hidden_toast: string;
      err_rate_limited: string;
      reason: {
        spam: { label: string; desc: string };
        fake: { label: string; desc: string };
        offensive: { label: string; desc: string };
        wrong_info: { label: string; desc: string };
        other: { label: string; desc: string };
      };
    };
    group: {
      planning_rentals: string;
      venue_stay: string;
      food_drink: string;
      decor_flowers: string;
      media: string;
      entertainment: string;
      fashion_beauty: string;
      paper_design: string;
      transport: string;
    };
    cat: {
      wedding_planner: string;
      rental_equipment: string;
      venue: string;
      accommodation: string;
      tent_pavilion: string;
      catering: string;
      cake_dessert: string;
      bar_drinks: string;
      food_trucks: string;
      wedding_decor: string;
      florist: string;
      lighting: string;
      photography: string;
      videography: string;
      content_creator: string;
      photo_booth: string;
      dj: string;
      live_music: string;
      entertainment: string;
      mc_celebrant: string;
      celebrant: string;
      dance_lessons: string;
      sound_tech: string;
      bridal_boutique: string;
      suit_formal: string;
      hair_makeup: string;
      nails: string;
      wedding_jewelry: string;
      stationery: string;
      invitation_graphics: string;
      transport: string;
      other: string;
    };
    /** Venue character labels (the "jelleg" tag, normalised) — one per
     *  VenueStyle in @shared/suppliers. Rendered as a chip beside the
     *  category on venue cards. */
    venue_style: {
      castle: string;
      manor: string;
      estate: string;
      hotel: string;
      resort: string;
      guesthouse: string;
      restaurant: string;
      event_hall: string;
      boat: string;
      waterfront: string;
      nature_park: string;
      venue_with_stay: string;
    };
    /** Side-by-side comparison: couples tick a few suppliers and the
     *  dialog shows price/services next to each other, with verdicts
     *  tailored to the couple's known params (guest count, budget). */
    compare: {
      /** aria + title on the per-card Compare toggle. */
      add_aria: string;
      remove_aria: string;
      /** Floating bottom bar label. `{n}` is selected count. */
      floating_label: string;
      floating_open: string;
      floating_clear: string;
      /** Tooltip when n < 2 — need at least 2 to compare. */
      floating_min_hint: string;
      /** Dialog. */
      dialog_title: string;
      dialog_intro: string;
      dialog_close_aria: string;
      /** Row labels. */
      row_quote: string;
      row_price_band: string;
      row_rating: string;
      row_capacity: string;
      row_city: string;
      row_distance: string;
      row_available: string;
      row_votes: string;
      row_contact: string;
      row_about: string;
      /** Per-cell helpers. `{amount}` formatted HUF, `{n}` is a count. */
      quote_none: string;
      quote_vs_budget_under: string;
      quote_vs_budget_over: string;
      quote_no_budget: string;
      rating_none: string;
      rating_count: string;
      capacity_fits: string;
      capacity_too_small: string;
      capacity_too_large: string;
      capacity_unknown: string;
      /** Capacity row verdict for a category that has no guest capacity at
       *  all, kept distinct from "not declared" so it doesn't read as a gap
       *  in the vendor's listing. */
      capacity_not_relevant: string;
      capacity_no_target: string;
      same_city: string;
      different_city: string;
      distance_no_origin: string;
      distance_unknown: string;
      distance_km: string;
      available_ask: string;
      contact_website: string;
      contact_email: string;
      contact_phone: string;
      contact_none: string;
      /** Per-column actions on the comparison card header. */
      remove_column: string;
    };
    /** Admin-only supplier detail page (admin-gated route, v1 dogfood). Wired
     *  up at /app/suppliers/:supplier_id; the directory card links here only
     *  for admin viewers. */
    detail: {
      /** VendorGallery: thumbnail aria-label, the two arrows, and the zoom. */
      gallery_show_aria: string;
      gallery_prev: string;
      gallery_next: string;
      gallery_zoom: string;
      adminTitle: string;
      back: string;
      claimed: string;
      unclaimed: string;
      /** "{n} értékelés" / "{n} reviews" — header rating chip suffix. */
      reviewsCount: string;
      /** aria-label for StarRow — receives `{rating}` (locale-formatted)
       *  and `{max}` (always 5). */
      starsAria: string;
      /** aria-label / title for the price-band dot row — receives `{band}`
       *  (1..5) and `{max}` (always 5). */
      priceBandAria: string;
      /** Bottom-of-page CTA section that lets the listing owner request the
       *  claim. Renders only on unclaimed listings. The button uses an
       *  armed-confirmation pattern (first click arms, second click fires)
       *  so a stray tap can't kick off a claim request. */
      claim: {
        sectionTitle: string;
        sectionBody: string;
        button: string;
        armed: string;
        sending: string;
        sentToast: string;
        sentBody: string;
        /** Wedding-planner listings get the planner signup here instead of the
         *  claim button: claiming would mint a vendor account, which the API
         *  refuses for this category. */
        plannerTitle: string;
        plannerBody: string;
        plannerCta: string;
      };
      /** Hero-image fallback copy when the listing has no photo yet. */
      hero: {
        noPhotoYet: string;
        noPhotoClaim: string;
        noPhotoAria: string;
      };
      /** Primary actions in the hero + sticky bottom bar. */
      cta: {
        sendInquiry: string;
        inquireDisabled: string;
        inquireSent: string;
        inquireSentEmail: string;
        save: string;
        savedActive: string;
        /** Share the vendor with someone outside Weddly (native share sheet
         *  on mobile, clipboard copy on desktop). */
        share: string;
        shareText: string;
        shareCopied: string;
      };
      reviews: {
        title: string;
        yourRating: string;
        bodyPlaceholder: string;
        tagsLabel: string;
        publishedLabel: string;
        /** Admin composer: post in the editorial voice, or as the admin's own
         *  account on the same terms as any other reviewer. */
        asEditorialLabel: string;
        submit: string;
        submitted: string;
        /** Placeholder in the composer's free-text ("+1") tag input. */
        customTagPlaceholder: string;
        /** Label on the button that commits the typed free-text tag. */
        customTagAdd: string;
        /** Placeholder in the optional "what you paid" amount field. */
        amountPlaceholder: string;
        /** Placeholder in the optional "what you got for the price" note. */
        amountNotePlaceholder: string;
        /** Tooltip shown on the disabled Beküldés button when the rater
         *  hasn't picked a star yet. */
        pickStarFirst: string;
        empty: string;
        alreadyReviewed: string;
        deleted: string;
        deleteConfirmTitle: string;
        deleteConfirmBody: string;
        /** Badge on couple-authored reviews — the engagement-proof gate makes
         *  every couple review a verified one. */
        verifiedBadge: string;
        /** Aria-label on the per-review overflow trigger. The menu carries the
         *  destructive action, so the trash icon no longer sits on the card. */
        menu: string;
        /** The one entry behind that trigger. */
        deleteAction: string;
        /** Shown instead of the composer when the viewer's couple has no
         *  engagement proof for this supplier yet. */
        eligibilityHint: string;
        /** Shown instead of the composer when the couple already reviewed. */
        alreadyReviewedNote: string;
        /** Public-page composer for an outside-Weddly visitor (Google verify). */
        visitorComposerTitle: string;
        visitorPrompt: string;
        visitorSubmitted: string;
      };
      comments: {
        title: string;
        placeholder: string;
        submit: string;
        submitted: string;
        empty: string;
        deleteConfirmTitle: string;
        deleteConfirmBody: string;
        visibility: {
          admin_internal: string;
          public: string;
          vendor_only: string;
        };
      };
      calendar: {
        title: string;
        unclaimedNote: string;
        visitWebsite: string;
        nextAvailable: string;
        fullyBooked: string;
        blockedCount: string;
        noBookings: string;
        downloadIcs: string;
        status: {
          requested: string;
          vendor_seen: string;
          confirmed: string;
          declined: string;
          cancelled: string;
          expired: string;
        };
      };
      adminMeta: {
        title: string;
        id: string;
        source: string;
        vendorAccount: string;
        commentsCount: string;
        redirect: string;
      };
      /** Right-rail sidebar cards on the redesigned detail page — Información,
       *  Kapcsolat, Foglaltság — plus the long-form Bemutatkozás section. */
      info: {
        title: string;
        location: string;
        ratingEmpty: string;
      };
      contact: {
        title: string;
        website: string;
        email: string;
        phone: string;
        empty: string;
      };
      map: {
        open: string;
        openExternal: string;
        iframeTitle: string;
        notFound: string;
        error: string;
      };
      busy: {
        title: string;
        legendBooked: string;
        /** Legend for a day the vendor blocked only for certain hours. */
        legendPartial: string;
        empty: string;
        prevMonth: string;
        nextMonth: string;
      };
      about: {
        title: string;
        empty: string;
      };
      videos: {
        title: string;
        /** Receives `{name}` supplier name and `{n}` 1-based index. */
        playAria: string;
      };
      packages: {
        title: string;
        download: string;
        /** Badge on the recommended (anchor) package tier. */
        recommended: string;
        /** Placeholder when a package has no price, specs or PDF. */
        detailsOnRequest: string;
        /** Per-card toggle to reveal specs beyond the default few. */
        seeFullDetails: string;
        showLess: string;
      };
    };
    /** Review tag labels shared between the composer (admin selects up to 5)
     *  and the card-rendered top-tag chips. */
    reviewTags: {
      parking: string;
      accessible: string;
      english_speaking: string;
      flexible: string;
      value: string;
      responsive: string;
      punctual: string;
      pet_friendly: string;
      kid_friendly: string;
      outdoor_space: string;
      vegan_options: string;
      kosher: string;
      halal: string;
      professional: string;
      friendly: string;
      reliable: string;
      experienced: string;
      attentive: string;
      creative: string;
    };
  };
  admin: {
    nav_label: string;
    /** ProfileMenu toggle that flips the shell between user-facing and
     *  admin-only chrome. */
    enter_admin_view: string;
    exit_admin_view: string;
    /** Sidebar sub-labels for the admin pages. */
    nav_suppliers: string;
    nav_users: string;
    nav_vendors: string;
    nav_vendor_campaign: string;
    nav_vendor_review_campaign: string;
    nav_personal_invite: string;
    nav_onboarding_campaign: string;
    pinvite_title: string;
    pinvite_subtitle: string;
    pinvite_import_heading: string;
    pinvite_import_hint: string;
    pinvite_import_placeholder: string;
    pinvite_import_cta: string;
    /** Label for the "upload a .csv file" picker on the contact import. */
    pinvite_import_file_cta: string;
    /** Client-side CSV preview: category words + Clean action + result toast. */
    pinvite_valid: string;
    pinvite_duplicate: string;
    pinvite_invalid: string;
    pinvite_suspicious: string;
    pinvite_clean_cta: string;
    /** Toast after cleaning; receives {n} removed rows. */
    pinvite_clean_done: string;
    pinvite_import_result: string;
    /** Funnel counters on the selected campaign's panel. */
    pinvite_stat_total: string;
    pinvite_stat_queued: string;
    pinvite_stat_registered: string;
    pinvite_stat_lang: string;
    pinvite_start_confirm_body: string;
    /** Imported-contact table: heading, hint, empty state, overflow counter and
     *  the one row status the shared campaign_send_* keys don't cover. */
    pinvite_contacts: string;
    pinvite_contacts_hint: string;
    pinvite_contacts_empty: string;
    pinvite_contacts_more: string;
    pinvite_send_skipped: string;
    /** Merged sidebar entry that hosts both campaign consoles as tabs. */
    nav_campaigns: string;
    nav_planners: string;
    nav_waitlist: string;
    nav_planner_waitlist: string;
    nav_taxonomy: string;
    nav_financial_planner: string;
    nav_email_preview: string;
    nav_email_list: string;
    /** Vendor management (/app/admin/vendors). */
    vendors: {
      subtitle: string;
      /** Admin "register a new vendor" dialog. */
      register_cta: string;
      register_title: string;
      register_intro: string;
      register_business: string;
      register_email: string;
      register_category: string;
      register_submit: string;
      register_success: string;
      register_email_taken: string;
      filter_all: string;
      filter_active: string;
      filter_founding: string;
      filter_paying: string;
      filter_trial: string;
      filter_free: string;
      filter_incomplete: string;
      /** "Gone quiet": activated vendors nobody has signed into for 21 days,
       *  never-signed-in included. */
      filter_dormant: string;
      filter_pending: string;
      filter_suspended: string;
      search_placeholder: string;
      empty: string;
      empty_filtered: string;
      status_active: string;
      status_suspended: string;
      status_pending: string;
      token_expired: string;
      listing_count: string;
      incomplete: string;
      incomplete_tooltip: string;
      missing_cover: string;
      missing_gallery: string;
      missing_description: string;
      missing_contact: string;
      missing_pricing: string;
      missing_capacity: string;
      missing_packages: string;
      reminders_sent: string;
      reminders_last: string;
      reach_label: string;
      reach_tooltip: string;
      /** Row meta: when the account was created, when its owner was last seen,
       *  and (in the incomplete pill's tooltip) when the listing was last
       *  edited. `last_active_*` under `admin.` renders the relative value. */
      joined_tooltip: string;
      last_active_tooltip: string;
      never_signed_in: string;
      never_signed_in_tooltip: string;
      listing_edited: string;
      /** Demand + reputation, both hidden at zero on the row itself. */
      inquiries_tooltip: string;
      reviews_tooltip: string;
      remind: string;
      remind_success: string;
      /** "Move to the planner side" — the repair for a wedding planner who came
       *  in through a vendor door. The confirm spells out what survives and what
       *  the vendor-account delete takes with it. */
      to_planner: string;
      to_planner_confirm_title: string;
      /** Receives `{name}` — the vendor's display name. */
      to_planner_confirm_body: string;
      to_planner_keeps: string;
      to_planner_releases: string;
      to_planner_deletes: string;
      to_planner_success: string;
      subscription: string;
      plan: string;
      plan_free: string;
      plan_pro: string;
      founding: string;
      founding_tooltip: string;
      founding_until_tooltip: string;
      pay_label: string;
      pay_paying: string;
      pay_paying_tooltip: string;
      pay_past_due: string;
      pay_past_due_tooltip: string;
      pay_trial: string;
      pay_trial_tooltip: string;
      pay_leads: string;
      pay_leads_tooltip: string;
      pay_scheduled: string;
      pay_scheduled_tooltip: string;
      pay_free: string;
      pay_free_tooltip: string;
      pay_none: string;
      resend: string;
      edit: string;
      edit_category: string;
      suspend: string;
      reactivate: string;
      delete: string;
      name_required: string;
      category_required: string;
      edit_title: string;
      field_name: string;
      field_name_help: string;
      field_category: string;
      field_company: string;
      field_company_help: string;
      field_email: string;
      field_phone: string;
      field_vat: string;
      suspend_confirm_title: string;
      reactivate_confirm_title: string;
      suspend_success: string;
      reactivate_success: string;
      resend_success: string;
      delete_confirm_phrase: string;
      delete_confirm_title: string;
      delete_confirm_label: string;
      delete_confirm_help: string;
      delete_confirm_mismatch: string;
      delete_success: string;
    };
    /** Planner management (/app/admin/planners). */
    planners: {
      subtitle: string;
      filter_all: string;
      filter_active: string;
      filter_pending: string;
      filter_suspended: string;
      empty: string;
      status_active: string;
      status_suspended: string;
      status_pending_activation: string;
      /** Pill for an accepted waitlist applicant with no account yet. */
      status_applied: string;
      /** Button on a pending applicant card: (re)send the access email. */
      send_invite: string;
      /** Button on a pending applicant card: approve + open their planner
       *  account (provision or convert). */
      approve_open: string;
      /** Toast: access email sent to a not-yet-registered applicant. */
      invite_sent_success: string;
      /** Toast: provisioned a fresh planner and emailed the activation link
       *  into a pre-filled onboarding. */
      invite_activation_sent: string;
      /** Toast: applicant already had an account, so we granted planner and
       *  emailed a sign-in link. */
      invite_granted_success: string;
      clients: string;
      onboarding_pending: string;
      free_until: string;
      /** Couple-facing directory reach shown on the admin card. */
      reach_label: string;
      reach_tooltip: string;
      /** Collapsible profile section (company, location, styles, …). */
      details_toggle: string;
      field_company: string;
      field_location: string;
      field_weddings: string;
      field_styles: string;
      field_web: string;
      field_references: string;
      early_tester: string;
      provision_cta: string;
      provision_title: string;
      provision_intro: string;
      provision_email: string;
      provision_name: string;
      provision_business: string;
      provision_category: string;
      provision_category_placeholder: string;
      provision_submit: string;
      provision_success: string;
      provision_email_taken: string;
      /** "A user suggested these planners" batch invite: paste a list, preview
       *  what was parsed, then provision + mail every row. */
      invite_batch_cta: string;
      invite_batch_title: string;
      invite_batch_intro: string;
      invite_batch_placeholder: string;
      invite_batch_locale: string;
      invite_batch_locale_auto: string;
      invite_batch_preview: string;
      invite_batch_send: string;
      invite_batch_parsed: string;
      invite_batch_empty: string;
      invite_batch_col_name: string;
      invite_batch_col_email: string;
      invite_batch_col_phone: string;
      invite_batch_col_status: string;
      invite_batch_status_ready: string;
      invite_batch_status_sent: string;
      invite_batch_status_existing: string;
      invite_batch_status_opted_out: string;
      invite_batch_status_failed: string;
      invite_batch_done: string;
      resend_activation: string;
      resend_success: string;
      plan: string;
      plan_starter: string;
      plan_pro: string;
      plan_premium: string;
      plan_change_hint: string;
      suspend: string;
      reactivate: string;
      delete: string;
      /** Couple-facing "verified" trust badge (users.planner_verified). */
      verified: string;
      verify: string;
      unverify: string;
      remind: string;
      remind_success: string;
      verify_success: string;
      unverify_success: string;
      suspend_confirm_title: string;
      reactivate_confirm_title: string;
      suspend_success: string;
      reactivate_success: string;
      plan_success: string;
      delete_confirm_phrase: string;
      delete_confirm_title: string;
      delete_confirm_label: string;
      delete_confirm_help: string;
      delete_confirm_mismatch: string;
      delete_success: string;
    };
    tab_suppliers: string;
    tab_users: string;
    tab_feedback: string;
    tab_analytics: string;
    /** Financial planner (/app/admin/financial-planner). */
    fin_title: string;
    fin_subtitle: string;
    fin_enforce_title: string;
    fin_enforce_state_on: string;
    fin_enforce_state_off: string;
    fin_enforce_note_on: string;
    fin_enforce_note_off: string;
    fin_enforce_turn_off: string;
    fin_enforce_go_live: string;
    fin_enforce_not_ready: string;
    fin_enforce_below_cap: string;
    fin_enforce_impact: string;
    fin_enforce_progress_label: string;
    fin_enforce_ready_signal: string;
    fin_enforce_confirm_on_title: string;
    fin_enforce_confirm_on_body: string;
    fin_enforce_confirm_off_title: string;
    fin_enforce_confirm_off_body: string;
    fin_enforce_on_success: string;
    fin_enforce_off_success: string;
    fin_monthly_breakdown: string;
    fin_kpi_mrr: string;
    fin_kpi_mrr_hint: string;
    fin_kpi_arr: string;
    fin_kpi_arr_hint: string;
    fin_kpi_paying: string;
    fin_kpi_founding_left: string;
    fin_kpi_trialing: string;
    fin_kpi_checkout_started: string;
    fin_kpi_checkout_started_hint: string;
    fin_cohorts_title: string;
    fin_mrr_by_currency_title: string;
    fin_assumptions_title: string;
    fin_assumptions_hint: string;
    fin_new_couples: string;
    fin_trial_conv: string;
    fin_avg_cycle: string;
    fin_churn: string;
    fin_horizon: string;
    fin_horizon_months: string;
    fin_projection_title: string;
    fin_col_month: string;
    fin_col_subs: string;
    fin_col_mrr: string;
    fin_projected_mrr: string;
    fin_projected_arr: string;
    fin_subscribers_suffix: string;
    /** Admin blog CRUD page (/app/admin/blog). */
    nav_blog: string;
    /** Read-only analytics dashboard — money, activity, picks rollups. */
    nav_analytics: string;
    /** Admin rail group subheads. Inbox = badge-bearing moderation
     *  queues; Manage = CRM + config; Insights = read-only analytics. */
    nav_group_inbox: string;
    nav_group_accounts: string;
    nav_group_manage: string;
    nav_group_insights: string;
    /** /app/admin/categories page — supplier groups + categories CRUD. */
    taxonomy_title: string;
    taxonomy_sub: string;
    taxonomy_empty: string;
    /** Empty-state headline shown above the longer `taxonomy_empty`
     *  description when no groups exist yet. The empty-state surface on
     *  this page uses the canonical icon + title + description + CTA
     *  shape, so the existing one-liner becomes the description and this
     *  new key acts as the louder headline. */
    taxonomy_empty_title: string;
    /** Inline filler for a group with zero categories — the page used to
     *  render an italic em-dash, which clashed with the rest of the
     *  admin shell's typography. */
    taxonomy_group_empty: string;
    /** Pill copy on each group header — "{n} kategória" / "{n} categories".
     *  Hungarian doesn't inflect the noun after a numeral, so a single
     *  template covers every count; English uses `_one`/`_other` via the
     *  pickCount fallback in lib/i18n. */
    taxonomy_category_count: string;
    taxonomy_category_count_one: string;
    taxonomy_category_count_other: string;
    taxonomy_add_group: string;
    taxonomy_add_category: string;
    taxonomy_group_slug: string;
    taxonomy_group_label_hu: string;
    taxonomy_group_label_en: string;
    taxonomy_category_slug: string;
    taxonomy_category_label_hu: string;
    taxonomy_category_label_en: string;
    taxonomy_category_budget: string;
    taxonomy_category_budget_help: string;
    taxonomy_save: string;
    taxonomy_saving: string;
    taxonomy_cancel: string;
    taxonomy_edit: string;
    taxonomy_delete: string;
    /** Soft-hide companion to delete — hides the group/category from the
     *  public taxonomy without dropping the row. Admin keeps seeing them
     *  with a "Hidden" badge + unhide button. */
    taxonomy_hide: string;
    taxonomy_unhide: string;
    taxonomy_hidden_badge: string;
    taxonomy_hide_success: string;
    taxonomy_unhide_success: string;
    taxonomy_delete_group_confirm_title: string;
    taxonomy_delete_group_confirm_body: string;
    taxonomy_delete_group_blocked: string;
    taxonomy_delete_category_confirm_title: string;
    taxonomy_delete_category_confirm_body: string;
    taxonomy_delete_category_blocked: string;
    taxonomy_slug_help: string;
    taxonomy_new_group_title: string;
    taxonomy_new_category_title: string;
    taxonomy_edit_group_title: string;
    taxonomy_edit_category_title: string;
    /** /app/admin/vendor-waitlist page — triage of /vendors submissions.
     *  Three-outcome flow: every entry lands in `new` (the "Beérkezett"
     *  inbox), one of three outcomes moves it out (accepted / under_review /
     *  rejected) by sending a template email the admin can edit first. */
    waitlist_title: string;
    waitlist_sub: string;
    waitlist_filter_new: string;
    waitlist_filter_under_review: string;
    waitlist_filter_accepted: string;
    waitlist_filter_rejected: string;
    waitlist_filter_category_label: string;
    waitlist_filter_category_all: string;
    waitlist_empty_new: string;
    waitlist_empty_under_review: string;
    waitlist_empty_accepted: string;
    waitlist_empty_rejected: string;
    waitlist_status_new: string;
    waitlist_status_under_review: string;
    waitlist_status_accepted: string;
    waitlist_status_rejected: string;
    waitlist_card_submitted: string;
    waitlist_card_decided: string;
    waitlist_card_price_list_label: string;
    waitlist_card_message_label: string;
    waitlist_card_notes_label: string;
    waitlist_card_verification_label: string;
    waitlist_card_tax_label: string;
    waitlist_card_reg_label: string;
    /** "More" summary label on the collapsed-by-default detail section
     *  of the compressed vendor-waitlist card. */
    waitlist_card_more_label: string;
    waitlist_card_sent_label: string;
    waitlist_card_portfolio_label: string;
    waitlist_card_portfolio_other_label: string;
    waitlist_card_instagram_label: string;
    waitlist_card_channel_row_label: string;
    waitlist_card_channel_website: string;
    waitlist_card_channel_instagram: string;
    waitlist_card_channel_youtube: string;
    waitlist_card_channel_facebook: string;
    waitlist_card_channel_visit: string;
    waitlist_card_channel_none: string;
    waitlist_action_respond: string;
    waitlist_action_review: string;
    waitlist_action_reopen: string;
    waitlist_modal_title: string;
    waitlist_modal_outcome_label: string;
    waitlist_modal_outcome_accepted: string;
    waitlist_modal_outcome_under_review: string;
    waitlist_modal_outcome_rejected: string;
    waitlist_modal_accept_invite_note: string;
    waitlist_modal_subject_label: string;
    waitlist_modal_body_label: string;
    waitlist_modal_notes_label: string;
    waitlist_modal_notes_helper: string;
    waitlist_modal_send: string;
    waitlist_modal_sending: string;
    waitlist_modal_cancel: string;
    waitlist_modal_overwrite_confirm_title: string;
    waitlist_modal_overwrite_confirm_body: string;
    waitlist_modal_overwrite_confirm_ok: string;
    /** Confirm dialog gating the destructive "reopen a decided
     *  application" action. Title is the question, body explains what
     *  the previous decision was (interpolated `{outcome}` + `{decided}`)
     *  so the admin knows what they're erasing. */
    waitlist_reopen_confirm_title: string;
    waitlist_reopen_confirm_body: string;
    waitlist_reopen_confirm_ok: string;
    /** Screen-reader-only label for status pills on the card header.
     *  The visible label is the localized status name; this prefix gives
     *  AT users a "status:" cue so it doesn't read as just a noun. */
    waitlist_status_sr_label: string;
    waitlist_toast_decided: string;
    waitlist_toast_reopened: string;
    /** /app/admin/users page — read-only directory of users + couples. */
    users_title: string;
    users_sub: string;
    /** Sticky search bar above the workspaces list. Debounced client-side
     *  filter — matches name / email / workspace id / slug / partner names
     *  across the workspaces, demo, and orphans sub-lists. */
    users_search_placeholder: string;
    users_search_clear: string;
    users_search_empty: string;
    users_search_empty_help: string;
    /** Toggle copy for the collapsed demo workspaces summary. The summary
     *  line surfaces "{n} demo munkaterületek · utolsó 24h: {m}" with a
     *  Megjelenítés / Elrejtés button on the right. */
    demo_workspaces_show: string;
    demo_workspaces_hide: string;
    demo_workspaces_summary_one: string;
    demo_workspaces_summary_other: string;
    demo_workspaces_recent_24h: string;
    /** Beta-tester bucket — admin-marked accounts (the team's own test
     *  accounts) pulled into their own collapsible group so the real-signup
     *  metrics stay clean. Non-destructive label, separate from the
     *  moderation flag. The toggle mirrors the demo summary's show/hide. */
    badge_beta: string;
    beta_set_button: string;
    beta_unset_button: string;
    beta_set_success: string;
    beta_unset_success: string;
    stat_couples: string;
    stat_solo: string;
    stat_flagged: string;
    stat_beta: string;
    stat_demo: string;
    stat_orphans: string;
    flagged_section: string;
    flagged_count_one: string;
    flagged_count_other: string;
    beta_workspaces_section: string;
    beta_workspaces_help: string;
    beta_workspaces_summary_one: string;
    beta_workspaces_summary_other: string;
    beta_workspaces_show: string;
    beta_workspaces_hide: string;
    users_section_users: string;
    users_section_couples: string;
    users_count_one: string;
    users_count_other: string;
    couples_count_one: string;
    couples_count_other: string;
    users_empty: string;
    couples_empty: string;
    table_name: string;
    table_email: string;
    table_role: string;
    table_couple: string;
    table_couple_none: string;
    table_couple_partners: string;
    /** Inline partner column (replaces the separate Couples table). */
    table_partner: string;
    table_partner_none: string;
    table_partner_orphan: string;
    table_admin_actions: string;
    /** "Not yet seen" bucket at the very top of the admin users page: every
     *  real signup (couple workspace or orphan user) created since the admin
     *  last opened this page. Category-free flat list, newest first. */
    new_section: string;
    new_section_help: string;
    new_count_one: string;
    new_count_other: string;
    /** New v1.2 layout: one row per workspace (couple), with both partners
     *  collapsed inside it. */
    workspaces_section: string;
    workspaces_count_one: string;
    workspaces_count_other: string;
    /** Solo-workspace bucket (one member, partner never joined) on the admin
     *  users page — split out from the paired-couple list. */
    solo_section: string;
    solo_help: string;
    solo_count_one: string;
    solo_count_other: string;
    solo_empty: string;
    married_section: string;
    married_count_one: string;
    married_count_other: string;
    married_empty: string;
    /** "×N" pill + tooltip on a banded owner card (one owner, several event
     *  workspaces), and the fallback owner label when the owner can't resolve. */
    owner_workspaces_pill: string;
    owner_workspaces_title: string;
    owner_band_generic: string;
    /** "Also:" label preceding the chips of an owner's additional events. */
    also_events: string;
    /** Collapse/expand toggle labels shared by the admin users-page lists. */
    section_show: string;
    section_hide: string;
    /** Demo workspaces are landing-page Shrek & Fiona seedlings — kept in
     *  their own section so the real-couple list stays scannable. */
    demo_workspaces_section: string;
    /** Umbrella "Demo accounts" section covering all three demo kinds:
     *  demo couples + demo vendors + demo planners, each in its own labelled
     *  sub-list so they stay distinct. */
    demo_section: string;
    demo_summary_one: string;
    demo_summary_other: string;
    demo_couples_subhead: string;
    demo_vendors_subhead: string;
    demo_planners_subhead: string;
    demo_workspaces_count_one: string;
    demo_workspaces_count_other: string;
    demo_workspaces_help: string;
    demo_badge: string;
    /** Per-demo event count line on the admin demo list, e.g. "12 esemény". */
    demo_events_label_one: string;
    demo_events_label_other: string;
    /** Shown on the demo row when the visitor never touched anything past
     *  the seeded `demo.start` row — i.e. opened the trial then bounced. */
    demo_events_none: string;
    /** "+3 további" suffix after the visible feature chips on a demo that
     *  exercised more features than fit on one line. */
    demo_feature_more: string;
    orphans_section: string;
    orphans_count_one: string;
    orphans_count_other: string;
    orphans_empty: string;
    table_workspace_id: string;
    table_workspace_name: string;
    table_workspace_members: string;
    table_workspace_wedding_date: string;
    /** Creation date column on the workspaces list (e.g. "2026. máj. 12."). */
    table_workspace_created: string;
    /** Most recent activity column — coarse "X minutes/hours/days ago" via
     *  the relative formatter (admin.last_active_*). Server stamps the value
     *  on every successful token verify, throttled to 5min per user. */
    table_workspace_last_active: string;
    last_active_never: string;
    last_active_now: string;
    last_active_minutes: string;
    last_active_hours: string;
    last_active_days: string;
    workspace_solo_member: string;
    /** Admin-triggered nudge on solo workspaces: small Mail icon button next
     *  to the "Solo member" badge that emails the lone partner a reminder
     *  to invite their other half. */
    remind_invite_partner_tooltip: string;
    remind_invite_partner_aria: string;
    remind_invite_partner_confirm_title: string;
    remind_invite_partner_confirm_body: string;
    remind_invite_partner_confirm: string;
    remind_invite_partner_success: string;
    remind_invite_partner_sent_label: string;
    workspace_status_paused: string;
    /** Why a workspace is paused: the exit-dialog reason, plus the countdown
     *  to the purge, rendered under the workspace name. */
    pause_reason_none: string;
    pause_purges_in: string;
    /** Turning a churn CATEGORY into an answer: the admin asks the partner who
     *  paused what was actually missing. One shot per pause request, after
     *  which the control becomes the date it was asked. */
    ask_pause_feedback: string;
    ask_pause_feedback_sent: string;
    ask_pause_feedback_sent_at: string;
    ask_pause_feedback_confirm_title: string;
    ask_pause_feedback_confirm_body: string;
    ask_pause_feedback_confirm: string;
    ask_pause_feedback_success: string;
    /** Billing badges + free-badge grant/revoke on the admin couples list. */
    billing_free: string;
    billing_until_wedding: string;
    first200_early_bird: string;
    billing_trial: string;
    billing_paying: string;
    billing_not_subscribed: string;
    billing_lapsed: string;
    grant_free: string;
    revoke_free: string;
    grant_free_confirm_title: string;
    grant_free_confirm_body: string;
    revoke_free_confirm_title: string;
    revoke_free_confirm_body: string;
    grant_free_success: string;
    revoke_free_success: string;
    workspace_status_deleting: string;
    badge_admin: string;
    badge_suspended: string;
    badge_unverified: string;
    badge_vendor: string;
    badge_planner: string;
    /** Moderation flag — admin manually flags an account with a reason, the
     *  user is emailed and gets 7 days to reply, and the hourly sweep
     *  auto-purges past the deadline unless the admin clears the flag. */
    flag_badge_days_left: string;
    /** Compact activity chips shown next to each user row — tip count,
     *  feedback count, prior-flag count. Tooltip variants include the
     *  "X ago" relative timestamp. */
    activity_supplier_tips: string;
    activity_supplier_tips_tooltip: string;
    activity_feedback: string;
    activity_feedback_tooltip: string;
    activity_prior_flags_tooltip: string;
    convert_vendor_button: string;
    convert_vendor_title: string;
    convert_vendor_help: string;
    convert_vendor_business_name: string;
    convert_vendor_category: string;
    convert_vendor_confirm: string;
    convert_vendor_pending: string;
    convert_vendor_success: string;
    flag_user_button: string;
    flag_user_title: string;
    flag_user_label: string;
    flag_user_placeholder: string;
    flag_user_help: string;
    flag_user_send: string;
    flag_user_sending: string;
    flag_user_too_short: string;
    flag_user_success: string;
    flag_cannot_self: string;
    /** Template chips above the textarea in FlagUserDialog. Picking one
     *  drops `flag_tpl_<key>_body` into the editable textarea; the admin
     *  can still tweak the wording before sending. */
    flag_user_templates_help: string;
    flag_tpl_spam_label: string;
    flag_tpl_spam_body: string;
    flag_tpl_fake_label: string;
    flag_tpl_fake_body: string;
    flag_tpl_duplicate_label: string;
    flag_tpl_duplicate_body: string;
    flag_tpl_vendor_abuse_label: string;
    flag_tpl_vendor_abuse_body: string;
    flag_tpl_offensive_label: string;
    flag_tpl_offensive_body: string;
    flag_tpl_reported_label: string;
    flag_tpl_reported_body: string;
    resend_flag_email_button: string;
    resend_flag_email_success: string;
    email_log_button: string;
    email_log_panel_title: string;
    email_log_empty: string;
    unflag_user_button: string;
    unflag_user_title: string;
    unflag_user_label: string;
    unflag_user_placeholder: string;
    unflag_user_help: string;
    unflag_user_clear: string;
    unflag_user_success: string;
    /** Per-row admin actions for users. */
    resend_verify: string;
    resend_verify_sent: string;
    /** Inline pill label that replaces the "Resend verify" button after a
     *  successful send in this session — confirms the action without taking
     *  the admin to a toast-only signal that fades away. */
    resend_verify_sent_label: string;
    resend_verify_already: string;
    delete_user: string;
    delete_user_confirm_title: string;
    delete_user_confirm_label: string;
    delete_user_confirm_placeholder: string;
    delete_user_confirm_phrase: string;
    delete_user_confirm_help: string;
    delete_user_confirm_mismatch: string;
    delete_user_success: string;
    delete_user_cannot_self: string;
    suppliers_title: string;
    suppliers_sub: string;
    empty: string;
    empty_filtered: string;
    table_supplier: string;
    table_category: string;
    table_submitter: string;
    table_submitted_at: string;
    table_status: string;
    table_actions: string;
    status_active: string;
    status_hidden: string;
    /** Submitted, email-ownership not yet verified. */
    status_pending: string;
    /** Email verified but admin hasn't approved yet — sits invisible until
     *  an admin clicks "Approve". */
    status_awaiting_review: string;
    /** Status filter chips. */
    filter_status_label: string;
    filter_status_all: string;
    filter_status_pending: string;
    filter_status_awaiting_review: string;
    filter_status_active: string;
    filter_status_hidden: string;
    /** Per-row admin actions for community suppliers. */
    approve: string;
    approve_success: string;
    approve_direct_hint: string;
    send_verify: string;
    send_verify_hint: string;
    send_verify_success: string;
    enrich: string;
    enrich_hint: string;
    enrich_running: string;
    enrich_filled: string;
    enrich_none: string;
    /** Bulk-action toolbar. */
    bulk_selected: string;
    bulk_clear: string;
    bulk_hide: string;
    bulk_delete: string;
    bulk_hide_confirm_title: string;
    bulk_hide_confirm_body: string;
    bulk_delete_confirm_title: string;
    bulk_delete_confirm_body: string;
    select_row_aria: string;
    select_all_aria: string;
    hide: string;
    unhide: string;
    delete: string;
    hide_reason_label: string;
    hide_reason_optional: string;
    hide_reason_placeholder: string;
    hide_reason_help: string;
    confirm_hide_title: string;
    confirm_hide_body: string;
    confirm_delete_title: string;
    confirm_delete_body: string;
    /** CRM-style admin card fields. */
    suppliers_card_expand: string;
    suppliers_card_collapse: string;
    suppliers_card_section_contact: string;
    suppliers_card_section_location: string;
    suppliers_card_section_listing: string;
    suppliers_card_section_meta: string;
    suppliers_card_section_metrics: string;
    suppliers_card_section_notes: string;
    suppliers_card_field_website: string;
    suppliers_card_field_contact_email: string;
    suppliers_card_field_contact_phone: string;
    suppliers_card_field_address: string;
    suppliers_card_field_city: string;
    suppliers_card_field_category: string;
    suppliers_card_field_price_band: string;
    suppliers_card_field_blurb: string;
    suppliers_card_field_submitter: string;
    suppliers_card_field_submitter_id: string;
    /** Marks a submitter who has no Weddly account: a verified visitor. Their
     *  email is the real one; the row's account is the system sentinel. */
    suppliers_card_submitter_visitor: string;
    /** Stands in for the numeric submitter id on a visitor row, where the id
     *  belongs to the shared system user rather than to a person. */
    suppliers_card_submitter_no_account: string;
    suppliers_card_field_submitted_at: string;
    suppliers_card_field_updated_at: string;
    suppliers_card_field_hidden_at: string;
    suppliers_card_field_hide_reason: string;
    suppliers_card_field_open_reports: string;
    suppliers_card_dup_warning: string;
    suppliers_card_dup_warning_aria: string;
    suppliers_card_dup_detail: string;
    suppliers_card_incomplete: string;
    suppliers_card_incomplete_aria: string;
    suppliers_card_incomplete_detail: string;
    suppliers_card_field_id: string;
    suppliers_card_field_admin_notes: string;
    suppliers_card_field_admin_notes_placeholder: string;
    suppliers_card_field_admin_notes_help: string;
    suppliers_card_field_notes_save: string;
    suppliers_card_field_notes_saving: string;
    suppliers_card_field_notes_saved: string;
    suppliers_card_field_notes_dirty: string;
    suppliers_card_notes_save_success: string;
    suppliers_card_empty_value: string;
    /** Admin edit form on the moderation card — the only place a researched
     *  listing's own data can be typed (the couple's submission form asks for
     *  nine fields and never for a coordinate or a capacity). */
    suppliers_edit: string;
    suppliers_edit_cancel: string;
    suppliers_edit_save: string;
    suppliers_edit_saving: string;
    suppliers_edit_success: string;
    suppliers_edit_no_changes: string;
    suppliers_edit_section_place: string;
    suppliers_edit_field_lat: string;
    suppliers_edit_field_lng: string;
    suppliers_edit_coords_help: string;
    suppliers_card_field_capacity: string;
    suppliers_edit_field_capacity_min: string;
    suppliers_edit_field_capacity_max: string;
    suppliers_edit_field_venue_style: string;
    suppliers_edit_field_venue_style_none: string;
    suppliers_edit_field_languages: string;
    suppliers_edit_field_price_band_none: string;
    suppliers_edit_city_help: string;
    /** Photo manager: attach a card image by URL (the server re-hosts it). */
    suppliers_photos_section: string;
    suppliers_photos_empty: string;
    suppliers_photos_hero: string;
    suppliers_photos_gallery: string;
    suppliers_photos_add_placeholder: string;
    suppliers_photos_add: string;
    suppliers_photos_adding: string;
    suppliers_photos_add_help: string;
    suppliers_photos_added: string;
    suppliers_photos_removed: string;
    suppliers_photos_remove_aria: string;
    suppliers_photos_make_hero: string;
    /** Visible "delete" action verb (imperative). Used on the destructive
     *  btn-alert buttons (per-row + bulk) on the supplier moderation page.
     *  Distinct from `delete` (noun) which doubles as a confirm-dialog
     *  label. */
    delete_action: string;
    bulk_delete_action: string;
    /** SR labels for the source pill on supplier cards (curated vs
     *  community). The moderation list is always community but the pill
     *  is rendered explicitly so the moderator never has to assume. */
    source_curated_sr: string;
    source_community_sr: string;
    /** Aria-label for the price-band pill ("$$$ ársáv / price band"). */
    price_band_aria: string;
    /** /app/admin/suppliers — directory view toggle (moderation vs analytics). */
    suppliers_view_moderation: string;
    suppliers_view_directory: string;
    /** Directory view: full curated + community list with visit analytics. */
    directory_title: string;
    directory_sub: string;
    directory_loading: string;
    directory_empty: string;
    directory_export_csv: string;
    directory_export_started: string;
    directory_export_failed: string;
    directory_total_count: string;
    directory_reset_filters: string;
    /** Filters. */
    directory_filter_source_label: string;
    directory_filter_source_all: string;
    directory_filter_source_curated: string;
    directory_filter_source_community: string;
    /** Contact-coverage filter + the inline flag on a listing with no email:
     *  the claim-invite campaign mails contact_email, so those rows can only be
     *  chased by hand. */
    /** LEGACY contact-select copy. The select is gone (the gaps below replaced
     *  it); the keys stay because the CSV column header and older screenshots
     *  still use this wording. */
    directory_filter_contact_label: string;
    directory_filter_contact_all: string;
    directory_filter_contact_no_email: string;
    /** One per DIRECTORY_GAP, keyed `directory_gap_<gap>`: what the listing is
     *  MISSING, phrased as the hole and never as a metric ("No email", not
     *  "Email coverage"), because the chip is a filter, not a report. */
    directory_gap_no_email: string;
    directory_gap_no_phone: string;
    directory_gap_no_website: string;
    directory_gap_no_hero: string;
    directory_gap_flagged_email: string;
    /** Badge on a row whose address is held back, and the two reasons, keyed
     *  `directory_email_flag_<ContactEmailFlag>`. */
    directory_email_flag: string;
    directory_email_flag_generic: string;
    directory_email_flag_unverified: string;
    /** Overflow chip holding the rarely-set dimensions. */
    directory_filter_more: string;
    /** The word after the headline count when nothing is filtering. */
    directory_total_count_word: string;
    /** Replaces it when something is: receives `{total}`, the unfiltered size. */
    directory_count_of: string;
    directory_no_email: string;
    directory_no_email_tooltip: string;
    directory_filter_status_label: string;
    directory_filter_category_label: string;
    directory_filter_category_all: string;
    directory_filter_city_label: string;
    directory_filter_city_placeholder: string;
    directory_filter_search_label: string;
    directory_filter_search_placeholder: string;
    directory_filter_min_views_label: string;
    directory_filter_from_label: string;
    directory_filter_to_label: string;
    /** Table column headers. */
    directory_col_name: string;
    directory_col_source: string;
    directory_col_status: string;
    directory_col_category: string;
    directory_col_city: string;
    directory_col_hero: string;
    /** Hero re-fetch button + result toasts. */
    directory_refetch_hero: string;
    directory_refetch_hero_done: string;
    directory_refetch_hero_none: string;
    directory_refetch_hero_failed: string;
    directory_col_views_total: string;
    directory_col_views_30d: string;
    directory_col_views_7d: string;
    directory_col_clicks_total: string;
    directory_col_clicks_30d: string;
    directory_col_phone_clicks: string;
    directory_col_last_event: string;
    directory_col_created: string;
    /** Source-of-truth pills. */
    directory_source_curated: string;
    directory_source_community: string;
    directory_last_event_never: string;
    /** Catalog moderation: submitter provenance, last-active + row actions. */
    directory_col_submitter_seen: string;
    directory_col_actions: string;
    directory_submitter_admin: string;
    directory_submitter_self: string;
    directory_submitter_user: string;
    directory_submitter_visitor: string;
    directory_delete_entry: string;
    directory_delete_confirm_body: string;
    directory_delete_account: string;
    directory_purge_submitter_title: string;
    directory_purge_submitter_body: string;
    directory_purge_submitter_confirm: string;
    directory_purge_submitter_done: string;
    /** /app/admin/feedback page — triage of Visszajelzés submissions. */
    nav_feedback: string;
    /** /app/admin/reviews page — moderation queue of flagged reviews. */
    nav_reviews: string;
    /** Flagged-review moderation queue. */
    reviews: {
      title: string;
      description: string;
      empty: string;
      loadError: string;
      unflag: string;
      unflagged: string;
      deleted: string;
      deleteConfirmTitle: string;
      deleteConfirmBody: string;
    };
    /** /app/admin/couple-cards page — triage of 100-questions card ratings. */
    nav_couple_cards: string;
    feedback_title: string;
    feedback_sub: string;
    feedback_empty: string;
    feedback_col_submitter: string;
    feedback_col_message: string;
    feedback_col_rating: string;
    feedback_col_monthly: string;
    feedback_col_source: string;
    feedback_col_submitted: string;
    feedback_col_status: string;
    feedback_col_actions: string;
    feedback_source_landing: string;
    feedback_source_app: string;
    feedback_status_new: string;
    feedback_status_read: string;
    feedback_status_resolved: string;
    feedback_status_dismissed: string;
    feedback_mark_read: string;
    feedback_mark_resolved: string;
    feedback_dismiss: string;
    feedback_reopen: string;
    feedback_delete: string;
    feedback_delete_confirm_title: string;
    feedback_delete_confirm_body: string;
    feedback_anon: string;
    feedback_no_message: string;
    feedback_filter_new: string;
    feedback_filter_read: string;
    feedback_filter_resolved: string;
    feedback_filter_dismissed: string;
    feedback_empty_title: string;
    feedback_empty_body: string;
    feedback_load_error_title: string;
    feedback_load_error_body: string;
    feedback_retry: string;
    /** Triage workflow (see shared/feedback.ts). Status lifecycle, priority,
     *  product area, internal notes, and the captured technical context. */
    feedback_status_reviewed: string;
    feedback_status_planned: string;
    feedback_status_fixed: string;
    feedback_status_rejected: string;
    feedback_status_archived: string;
    feedback_filter_reviewed: string;
    feedback_filter_planned: string;
    feedback_filter_fixed: string;
    feedback_filter_rejected: string;
    feedback_filter_archived: string;
    feedback_col_area: string;
    feedback_col_priority: string;
    feedback_mark_reviewed: string;
    feedback_mark_planned: string;
    feedback_mark_fixed: string;
    feedback_mark_rejected: string;
    feedback_mark_archived: string;
    feedback_convert_action: string;
    feedback_priority_label: string;
    feedback_priority_low: string;
    feedback_priority_medium: string;
    feedback_priority_high: string;
    feedback_priority_unset: string;
    feedback_priority_none: string;
    feedback_area_label: string;
    feedback_area_unset: string;
    feedback_notes_label: string;
    feedback_notes_placeholder: string;
    feedback_notes_save: string;
    feedback_notes_saved: string;
    feedback_tech_label: string;
    feedback_tech_device: string;
    feedback_tech_browser: string;
    feedback_tech_os: string;
    feedback_tech_locale: string;
    feedback_tech_url: string;
    feedback_tech_open_url: string;
    feedback_triage_status_label: string;
    feedback_details_show: string;
    feedback_details_hide: string;
    /** Reply-to-submitter composer in the triage panel. */
    feedback_reply_label: string;
    feedback_reply_placeholder: string;
    feedback_reply_send: string;
    feedback_reply_sent: string;
    feedback_reply_channel_email: string;
    feedback_reply_channel_notification: string;
    feedback_reply_channel_both: string;
    /** Shown instead of the composer when there is no way to reach the
     *  submitter (anonymous landing feedback with no email). */
    feedback_reply_no_recipient: string;
    /** Disabled-channel hints. */
    feedback_reply_no_email_hint: string;
    feedback_reply_no_workspace_hint: string;
    /** Sent-reply thread. */
    feedback_reply_history_label: string;
    feedback_reply_via_email: string;
    feedback_reply_via_notification: string;
    feedback_reply_via_both: string;
    /** Row pill: this entry has at least one reply. */
    feedback_replied: string;
    /** /app/admin/analytics page — three orthogonal rollups (money,
     *  activity, picks) rendered as KPI tiles + tables + CSS bar charts.
     *  Read-only — no actions, no per-row drilldown. */
    analytics_title: string;
    analytics_sub: string;
    analytics_retry: string;
    analytics_load_error: string;
    /** Sticky-header chrome shared across every section. */
    analytics_refresh: string;
    analytics_last_loaded: string;
    analytics_nav_money: string;
    analytics_nav_activity: string;
    analytics_nav_picks: string;
    analytics_nav_engagement: string;
    analytics_nav_demo: string;
    /** Audience filter (real-users-only baseline + cohort include toggles).
     *  Applies to every lens except Demo and Traffic. */
    analytics_audience_label: string;
    analytics_audience_real_only: string;
    analytics_audience_admins: string;
    analytics_audience_test: string;
    analytics_audience_demos: string;
    analytics_audience_archived: string;
    analytics_audience_deleting: string;
    analytics_nav_traffic: string;
    analytics_nav_acquisition: string;
    analytics_nav_weddings: string;
    analytics_nav_honeymoon: string;
    analytics_nav_guests: string;
    analytics_nav_planners: string;
    analytics_nav_campaigns: string;
    analytics_nav_users: string;
    /** aria-label for the mobile section dropdown that replaces the
     *  anchor pills below the `sm:` breakpoint. */
    analytics_jump_to_section: string;
    // Shared helpers for the weddings / honeymoon / guests rollups.
    analytics_stat_sub: string;
    analytics_days: string;
    analytics_season_spring: string;
    analytics_season_summer: string;
    analytics_season_autumn: string;
    analytics_season_winter: string;
    analytics_locale_unknown: string;
    // Weddings section (date seasonality, lead time, locale / style mix).
    analytics_section_weddings: string;
    analytics_weddings_total: string;
    analytics_weddings_with_date: string;
    analytics_weddings_lead_time: string;
    analytics_weddings_lead_time_trend_title: string;
    analytics_weddings_lead_time_trend_sub: string;
    analytics_weddings_cohort_n: string;
    analytics_weddings_guest_target: string;
    analytics_weddings_peak_season: string;
    analytics_weddings_by_month: string;
    analytics_weddings_by_weekday: string;
    analytics_weddings_style_tags: string;
    analytics_weddings_style_adoption: string;
    analytics_weddings_locale_mix: string;
    analytics_weddings_by_currency: string;
    analytics_weddings_by_country: string;
    analytics_weddings_by_locale: string;
    analytics_weddings_empty: string;
    analytics_weddings_tags_empty: string;
    // Honeymoon section (destinations, origins, trip length, seasonality).
    analytics_section_honeymoon: string;
    analytics_honeymoon_empty: string;
    analytics_honeymoon_insufficient: string;
    analytics_honeymoon_with_destination: string;
    analytics_honeymoon_adoption: string;
    analytics_honeymoon_top_destination: string;
    analytics_honeymoon_couples: string;
    analytics_honeymoon_trip_nights: string;
    analytics_honeymoon_with_dates: string;
    analytics_honeymoon_top_destinations: string;
    analytics_honeymoon_origins: string;
    analytics_honeymoon_origins_empty: string;
    analytics_honeymoon_start_month: string;
    // Guests section (RSVP funnel, kind, plus-one, dietary load).
    analytics_section_guests: string;
    /** Planners lens: waitlist → paying funnel, capacity, subscription health. */
    analytics_section_planners: string;
    analytics_planners_subtitle: string;
    analytics_planners_empty: string;
    analytics_planners_total: string;
    analytics_planners_active: string;
    analytics_planners_pending: string;
    analytics_planners_suspended: string;
    /** Receives `{n}` — accepted applicants with no account yet. */
    analytics_planners_awaiting: string;
    /** Receives `{n}` — planners with at least one client. */
    analytics_planners_with_client: string;
    analytics_planners_funnel_title: string;
    analytics_planners_step_applied: string;
    analytics_planners_step_accepted: string;
    analytics_planners_step_account: string;
    analytics_planners_step_activated: string;
    analytics_planners_step_with_client: string;
    analytics_planners_step_paying: string;
    analytics_planners_capacity_title: string;
    /** Receives `{avg}`. */
    analytics_planners_capacity_sub: string;
    analytics_planners_tier_starter: string;
    analytics_planners_tier_pro: string;
    analytics_planners_tier_premium: string;
    /** Receives `{n}` planners and `{cap}` client ceiling. */
    analytics_planners_tier_sub: string;
    analytics_planners_billing_title: string;
    analytics_planners_free_window: string;
    analytics_planners_paying: string;
    analytics_planners_conversion: string;
    /** Receives `{days}`. Deliberately hedged: we never stamped a went-paid-at. */
    analytics_planners_time_to_paid: string;
    analytics_planners_sub_trialing: string;
    analytics_planners_sub_founding: string;
    analytics_planners_sub_active: string;
    analytics_planners_sub_past_due: string;
    analytics_planners_sub_canceled: string;
    analytics_planners_sub_none: string;
    analytics_planners_signups_title: string;
    /** Receives `{n}`. */
    analytics_planners_signups_sub: string;
    /** Campaigns lens: all four outreach families, their funnels and rates. */
    analytics_section_campaigns: string;
    analytics_campaigns_subtitle: string;
    analytics_campaigns_empty: string;
    analytics_campaigns_sent: string;
    analytics_campaigns_open_rate: string;
    analytics_campaigns_click_rate: string;
    analytics_campaigns_conv_rate: string;
    analytics_campaigns_converted: string;
    analytics_campaigns_utm: string;
    analytics_campaigns_optout: string;
    /** Receives `{n}`. */
    analytics_campaigns_failed: string;
    /** Receives `{n}`. */
    analytics_campaigns_campaign_count: string;
    analytics_campaigns_daily_title: string;
    /** Receives `{days}`. */
    analytics_campaigns_daily_sub: string;
    analytics_campaigns_family_title: string;
    analytics_campaigns_family_sub: string;
    analytics_campaigns_col_family: string;
    analytics_campaigns_col_campaign: string;
    analytics_campaigns_table_title: string;
    analytics_campaigns_table_sub: string;
    /** Users lens: composition, pairing, recency, cohorts. */
    analytics_section_users: string;
    analytics_users_empty: string;
    analytics_users_total: string;
    analytics_users_paired: string;
    /** Receives `{pct}`. */
    analytics_users_paired_sub: string;
    analytics_users_solo: string;
    /** Receives `{days}`. */
    analytics_users_time_to_pair: string;
    analytics_users_no_workspace: string;
    analytics_users_recency_title: string;
    analytics_users_recency_sub: string;
    analytics_users_recency_week: string;
    analytics_users_recency_month: string;
    analytics_users_recency_dormant30: string;
    analytics_users_recency_dormant90: string;
    analytics_users_recency_never: string;
    analytics_users_cohorts_title: string;
    analytics_users_cohorts_sub: string;
    /** Receives `{admins}`, `{test}`, `{demo}` — the cohorts the audience
     *  filter is holding back, counted regardless of the toggles. */
    analytics_users_cohorts_note: string;
    analytics_users_col_month: string;
    analytics_users_col_workspaces: string;
    analytics_users_col_active: string;
    analytics_users_col_share: string;
    analytics_guests_empty: string;
    analytics_guests_total: string;
    analytics_guests_per_couple: string;
    analytics_guests_response_rate: string;
    analytics_guests_response_rate_sub: string;
    analytics_guests_acceptance_rate: string;
    analytics_guests_acceptance_rate_sub: string;
    analytics_guests_plus_one: string;
    analytics_guests_accommodation: string;
    analytics_guests_rsvp_title: string;
    analytics_guests_rsvp_yes: string;
    analytics_guests_rsvp_maybe: string;
    analytics_guests_rsvp_no: string;
    analytics_guests_rsvp_pending: string;
    analytics_guests_kind_title: string;
    analytics_guests_kind_adult: string;
    analytics_guests_kind_child: string;
    analytics_guests_kind_baby: string;
    analytics_guests_song_requests: string;
    analytics_guests_dietary_title: string;
    analytics_guests_dietary_sub: string;
    analytics_guests_dietary_empty: string;
    analytics_guests_diet_vegetarian: string;
    analytics_guests_diet_vegan: string;
    analytics_guests_diet_gluten: string;
    analytics_guests_diet_lactose: string;
    analytics_guests_diet_nut: string;
    analytics_guests_diet_other: string;
    // Traffic section (Google Analytics 4, pulled live via the Data API).
    analytics_section_traffic: string;
    analytics_section_acquisition: string;
    analytics_acq_window: string;
    analytics_acq_load_error: string;
    analytics_acq_empty: string;
    analytics_acq_unknown: string;
    analytics_acq_coverage: string;
    analytics_acq_geoip_hint: string;
    analytics_acq_total_signups: string;
    analytics_acq_onboarded_rate: string;
    analytics_acq_active_rate: string;
    analytics_acq_top_channel: string;
    analytics_acq_unknown_country: string;
    analytics_acq_conversion_sub: string;
    analytics_acq_by_country_title: string;
    analytics_acq_by_channel_title: string;
    analytics_acq_channel_note: string;
    analytics_acq_by_device_title: string;
    analytics_acq_campaigns_title: string;
    analytics_acq_campaigns_sub: string;
    analytics_acq_country_locale_title: string;
    analytics_acq_map_title: string;
    analytics_acq_map_sub: string;
    analytics_acq_map_less: string;
    analytics_acq_map_more: string;
    analytics_acq_map_other: string;
    analytics_acq_col_signups: string;
    analytics_acq_col_onboarded: string;
    analytics_acq_col_active: string;
    analytics_acq_col_country: string;
    analytics_acq_col_channel: string;
    analytics_acq_col_campaign: string;
    analytics_acq_col_locale: string;
    analytics_acq_col_count: string;
    analytics_acq_channel_paid: string;
    analytics_acq_channel_social: string;
    analytics_acq_channel_email: string;
    analytics_acq_channel_organic: string;
    analytics_acq_channel_referral: string;
    analytics_acq_channel_direct: string;
    analytics_traffic_source: string;
    analytics_traffic_load_error: string;
    analytics_traffic_empty: string;
    analytics_traffic_setup_title: string;
    analytics_traffic_setup_body: string;
    analytics_traffic_api_error_title: string;
    analytics_traffic_api_error_hint: string;
    analytics_traffic_active_users: string;
    analytics_traffic_sessions: string;
    analytics_traffic_page_views: string;
    analytics_traffic_engagement_rate: string;
    analytics_traffic_avg_session: string;
    analytics_traffic_28d_sub: string;
    analytics_traffic_daily_title: string;
    analytics_traffic_daily_sub: string;
    analytics_traffic_channels_title: string;
    analytics_traffic_channels_empty: string;
    analytics_traffic_countries_title: string;
    analytics_traffic_countries_empty: string;
    analytics_traffic_top_pages_title: string;
    analytics_traffic_top_pages_empty: string;
    analytics_traffic_col_page: string;
    analytics_traffic_col_views: string;
    analytics_traffic_col_visitors: string;
    analytics_traffic_col_avg_time: string;
    analytics_traffic_realtime_label: string;
    analytics_traffic_28d_label: string;
    analytics_traffic_new_returning_title: string;
    analytics_traffic_new_users: string;
    analytics_traffic_returning_users: string;
    analytics_traffic_first_touch_title: string;
    analytics_traffic_first_touch_sub: string;
    analytics_traffic_events_title: string;
    analytics_traffic_events_sub: string;
    analytics_traffic_devices_title: string;
    analytics_traffic_devices_sub: string;
    /** Compact KPI tile labels added in the 2026 redesign. */
    analytics_money_couples_with_budget_short: string;
    analytics_money_couples_with_actuals_short: string;
    analytics_money_median_ceiling: string;
    analytics_activity_signups_24h: string;
    analytics_activity_signups_30d: string;
    analytics_activity_active_users_24h: string;
    analytics_activity_verified_pct: string;
    analytics_picks_per_couple_avg: string;
    analytics_picks_sources_mix: string;
    analytics_engagement_session_avg_short: string;
    analytics_engagement_sessions_total_short: string;
    analytics_engagement_d7_retention: string;
    analytics_engagement_top_feature_kpi: string;
    analytics_engagement_top_feature_none: string;
    analytics_demo_kpi_total: string;
    analytics_demo_kpi_served: string;
    analytics_demo_kpi_active: string;
    analytics_demo_kpi_events: string;
    analytics_demo_kpi_lifetime: string;
    /** Demo-kind selector tiles — couple vs planner vs vendor demos. */
    analytics_demo_type_couple: string;
    analytics_demo_type_planner: string;
    analytics_demo_type_vendor: string;
    analytics_demo_type_served_note: string;
    /** Section headers — three `<section className="card">` blocks. */
    analytics_section_money: string;
    analytics_section_activity: string;
    analytics_section_picks: string;
    /** Money KPI tiles + sub-line. */
    analytics_money_couples_with_budget: string;
    analytics_money_couples_with_actuals: string;
    analytics_money_avg_budget: string;
    analytics_money_avg_planned: string;
    analytics_money_avg_actual: string;
    /** "median X · range Y–Z" sub-line under each KPI. */
    analytics_money_sub_distribution: string;
    /** Per-category table. */
    analytics_money_per_category_title: string;
    analytics_money_col_category: string;
    analytics_money_col_avg_planned: string;
    analytics_money_col_avg_actual: string;
    analytics_money_col_couples_with_data: string;
    /** Budget histogram chart. */
    analytics_money_histogram_title: string;
    /** Total-cost histogram chart (sum of per-line planned amounts). */
    analytics_money_cost_histogram_title: string;
    /** 0-bucket label for the total-cost histogram ("no cost entered"). */
    analytics_money_cost_histogram_no_cost: string;
    analytics_money_histogram_no_budget: string;
    analytics_money_no_budget_warning: string;
    analytics_money_histogram_bucket_upper: string;
    /** Activity KPIs. */
    analytics_activity_signups_7d: string;
    analytics_activity_active_users_7d: string;
    analytics_activity_pct_onboarded: string;
    analytics_activity_signups_sub: string;
    analytics_vs_prev: string;
    analytics_activity_active_users_sub: string;
    analytics_activity_pct_onboarded_sub: string;
    /** Daily signups bar chart. */
    analytics_activity_signups_daily_title: string;
    analytics_activity_signups_daily_sub: string;
    /** Tiny "demo: {n}" note under a real headline, flagging demo accounts. */
    analytics_activity_demo_note: string;
    /** Onboarding funnel. */
    analytics_activity_funnel_title: string;
    analytics_activity_funnel_registered: string;
    analytics_activity_funnel_verified: string;
    analytics_activity_funnel_onboarded: string;
    /** Couples-by-status badge row. */
    analytics_activity_status_title: string;
    analytics_activity_status_active: string;
    analytics_activity_status_paused: string;
    analytics_activity_status_deleting: string;
    analytics_activity_status_archived: string;
    /** Top audit-log actions table. */
    analytics_activity_top_actions_title: string;
    analytics_activity_col_action: string;
    analytics_activity_col_count: string;
    /** Picks KPIs. */
    analytics_picks_total: string;
    analytics_picks_median_per_couple: string;
    analytics_picks_total_sub: string;
    analytics_picks_adoption_sub: string;
    analytics_picks_median_sub: string;
    /** Top picks table. */
    analytics_picks_top_title: string;
    analytics_picks_col_supplier: string;
    analytics_picks_col_category: string;
    analytics_picks_col_pick_count: string;
    analytics_picks_col_source: string;
    /** Category coverage table. */
    analytics_picks_coverage_title: string;
    analytics_picks_weekly_title: string;
    analytics_picks_weekly_sub: string;
    analytics_picks_col_picked: string;
    analytics_picks_col_missing: string;
    analytics_picks_col_coverage_pct: string;
    /** Source breakdown stacked bar. */
    analytics_picks_source_breakdown_title: string;
    /** Source-of-truth badges next to top_picks rows + stacked-bar legend. */
    analytics_source_curated: string;
    analytics_source_community: string;
    analytics_source_diy: string;
    /** Empty-state copy when an aggregate has zero rows (fresh DB,
     *  newly-launched product, etc.). Per-section because the wording shifts
     *  ("no couples set a budget yet" vs "no picks yet"). */
    analytics_money_empty: string;
    analytics_money_per_category_empty: string;
    analytics_money_histogram_empty: string;
    analytics_activity_signups_empty: string;
    /** Small-multiple facet labels for the daily-signups card: one row per
     *  account kind, so identity is carried by a label rather than by colour
     *  alone (the palette is deliberately low-chroma and can't separate three
     *  overlaid series). `_sub` is the facet's 14-day total. */
    analytics_activity_signups_kind_couples: string;
    analytics_activity_signups_kind_planners: string;
    analytics_activity_signups_kind_vendors: string;
    analytics_activity_signups_kind_sub: string;
    analytics_activity_top_actions_empty: string;
    analytics_picks_empty: string;
    analytics_picks_top_empty: string;
    analytics_picks_coverage_empty: string;
    analytics_engagement_title: string;
    analytics_engagement_sub: string;
    analytics_engagement_empty: string;
    analytics_engagement_load_error: string;
    analytics_engagement_session_duration: string;
    analytics_engagement_session_minutes: string;
    analytics_engagement_session_median: string;
    analytics_engagement_session_p25: string;
    analytics_engagement_session_p75: string;
    analytics_engagement_session_count: string;
    analytics_engagement_session_total_sessions: string;
    analytics_engagement_active_users_30d: string;
    analytics_engagement_retention: string;
    analytics_engagement_retention_d1: string;
    analytics_engagement_retention_d7: string;
    analytics_engagement_retention_d30: string;
    analytics_engagement_retention_cohort: string;
    analytics_engagement_retention_title: string;
    analytics_engagement_retention_day: string;
    analytics_engagement_retention_small_sample: string;
    analytics_engagement_retention_empty: string;
    analytics_engagement_heatmap: string;
    analytics_engagement_heatmap_sub: string;
    analytics_engagement_heatmap_empty: string;
    analytics_engagement_dow_mon: string;
    analytics_engagement_dow_tue: string;
    analytics_engagement_dow_wed: string;
    analytics_engagement_dow_thu: string;
    analytics_engagement_dow_fri: string;
    analytics_engagement_dow_sat: string;
    analytics_engagement_dow_sun: string;
    analytics_engagement_dow_long_mon: string;
    analytics_engagement_dow_long_tue: string;
    analytics_engagement_dow_long_wed: string;
    analytics_engagement_dow_long_thu: string;
    analytics_engagement_dow_long_fri: string;
    analytics_engagement_dow_long_sat: string;
    analytics_engagement_dow_long_sun: string;
    analytics_engagement_heatmap_tooltip: string;
    analytics_engagement_top_features: string;
    analytics_engagement_top_features_empty: string;
    analytics_engagement_users: string;
    analytics_engagement_events_per_user: string;
    analytics_engagement_total_label: string;
    analytics_engagement_total_picks: string;
    /** Top active users leaderboard inside the engagement panel — ranks
     *  real users (demo workspaces excluded) by audit event count over
     *  the last 30 days. */
    analytics_engagement_top_users: string;
    analytics_engagement_top_users_empty: string;
    analytics_engagement_top_users_help: string;
    /** Demo platform monitoring — separate analytics card below the
     *  engagement panel. KPI tiles for total/new/active demos, a daily
     *  creation series, and a 30-day audit event tally. */
    analytics_demo_title: string;
    analytics_demo_sub: string;
    analytics_demo_load_error: string;
    analytics_demo_empty: string;
    analytics_demo_total: string;
    analytics_demo_new_24h: string;
    analytics_demo_new_7d: string;
    analytics_demo_active_24h: string;
    analytics_demo_avg_events: string;
    analytics_demo_daily_title: string;
    analytics_demo_daily_sub: string;
    analytics_demo_events_title: string;
    analytics_demo_events_unit: string;
    analytics_demo_events_help: string;
    /** Counts live demo workspaces + every historic `demo_usage` row —
     *  the cumulative "how many tried it" that survives the 4h reaper. */
    analytics_demo_total_served: string;
    /** Mean lifetime of purged demos, formatted as "5m 12s" / "2h 14m". */
    analytics_demo_avg_lifetime: string;
    analytics_demo_top_features_title: string;
    analytics_demo_top_features_sub: string;
    analytics_demo_top_features_empty: string;
    analytics_demo_feature_demos_one: string;
    analytics_demo_feature_demos_other: string;
    /** The campaign PLAN tab: one card per campaign family, each composing its
     *  own next round on an interval the operator can change. */
    plan_title: string;
    plan_subtitle: string;
    plan_what_vendor_claim: string;
    plan_what_vendor_review: string;
    /** The onboarding family's name on the plan card; the tab label is just
     *  "Onboarding", which reads as a product area rather than a campaign. */
    plan_what_onboarding_name: string;
    plan_what_onboarding: string;
    plan_repeat: string;
    plan_interval: string;
    plan_auto_start: string;
    /** Receives `{n}` — addresses a campaign built now would reach. */
    plan_reach: string;
    /** Receives `{n}` and `{days}` — addresses held back by the cooldown. */
    plan_cooling: string;
    /** Receives `{date}` — when the next round gets composed. */
    plan_next: string;
    plan_no_repeat: string;
    /** Receives `{slug}` and `{n}` — the prepared campaign and its audience. */
    plan_prepared: string;
    plan_prepare: string;
    plan_run: string;
    plan_open_console: string;
    plan_empty: string;
    /** Receives `{n}`. */
    plan_prepared_toast: string;
    plan_started_toast: string;
    /** Receives `{n}` — how few addresses were left. */
    plan_skip_too_few: string;
    plan_skip_in_flight: string;
    /** /app/admin/vendor-campaign, the claim-invite campaign console. */
    campaign_title: string;
    campaign_subtitle: string;
    campaign_new: string;
    campaign_slug: string;
    campaign_country: string;
    campaign_country_all: string;
    campaign_daily_cap: string;
    campaign_create: string;
    campaign_created: string;
    campaign_empty: string;
    campaign_status_paused: string;
    campaign_status_running: string;
    campaign_status_done: string;
    campaign_start: string;
    campaign_pause: string;
    /** Receives `{n}`, the batch size. */
    campaign_send_batch: string;
    campaign_run_reminders: string;
    /** Receives `{n}`, how many reminders actually went out. */
    campaign_reminders_sent: string;
    /** Receives `{n}`, how many invites actually went out. */
    campaign_batch_sent: string;
    campaign_stat_remaining: string;
    campaign_stat_sent: string;
    campaign_stat_opened: string;
    campaign_stat_clicked: string;
    campaign_stat_reminded: string;
    campaign_stat_claimed: string;
    campaign_stat_failed: string;
    /** Receives `{n}` + `{cap}`: sent in the last 24h against the daily cap. */
    campaign_stat_today: string;
    /** Receives `{months}`, `{left}`, `{cap}`: the free window the copy promises. */
    campaign_offer: string;
    campaign_offer_none: string;
    /** Receives `{n}` addresses, `{cap}` a day, `{days}` to drain. */
    campaign_plan: string;
    campaign_plan_empty: string;
    campaign_preview_invite: string;
    campaign_preview_reminder: string;
    campaign_targets: string;
    campaign_targets_hint: string;
    campaign_targets_empty: string;
    campaign_sends: string;
    campaign_send_sent: string;
    campaign_send_clicked: string;
    campaign_send_reminded: string;
    campaign_send_claimed: string;
    campaign_send_failed: string;
    campaign_optout: string;
    campaign_optout_hint: string;
    campaign_optout_email: string;
    campaign_optout_add: string;
    campaign_optout_added: string;
    campaign_start_confirm_title: string;
    /** Receives `{n}` addresses queued, and `{cap}`, the daily ceiling. */
    campaign_start_confirm_body: string;
    campaign_start_confirm_cta: string;
    campaign_batch_confirm_title: string;
    /** Receives `{n}`, the batch size. */
    campaign_batch_confirm_body: string;
    campaign_batch_confirm_cta: string;
    campaign_err_cap: string;
    campaign_err_email: string;
    /** Receives `{date}` — when the campaign first went Running. */
    campaign_launched: string;
    campaign_not_launched: string;
    /** Receives `{date}` — when the campaign retired to Done. */
    campaign_ended: string;
    /** Receives `{date}` — projected finish (remaining ÷ daily cap). */
    campaign_ends_est: string;
    /** Onboarding re-engagement console (reuses the campaign_* strings above;
     *  these are the segment-specific labels). */
    onbcamp_title: string;
    onbcamp_subtitle: string;
    onbcamp_stat_total: string;
    onbcamp_stat_queued: string;
    onbcamp_stat_converted: string;
    onbcamp_stat_reminded: string;
    onbcamp_stat_lang: string;
    onbcamp_sync_heading: string;
    onbcamp_sync_hint: string;
    onbcamp_sync_cta: string;
    /** Receives `{added}`, `{existing}`, `{optout}`. */
    onbcamp_sync_result: string;
    /** Receives `{n}` — eligible orphans a sync would add right now. */
    onbcamp_eligible: string;
    onbcamp_contacts: string;
    onbcamp_contacts_hint: string;
    onbcamp_contacts_empty: string;
    /** Receives `{n}` — recipients beyond the rendered rows. */
    onbcamp_contacts_more: string;
    onbcamp_send_queued: string;
    onbcamp_send_skipped: string;
    onbcamp_send_converted: string;
    onbcamp_reminded_badge: string;
    /** Review-invite campaign console (reuses the campaign_* strings above). */
    review_campaign_title: string;
    review_campaign_subtitle: string;
    review_campaign_targets_hint: string;
    review_campaign_stat_collected: string;
    review_campaign_send_collected: string;
    /** Receives `{n}` — how many notes went out in the manual batch. */
    review_campaign_batch_sent: string;
    /** /app/admin/email-list — collected emails from all sources. */
    email_list_title: string;
    email_list_subtitle: string;
    email_list_load_error: string;
    email_list_export_csv: string;
    email_list_search_placeholder: string;
    email_list_filter_all: string;
    email_list_source_user: string;
    email_list_source_vendor: string;
    email_list_source_guest: string;
    email_list_source_vendor_waitlist: string;
    email_list_source_planner_waitlist: string;
    email_list_col_email: string;
    email_list_col_source: string;
    email_list_col_name: string;
    email_list_col_meta: string;
    email_list_col_added: string;
    email_list_empty_title: string;
    email_list_empty_body: string;
    email_list_count: string;
  };
  rsvp: {
    title: string;
    sub: string;
    not_found: string;
    will_attend: string;
    pick_yes: string;
    pick_no: string;
    pick_maybe: string;
    /** Compact mobile-only variants of the pick_yes/no/maybe labels —
     *  used inside the inline 3-col radio group so all three options fit
     *  on one row at iPhone widths (~120px per cell). The verbose copy
     *  ("Yes, count us in") stays for sm:+ where there is room and the
     *  friendlier tone reads better. */
    pick_yes_short: string;
    pick_no_short: string;
    pick_maybe_short: string;
    meal: string;
    dietary: string;
    plus_one_q: string;
    plus_one_name: string;
    plus_one_meal: string;
    accommodation_q: string;
    song: string;
    submit: string;
    submitted: string;
    thanks_title: string;
    thanks_body: string;
    thanks_email_hint: string;
    /** Post-submit referral copy — see HouseholdRsvpForm.tsx. */
    thanks_open_site: string;
    thanks_plan_your_own: string;
    /** Countdown caption on the post-RSVP auto-redirect runner. {n} = seconds. */
    redirect_hint: string;
    add_to_calendar_section: string;
    add_to_google_calendar: string;
    add_to_ical: string;
    /** Re-opens the collapsed RSVP inputs after a self-serve guest submitted. */
    edit_responses: string;
    update_response: string;
    /** Airport check-in lookup screen. */
    checkin_title: string;
    checkin_intro: string;
    checkin_couple_label: string;
    checkin_couple_help: string;
    checkin_code_label: string;
    checkin_code_help: string;
    checkin_submit: string;
    checkin_lookup_failed: string;
    /** Field-level error variants for the lookup form. */
    checkin_lookup_couple_unknown: string;
    checkin_lookup_code_unknown: string;
    checkin_lookup_missing: string;
    checkin_contact_hosts: string;
    checkin_contact_hosts_email: string;
    checkin_household_for: string;
    checkin_for_member: string;
    checkin_member_dietary: string;
    checkin_member_accommodation: string;
    checkin_member_song: string;
    checkin_save_for_all: string;
    checkin_back_to_lookup: string;
    checkin_household_label: string;
    /** Day-of greeter — "next guest" controls. */
    checkin_next_guest: string;
    checkin_done_title: string;
    /** Pending status pill on the household form. */
    pick_pending: string;
    /** Accessible label for the per-member RSVP status radiogroup.
     *  Receives `{name}` so screen readers announce "RSVP status for Anna". */
    status_for_name: string;
    /** Confirm dialog when toggling away from "yes" with pre-filled data. */
    decline_keep_data_title: string;
    decline_keep_data_body: string;
    decline_keep_data_confirm: string;
    /** Kicker tag above the airport-style lookup form. */
    checkin_kicker: string;
    /** "REF" badge labelling the household code on the household form. */
    checkin_ref_label: string;
    /** "Party of {n}" header — replaces the cold "Checking in for" copy. */
    checkin_party_of: string;
    /** Pre-submit summary line so guests don't fire off a partial RSVP by
     *  accident. {n} = ready count, {p} = still-pending count. */
    checkin_summary_ready: string;
    checkin_summary_pending_one: string;
    checkin_summary_pending_n: string;
    /** Stronger submit CTA than "Save responses". */
    checkin_complete: string;
    /** Public-form "add a guest" affordance — partner / child / baby. */
    checkin_add_member: string;
    checkin_add_member_help: string;
    checkin_add_member_name: string;
    checkin_add_member_kind: string;
    checkin_add_member_save: string;
    checkin_add_member_remove: string;
    /** Per-member dietary / family chips (vega + 3 allergies + baby + plus-one). */
    tag_vegan: string;
    tag_lactose: string;
    tag_milk_protein: string;
    tag_gluten: string;
    tag_nut: string;
    tag_egg: string;
    tag_fish_shellfish: string;
    tag_plus_one: string;
    tag_baby: string;
    /** Section labels on the public RSVP form. The icon-only meal grid and the
     *  text-chip dietary grid were sitting next to each other without a header,
     *  so guests were mis-reading "Vega" (vegetarian meal) as an allergy chip.
     *  Two short serif headers separate them. Only rendered when the couple
     *  has the corresponding RSVP feature enabled. */
    meal_section_title: string;
    dietary_section_title: string;
    dietary_other_placeholder: string;
    accommodation_section_title: string;
    accommodation_none: string;
    guest_message_label: string;
    guest_message_placeholder: string;
    guest_message_help: string;
    /** Header above the +1/baby chip row so guests don't conflate "bringing
     *  someone" with a dietary attribute. */
    additions_section_title: string;
    /** Inline name inputs that appear when "+1" or "Baby" chip is toggled on. */
    added_name_plus_one: string;
    added_name_baby: string;
    added_name_placeholder: string;
    /** Validation errors raised on the public RSVP form. */
    error_status_required: string;
    error_added_name_required: string;
    /** Pre-submit double-confirmation dialog. */
    confirm_submit_title: string;
    confirm_submit_body: string;
    confirm_submit_yes: string;
    /** Offline-queue UX — venue WiFi is patchy at the door, so we let the
     *  RSVP form persist a submit to localStorage and flush it on the next
     *  "online" event. Plural pair: _one + _other. */
    offline_pending_one: string;
    offline_pending_other: string;
    /** Success toast shown after a submit was queued locally. */
    offline_saved: string;
    /** Toast shown once the queue has drained. Plural pair. */
    offline_drained_one: string;
    offline_drained_other: string;
    /** Kiosk-lock copy. The /rsvp surface can be locked into a doorperson
     *  mode so a borrowed phone is one mis-tap from /app. Entry is only
     *  via the launcher on /app/profile; the public /rsvp footer no longer
     *  exposes a toggle. */
    kiosk_banner: string;
    kiosk_exit_hold: string;
    kiosk_exit_confirmed: string;
  };
  notfound: {
    title: string;
    body: string;
    go_home: string;
  };
  /** Settings hub at /app/settings — four-tab restructure of the old
   *  /app/profile dumping ground. Tab labels live here; everything else
   *  (per-section copy) still lives under `profile.*`. */
  settings: {
    tabs_aria_label: string;
    tab_account: string;
    tab_workspace: string;
    tab_planning: string;
    tab_billing: string;
    tab_data: string;
  };
  /** The "share Weddly" referral prompt (components/ShareWeddlyDialog.tsx).
   *  All three message variants live here, in both trees, so the modal has the
   *  complete localised set the moment it opens — nothing is translated at
   *  share time. The experience never mixes languages: it renders whichever
   *  tree is active, and non-English interfaces resolve to Hungarian (see
   *  `shareLanguage` in lib/share_weddly.ts). */
  share_weddly: {
    /** Profile-dropdown entry. */
    menu_label: string;
    title: string;
    body: string;
    /** Accessible name for the message rail + its pagination dots. */
    messages_label: string;
    /** The share text itself. Ends with the URL; `splitShareMessage` lifts the
     *  URL out for `navigator.share` so it isn't duplicated. */
    message_warm: string;
    message_clean: string;
    message_friendly: string;
    /** Icon-button tooltips + aria-labels. */
    share_action: string;
    copy_action: string;
    /** Transient states, announced to screen readers. */
    sharing: string;
    copied: string;
    cancelled: string;
    error: string;
    /** Shown after a confirmed native share. */
    success: string;
  };
  profile: {
    title: string;
    menu_label: string;
    menu_profile: string;
    menu_landing: string;
    menu_couple_cards: string;
    no_name: string;
    /** Three small-caps labels splitting the page into semantic zones —
     *  break up the equal-weight card stack so the user can scan by
     *  group instead of scrolling 12 indistinguishable rectangles. */
    zone_workspace: string;
    zone_planning: string;
    zone_notifications: string;
    zone_account: string;
    /** Profile hero band — top-of-page identity strip. Shows the couple's
     *  monogram, names, wedding date and a days-until counter so the page
     *  actually feels like a "Profile" instead of a settings dump. */
    hero_days_until: string;
    hero_days_one: string;
    hero_days_today: string;
    hero_days_past: string;
    hero_date_tbd: string;
    /** Short caption shown under the big days-until number on phones,
     *  where the verbose "Még X nap az esküvőig" wouldn't fit and is
     *  also redundant with the number already shown above. */
    hero_days_caption_short: string;
    /** Inline rename UX on the hero band. Pencil reveals two inline
     *  inputs (bride + groom) with Save / Cancel. No rate limit. */
    hero_name_edit: string;
    hero_name_bride_placeholder: string;
    hero_name_groom_placeholder: string;
    hero_name_save_error: string;
    hero_name_save_success: string;
    /** Account section — surfaces the signed-in user's own identity so the
     *  page has somewhere to read "Your account" instead of jumping straight
     *  to partner / workspace. */
    account_title: string;
    account_body: string;
    account_type_user: string;
    account_type_planner: string;
    account_type_vendor: string;
    account_email_label: string;
    account_name_label: string;
    account_name_placeholder: string;
    account_name_save_error: string;
    account_name_save_success: string;
    account_locale_label: string;
    account_locale_help: string;
    account_locale_hu: string;
    account_locale_en: string;
    account_locale_save_success: string;
    /** Prominent verify-email section, shown when verified_email = false. */
    verify_title: string;
    verify_body: string;
    verify_email_intro: string;
    verify_resend: string;
    verify_resending: string;
    verify_resent: string;
    verify_already_verified: string;
    /** Partner card — surfaces the OTHER partner's name/email + a colour-
     *  coded status pill (invited / joined / active). */
    partner_title: string;
    partner_body: string;
    partner_none: string;
    partner_no_name: string;
    partner_no_email: string;
    partner_status_invited: string;
    partner_status_joined: string;
    partner_status_active: string;
    /** Shown below the "invited" pill — small one-liner + a "cancel
     *  invite" button so the user can revoke a typo'd invite without
     *  having to hunt for the Dashboard widget (which is hidden once an
     *  invite is in flight). */
    partner_invited_hint: string;
    partner_invite_cancel: string;
    /** Armed label shown after the first cancel-invite click. Second click
     *  within 4s actually fires the request — guards against an accidental
     *  click that would invalidate the partner's link. */
    partner_invite_cancel_confirm: string;
    /** Visually-hidden aria-live announce that pairs with the armed state —
     *  screen readers otherwise have no way to know the button is now
     *  one click away from firing a destructive action. */
    partner_invite_cancel_armed_announce: string;
    partner_invite_cancelling: string;
    /** Activity log — dark "what happened in the workspace" panel. The
     *  per-action `activity_action_*` keys cover the visible set defined
     *  in routes/couples.ts (`ACTIVITY_VISIBLE_ACTIONS`). */
    activity_title: string;
    activity_empty: string;
    activity_actor_you: string;
    activity_actor_unknown: string;
    activity_just_now: string;
    activity_mins_ago: string;
    activity_hours_ago: string;
    activity_yesterday: string;
    activity_days_ago: string;
    activity_action_couple_update: string;
    activity_action_couple_slug_update: string;
    activity_action_couple_archive: string;
    activity_action_couple_pause: string;
    activity_action_couple_unpause: string;
    activity_action_couple_notify_date_change: string;
    activity_action_couple_onboard: string;
    activity_action_couple_export: string;
    activity_action_guest_create: string;
    activity_action_guest_update: string;
    activity_action_guest_delete: string;
    activity_action_guest_csv_import: string;
    activity_action_guest_csv_export: string;
    activity_action_household_create: string;
    activity_action_household_update: string;
    activity_action_household_delete: string;
    activity_action_household_regen_code: string;
    activity_action_household_code_rotate: string;
    activity_action_budget_line_create: string;
    activity_action_budget_line_update: string;
    activity_action_budget_line_delete: string;
    activity_action_budget_snapshot_create: string;
    activity_action_budget_snapshot_delete: string;
    activity_action_table_create: string;
    activity_action_table_update: string;
    activity_action_table_delete: string;
    activity_action_seat_assign: string;
    activity_action_seat_unassign: string;
    activity_action_seat_swap: string;
    activity_action_conflict_create: string;
    activity_action_conflict_delete: string;
    activity_action_print_seating_chart: string;
    activity_action_print_place_cards: string;
    activity_action_export_delete: string;
    activity_action_rsvp_submit: string;
    activity_action_rsvp_add_member: string;
    activity_action_invite_create: string;
    activity_action_invite_cancel: string;
    activity_action_invite_accept: string;
    activity_action_supplier_cost_upsert: string;
    activity_action_supplier_community_create: string;
    /** Loop C₁: per-field couple-update splits + DIY / pick / schedule entries.
     *  These strings receive `{before}` / `{after}` / `{category}` / `{label}` /
     *  `{name}` interpolation from `renderActivityEntry()` in ProfilePage. */
    activity_action_couple_budget_cap_update: string;
    activity_action_couple_wedding_date_update: string;
    activity_action_couple_names_update: string;
    activity_action_couple_ceremony_kind_update: string;
    activity_action_couple_planning_count_update: string;
    activity_action_pick_upsert: string;
    activity_action_pick_remove: string;
    activity_action_schedule_create: string;
    activity_action_schedule_update: string;
    activity_action_schedule_delete: string;
    activity_action_couple_supplier_create: string;
    activity_action_couple_supplier_update: string;
    activity_action_couple_supplier_delete: string;
    /** Rename-detected variants: when the visible label changed, we surface
     *  the before → after pair instead of just the new label. */
    activity_action_household_update_rename: string;
    activity_action_table_update_rename: string;
    activity_action_budget_line_update_rename: string;
    /** Budget-line value change. `{label}` names the row, `{changes}` is a
     *  comma-joined string of `tervezett: 100k → 200k` style segments built
     *  on the frontend so HUF formatting stays in one place. */
    activity_action_budget_line_update_diff: string;
    /** Field labels used inside the budget-line diff segment. */
    activity_budget_planned: string;
    activity_budget_actual: string;
    /** Open / close hints on the collapsible activity panel header. */
    activity_toggle_expand: string;
    activity_toggle_collapse: string;
    /** Generic catch-all when an unknown / unwhitelisted action slips through —
     *  rather than show the raw key, fall back to a calm sentence. */
    activity_action_generic: string;
    /** Used inside the wedding-date diff render when one side is TBD. */
    activity_date_tbd: string;
    /** Empty fallback for unknown / missing values in a diff (e.g. cleared field). */
    activity_value_empty: string;
    /** Separator between bride and groom names inside the activity feed.
     *  HU prefers "és", EN prefers "&" — was hardcoded as " & ". */
    activity_names_separator: string;
    /** Budget summary card on /app/profile — shows the cap + total paid with
     *  inline edits so couples don't have to bounce to /app/budget for a
     *  quick number tweak or a one-off payment record. */
    budget_title: string;
    budget_body: string;
    budget_cap_label: string;
    budget_cap_placeholder: string;
    budget_cap_invalid: string;
    budget_paid_label: string;
    budget_paid_hint: string;
    budget_payment_add: string;
    budget_payment_save: string;
    budget_payment_label_placeholder: string;
    budget_payment_amount_placeholder: string;
    budget_payment_label_required: string;
    budget_payment_amount_invalid: string;
    /** Currency picker — label + the three pill captions. */
    budget_currency_label: string;
    /** Confirm dialog shown when the user taps a different currency pill —
     *  spells out that we DON'T retro-convert past entries by FX rate. */
    budget_currency_confirm_title: string;
    budget_currency_confirm_body: string;
    budget_currency_confirm_yes: string;
    /** Country combobox in the couple-settings panel. Drives supplier
     *  region filtering — a Belgian couple shouldn't be pitched
     *  HU-only venues. */
    country_label: string;
    country_helper: string;
    country_save_done: string;
    /** Profile "Workspaces" panel — lists Alpha / Bravo / Charlie and
     *  hosts the "Új esemény" CTA + create modal. */
    workspaces_title: string;
    workspaces_body: string;
    workspaces_add: string;
    workspaces_cap_reached: string;
    workspaces_empty: string;
    workspaces_switch: string;
    workspaces_role_owner: string;
    workspaces_role_partner: string;
    workspaces_create_title: string;
    workspaces_create_body: string;
    workspaces_create_event_label: string;
    workspaces_create_event_placeholder: string;
    workspaces_create_event_required: string;
    workspaces_create_date_label: string;
    /** Country combobox in the create-workspace dialog. Pre-filled with
     *  the active workspace's country since most secondary events stay
     *  in the same country. */
    workspaces_create_country_label: string;
    workspaces_create_country_helper: string;
    workspaces_create_country_required: string;
    workspaces_create_submit: string;
    workspaces_create_done: string;
    workspaces_create_names_required: string;
    workspaces_create_seed_toggle: string;
    workspaces_create_seed_hint: string;
    workspaces_create_seed_summary: string;
    workspaces_create_seed_select_all: string;
    workspaces_create_seed_unselect_all: string;
    workspaces_create_seed_no_household: string;
    workspaces_edit: string;
    workspaces_edit_title: string;
    workspaces_edit_save: string;
    workspaces_edit_done: string;
    /** 3-click arm pattern for purging a secondary workspace. The labels
     *  ratchet from idle → "Biztos?" → "Tényleg?" → fires, with a 4s
     *  auto-disarm if the user wanders off. Only the workspace owner
     *  sees the button, and never on the active or primary workspace. */
    workspaces_delete: string;
    workspaces_delete_arm1: string;
    workspaces_delete_arm2: string;
    workspaces_delete_done: string;
    /** Typed-phrase modal that opens after the 3-click ratchet. The user
     *  must re-type the workspace name to confirm — same gate pattern
     *  as the pause-to-delete-account flow further down. `{name}` is the
     *  workspace's display_name. */
    workspaces_delete_confirm_title: string;
    workspaces_delete_confirm_label: string;
    workspaces_delete_confirm_help: string;
    workspaces_delete_confirm_yes: string;
    workspaces_delete_confirm_mismatch: string;
    /** Tiny pill on the first row of the workspaces list — marks the
     *  user's original onboarding workspace as the primary so the
     *  missing delete button reads as intentional, not buggy. */
    workspaces_primary_marker: string;
    /** Welcome-desk launcher card on /app/profile. Owners opt in here to
     *  open the public /rsvp page locked into kiosk mode (new tab); the
     *  same control no longer appears on the public RSVP footer so that
     *  arriving guests can't flip it themselves. */
    welcome_desk_title: string;
    welcome_desk_body: string;
    welcome_desk_button: string;
    welcome_desk_no_slug: string;
    /** CTA link on the no-slug hint — routes to the guest page where the
     *  couple code (public URL slug) is set. */
    welcome_desk_no_slug_cta: string;
    /** Toggle states + status pill labels for the Welcome Desk card. The
     *  toggle is a switch; the status pill is colour-coded (sage when on,
     *  paper when off) so the couple can read the kiosk status at a glance. */
    welcome_desk_toggle_aria: string;
    welcome_desk_toggle_on: string;
    welcome_desk_toggle_off: string;
    welcome_desk_status_on: string;
    welcome_desk_status_off: string;
    /** "Email notifications" card on the account settings tab — the in-app
     *  home of the lifecycle opt-out flag behind /api/account/email-preferences.
     *  Every lifecycle email's footer "preferences" link points here
     *  (#email-preferences anchor). Transactional mail is unaffected. */
    email_prefs_title: string;
    email_prefs_body: string;
    email_prefs_toggle_aria: string;
    email_prefs_on: string;
    email_prefs_off: string;
    /** "Wedding RSVP" settings card on /app/profile. Today it carries a
     *  single opt-in: whether the RSVP flow asks guests if they need
     *  accommodation. Default off so couples who don't offer it don't ask. */
    rsvp_title: string;
    rsvp_body: string;
    rsvp_offers_accommodation_label: string;
    rsvp_offers_accommodation_help: string;
    rsvp_collects_meal_label: string;
    rsvp_collects_meal_help: string;
    /** Security section — change-password form lives here. Collapsible:
     *  `security_summary` is the one-line teaser shown when the section is
     *  closed; the in-form sub-headings live in `security_pw_heading` and
     *  `security_email_heading`. The legacy `_body` keys are still wired
     *  in case some surface needs the longer copy. */
    security_title: string;
    security_summary: string;
    security_body: string;
    security_pw_heading: string;
    security_pw_current: string;
    security_pw_new: string;
    security_pw_confirm: string;
    security_pw_submit: string;
    security_pw_submitting: string;
    security_pw_success: string;
    security_pw_too_short: string;
    security_pw_mismatch: string;
    /** Change-email subform under Security. */
    security_email_heading: string;
    security_email_title: string;
    security_email_body: string;
    security_email_new: string;
    security_email_password: string;
    security_email_submit: string;
    security_email_submitting: string;
    security_email_sent: string;
    security_email_invalid: string;
    export_title: string;
    export_body: string;
    export_button: string;
    export_guest_csv_button: string;
    export_downloading: string;
    /** Saved download archive — last N versions, listed below the export buttons. */
    archive_title: string;
    archive_body: string;
    archive_empty: string;
    archive_redownload: string;
    /** Two-click delete on each archived export. First click arms the
     *  button (label flips to `archive_delete_confirm`); second click
     *  removes the row. */
    archive_delete: string;
    archive_delete_confirm: string;
    /** Visually-hidden aria-live announce that pairs with the armed state
     *  on each archive row — screen readers otherwise can't tell the
     *  button is now armed for an irreversible delete. */
    archive_delete_armed_announce: string;
    archive_deleting: string;
    archive_kind_json: string;
    archive_kind_seating_pdf: string;
    archive_kind_place_cards_pdf: string;
    archive_kind_table_numbers_pdf: string;
    archive_kind_menu_pdf: string;
    archive_kind_schedule_pdf: string;
    archive_kind_guest_csv: string;
    archive_filter_all: string;
    /** Delete-account flow (30-day grace before admin purge). */
    delete_account_title: string;
    delete_account_body: string;
    delete_account_button: string;
    pause_reason_title: string;
    pause_reason_intro: string;
    pause_reason_note_label: string;
    pause_reason_note_placeholder: string;
    pause_reason_continue: string;
    pause_reason_required: string;
    pause_reason_opt_wedding_done: string;
    pause_reason_opt_postponed: string;
    pause_reason_opt_missing_features: string;
    pause_reason_opt_too_expensive: string;
    pause_reason_opt_taking_break: string;
    pause_reason_opt_other: string;
    delete_account_confirm_title: string;
    /** TextField label inside the typed-confirm dialog. Receives `{phrase}`. */
    delete_account_confirm_label: string;
    delete_account_confirm_help: string;
    delete_account_confirm_yes: string;
    /** Validation error when typed phrase does not match. Receives `{phrase}`. */
    delete_account_confirm_mismatch: string;
    delete_account_pending: string;
    delete_account_pending_until: string;
    cancel_delete_account: string;
    /** Leave-workspace card — partner B can leave; partner A is blocked. */
    leave_couple_title: string;
    leave_couple_body_partner_b: string;
    leave_couple_body_owner: string;
    leave_couple_button: string;
    leave_couple_leaving: string;
    leave_couple_confirm_title: string;
    leave_couple_confirm_body: string;
    leave_couple_confirm_yes: string;
    leave_couple_done: string;
    leave_couple_failed: string;
  };
  error_boundary: {
    title: string;
    body: string;
    try_again: string;
    try_again_pending: string;
    go_home: string;
  };
  /** Clickwrap microcopy under the RegisterPage submit button — the
   *  affirmative act of clicking Register accepts both documents.
   *  Five pieces so the two policy links stay real <Link>s without
   *  dangerouslySetInnerHTML. */
  register: {
    continuing_prefix: string;
    continuing_privacy_link: string;
    continuing_and: string;
    continuing_terms_link: string;
    continuing_suffix: string;
  };
  /** /privacy — MVP-quality privacy policy. Bilingual (HU primary, EN
   *  block beneath). Content stays plain JSX in PrivacyPage.tsx; only
   *  the localised section titles / SEO copy live here. */
  /** Shared "open-beta draft" banner displayed above both Privacy and Terms.
   *  Sets honest expectation that the copy hasn't been signed off by a lawyer
   *  while the product is in the pre-1.0 window. */
  legal: {
    draft_banner_label: string;
    draft_banner_body: string;
    /** "Verzió" / "Version" — rendered next to the "Last updated" eyebrow
     *  on Privacy + Terms so a user can name the exact document version
     *  they accepted at signup. The value itself comes from
     *  `shared/legal.ts`. */
    version_label: string;
  };
  privacy: {
    seo_title: string;
    seo_description: string;
    page_title: string;
    last_updated_label: string;
    last_updated_date: string;
    intro: string;
    controller_title: string;
    controller_body: string;
    data_categories_title: string;
    data_categories_intro: string;
    data_categories_auth: string;
    data_categories_profile: string;
    data_categories_workspace: string;
    data_categories_analytics: string;
    /** Fifth bucket: the supplier directory. Most of it is legal-person
     *  data (outside the GDPR entirely, recital 14), but sole traders make
     *  it personal data often enough that it needs its own bullet and its
     *  own Art. 14 chapter below. */
    data_categories_directory: string;
    /** Article 6 GDPR — legal-basis-per-purpose breakdown. The four bullets
     *  cover the bases Weddly actually relies on; we don't claim ones we
     *  don't use (no public-interest task, no vital interest). */
    legal_bases_title: string;
    legal_bases_intro: string;
    legal_bases_contract: string;
    legal_bases_consent: string;
    legal_bases_legitimate_interest: string;
    legal_bases_legal_obligation: string;
    /** Article 14 disclosure: guest data is provided by the couple, not by
     *  the guest themselves. We need to tell guests how their data got here
     *  even though they never registered with us. */
    guest_data_title: string;
    guest_data_body: string;
    /** The OTHER Article 14 case, and the one that actually generates
     *  complaints: businesses listed in the directory who never registered.
     *  Kept as separate paragraphs rather than one wall of text because
     *  each answers a different question a listed vendor asks, in order:
     *  where did you get this, is it even personal data, on what basis do
     *  you publish it, what about my name/trademark/photos, why am I
     *  reading this here instead of in a letter, and what can I do. */
    directory_listings_title: string;
    directory_listings_intro: string;
    directory_listings_source: string;
    directory_listings_scope: string;
    directory_listings_basis: string;
    directory_listings_ip: string;
    directory_listings_art14: string;
    directory_listings_rights_intro: string;
    directory_listings_rights_correction: string;
    directory_listings_rights_claim: string;
    directory_listings_rights_contact: string;
    directory_listings_rights_objection: string;
    directory_listings_decision: string;
    retention_title: string;
    retention_body: string;
    rights_title: string;
    rights_intro: string;
    rights_access: string;
    rights_rectification: string;
    rights_deletion: string;
    rights_portability: string;
    rights_objection: string;
    rights_restriction: string;
    rights_withdrawal: string;
    rights_contact: string;
    /** Article 32 — technical and organisational security measures. Short
     *  factual list, not a marketing claim. */
    security_title: string;
    security_body: string;
    /** Article 8 — children's data. Weddly is not aimed at under-16s; guest
     *  lists may include minors entered by the couple. */
    children_title: string;
    children_body: string;
    /** Chapter V — international transfers. Railway is US-hosted, so
     *  Schrems II requires us to name the transfer mechanism (EU-US Data
     *  Privacy Framework + SCCs). */
    transfers_title: string;
    transfers_body: string;
    /** Article 28 — processors / subprocessors. One bullet per provider. */
    subprocessors_title: string;
    subprocessors_intro: string;
    subprocessors_railway: string;
    subprocessors_resend: string;
    subprocessors_serpapi: string;
    subprocessors_osm: string;
    subprocessors_pinterest: string;
    subprocessors_sentry: string;
    subprocessors_google: string;
    /** Google API user data: the disclosure Google's OAuth verification asks
     *  for, and the one this policy owed anyway once sign-in and the calendar
     *  sync started touching a user's Google account. The Limited Use sentence
     *  is quoted rather than paraphrased: it is what the review looks for. */
    google_data_title: string;
    google_data_body: string;
    google_data_signin: string;
    google_data_calendar_write: string;
    google_data_calendar_read: string;
    google_data_control: string;
    google_data_limited_use: string;
    google_data_policy_link: string;
    cookies_title: string;
    cookies_intro: string;
    cookies_locale: string;
    cookies_verify_dismiss: string;
    cookies_session: string;
    cookies_saved_suppliers: string;
    cookies_onboarding_draft: string;
    third_parties_title: string;
    third_parties_body: string;
    /** Hungarian Grtv. §6 (Act XLVIII of 2008) + EU ePrivacy — electronic
     *  direct marketing requires prior opt-in. Spelling out which mail
     *  types we send under which legal basis. */
    email_compliance_title: string;
    email_compliance_body: string;
    /** Article 22 — automated decision-making. We don't do any; saying so
     *  pre-empts the question. */
    automated_decisions_title: string;
    automated_decisions_body: string;
    /** Article 77 — right to lodge a complaint with a supervisory
     *  authority (NAIH for Hungary). */
    principles_title: string;
    principles_intro: string;
    principles_lawfulness: string;
    principles_purpose: string;
    principles_minimisation: string;
    principles_accuracy: string;
    principles_storage: string;
    principles_integrity: string;
    principles_accountability: string;
    proc_activities_title: string;
    proc_tech_title: string;
    proc_tech_data: string;
    proc_tech_purpose: string;
    proc_tech_basis: string;
    proc_tech_retention: string;
    proc_contact_title: string;
    proc_contact_data: string;
    proc_contact_purpose: string;
    proc_contact_basis: string;
    proc_contact_retention: string;
    proc_account_title: string;
    proc_account_data: string;
    proc_account_purpose: string;
    proc_account_basis: string;
    proc_account_retention: string;
    proc_workspace_title: string;
    proc_workspace_data: string;
    proc_workspace_purpose: string;
    proc_workspace_basis: string;
    proc_workspace_retention: string;
    proc_newsletter_title: string;
    proc_newsletter_data: string;
    proc_newsletter_purpose: string;
    proc_newsletter_basis: string;
    proc_newsletter_retention: string;
    proc_newsletter_unsubscribe: string;
    proc_billing_title: string;
    proc_billing_data: string;
    proc_billing_purpose: string;
    proc_billing_basis: string;
    proc_billing_retention: string;
    proc_supplier_title: string;
    proc_supplier_data: string;
    proc_supplier_purpose: string;
    proc_supplier_basis: string;
    proc_supplier_retention: string;
    /** Directory entries that exist without an account. Carries a `source`
     *  line the other proc blocks don't need, because Art. 14(2)(f) requires
     *  naming where third-party data came from. */
    proc_directory_title: string;
    proc_directory_data: string;
    proc_directory_source: string;
    proc_directory_purpose: string;
    proc_directory_basis: string;
    proc_directory_retention: string;
    /** Cold outreach to those listings (claim + review invites). Disclosed
     *  as its own activity because it is the part a listed business
     *  actually notices, and because Grtv. §6 deserves a straight answer. */
    proc_outreach_title: string;
    proc_outreach_data: string;
    proc_outreach_purpose: string;
    proc_outreach_basis: string;
    proc_outreach_retention: string;
    /** Reviews and public Q&A, reviewer-side processing. */
    proc_reviews_title: string;
    proc_reviews_data: string;
    proc_reviews_purpose: string;
    proc_reviews_basis: string;
    proc_reviews_retention: string;
    vendor_transfer_title: string;
    vendor_transfer_body: string;
    cookies_necessary_label: string;
    cookies_functional_label: string;
    complaint_authority_title: string;
    complaint_authority_body: string;
    changes_title: string;
    changes_body: string;
    contact_title: string;
    contact_body: string;
    definitions_title: string;
    def_intro: string;
    def_personal_data: string;
    def_data_subject: string;
    def_processing: string;
    def_processor: string;
    def_consent: string;
    en_section_label: string;
  };
  /** /terms — short Terms of Service. Body kept brief because this is an
   *  open beta; review legalese will come with v2. */
  terms: {
    seo_title: string;
    seo_description: string;
    page_title: string;
    last_updated_label: string;
    last_updated_date: string;
    intro: string;
    beta_title: string;
    beta_body: string;
    accuracy_title: string;
    accuracy_body: string;
    /** Acceptable-use clause — what you may not do with the service.
     *  Stays short and concrete. */
    acceptable_use_title: string;
    acceptable_use_intro: string;
    acceptable_use_prohibited_illegal: string;
    acceptable_use_prohibited_infringing: string;
    acceptable_use_prohibited_hateful: string;
    acceptable_use_prohibited_security: string;
    acceptable_use_prohibited_spam: string;
    /** User-generated content — community supplier submissions, moodboard
     *  pin URLs, feedback, vendor waitlist content. Need a license grant
     *  + warranty so we can lawfully display it. */
    ugc_title: string;
    ugc_license_body: string;
    ugc_warranty_body: string;
    /** EU Digital Services Act (Regulation 2022/2065) notice & action
     *  procedure + designated contact for authorities and users. Applies
     *  to all hosting services regardless of size. */
    dsa_title: string;
    dsa_body: string;
    dsa_contact: string;
    directory_title: string;
    directory_body: string;
    /** How an entry gets into the directory, and what it does NOT mean
     *  (no partnership, no endorsement, no fee). Pairs with the privacy
     *  policy's Art. 14 chapter, which carries the legal detail. */
    directory_listing_policy_title: string;
    directory_listing_policy_body: string;
    /** Consumer-review transparency (Fttv. / Omnibus Directive
     *  2019/2161): who may review, what the Verified badge does and does
     *  not prove, and that we never claim every review is from a
     *  confirmed customer. */
    reviews_title: string;
    reviews_body: string;
    /** Liability limitation appropriate for a free beta. */
    liability_title: string;
    liability_body: string;
    /** Grounds + procedure for either side ending the relationship. */
    termination_title: string;
    termination_body: string;
    /** How we change these terms going forward (notice, re-acceptance for
     *  material changes). */
    changes_title: string;
    changes_body: string;
    law_title: string;
    law_body: string;
    contact_title: string;
    contact_body: string;
    en_section_label: string;
  };
  /** /terms/vendor-subscription — DRAFT ÁSZF for the future paid vendor
   *  tier. Lawyer-review pending; rendered with the legal `draft_banner`.
   *  Linked from the /vendors page so the disclosure is one click from
   *  every waitlist signup. */
  subscription_terms: {
    seo_title: string;
    seo_description: string;
    page_title: string;
    last_updated_label: string;
    last_updated_date: string;
    intro: string;
    operator_title: string;
    operator_body: string;
    scope_title: string;
    scope_body: string;
    acceptance_title: string;
    acceptance_body: string;
    /** Sits right after acceptance because it is the mirror image of it:
     *  what applies to a business that is IN the directory but has never
     *  accepted anything. Answers "you listed me without asking" with the
     *  legal basis and a concrete, dated remedy path. */
    unclaimed_title: string;
    unclaimed_body: string;
    /** Reviews on a listing the vendor has not claimed, and the vendor's
     *  remedies (flag, right of reply after claiming). */
    ratings_title: string;
    ratings_body: string;
    fees_title: string;
    fees_body: string;
    billing_title: string;
    billing_body: string;
    vat_title: string;
    vat_body: string;
    term_title: string;
    term_body: string;
    refund_title: string;
    refund_body: string;
    /** Korm. rendelet 45/2014. (II. 26.) 14-day withdrawal right for
     *  consumer-type subscribers + the immediate-start waiver clause. */
    withdrawal_title: string;
    withdrawal_body: string;
    sla_title: string;
    sla_body: string;
    ranking_title: string;
    ranking_body: string;
    differential_title: string;
    differential_body: string;
    data_access_title: string;
    data_access_body: string;
    ip_title: string;
    ip_body: string;
    indemnification_title: string;
    indemnification_body: string;
    moderation_title: string;
    moderation_body: string;
    liability_title: string;
    liability_body: string;
    data_title: string;
    data_body: string;
    complaints_title: string;
    complaints_body: string;
    mediation_title: string;
    mediation_body: string;
    force_majeure_title: string;
    force_majeure_body: string;
    assignment_title: string;
    assignment_body: string;
    changes_title: string;
    changes_body: string;
    termination_title: string;
    termination_body: string;
    offboarding_title: string;
    offboarding_body: string;
    transitional_title: string;
    transitional_body: string;
    governing_law_title: string;
    governing_law_body: string;
    /** EU 524/2013 link to the online dispute resolution platform. */
    odr_title: string;
    odr_body: string;
    contact_title: string;
    contact_body: string;
    en_section_label: string;
  };
  /** /impresszum — Hungarian Ektv. §4 imprint page. Lists operator
   *  identity + contact + hosting provider. During the open beta the
   *  operator is a natural person; the values here update when we
   *  register commercially (EV / Kft.). */
  imprint: {
    seo_title: string;
    seo_description: string;
    page_title: string;
    last_updated_label: string;
    last_updated_date: string;
    intro: string;
    operator_title: string;
    operator_name_label: string;
    operator_name_value: string;
    operator_status_label: string;
    operator_status_value: string;
    operator_country_label: string;
    operator_country_value: string;
    operator_email_label: string;
    operator_email_value: string;
    controller_title: string;
    controller_body: string;
    hosting_title: string;
    hosting_body: string;
    complaints_title: string;
    complaints_body: string;
  };
  /** /about — who built Weddly. `founder_placeholder` holds the founder's
   *  name per locale and is templated into `paragraph_made_in`. */
  about: {
    seo_title: string;
    seo_description: string;
    page_title: string;
    last_updated_label: string;
    last_updated_date: string;
    /** Body paragraphs as a single string each — kept plain so the page
     *  doesn't need a markdown library. */
    paragraph_made_in: string;
    paragraph_why: string;
    paragraph_contact_label: string;
    paragraph_contact_email: string;
    paragraph_contact_cta: string;
    paragraph_principles_title: string;
    principle_calm: string;
    principle_no_lock_in: string;
    en_section_label: string;
    /** Placeholder founder name — replace before going public. */
    founder_placeholder: string;
    founder_first_name: string;
    founder_role: string;
    photo_alt: string;
  };
  /** Public-facing blog index and post pages. Body content lives in the
   *  `blog_posts` DB table; these are the chrome strings around it. */
  blog: {
    eyebrow: string;
    index_title: string;
    index_lead: string;
    index_seo_title: string;
    index_seo_description: string;
    /** Read-time pill on cards and post headers. Uses {n} placeholder. */
    read_minutes: string;
    related_eyebrow: string;
    back_to_index: string;
    /** CTA for the LandingPage teaser block. */
    section_cta: string;
    /** Tri-state loading / error / empty messages for the public blog
     *  surfaces (index, post, landing teaser) — the API is fetched at
     *  runtime so we need real strings for each branch. */
    loading: string;
    load_failed: string;
    empty: string;
  };
  /** Admin-only blog CRUD page chrome (/app/admin/blog). */
  admin_blog: {
    seo_title: string;
    seo_description: string;
    page_title: string;
    page_subtitle: string;
    new_post: string;
    edit_post: string;
    new_post_subtitle: string;
    empty_title: string;
    empty_body: string;
    col_title: string;
    col_slug: string;
    col_status: string;
    col_date: string;
    status_published: string;
    status_draft: string;
    edit: string;
    delete: string;
    cancel: string;
    save: string;
    saving: string;
    saved: string;
    save_failed: string;
    deleted: string;
    delete_confirm_title: string;
    delete_confirm_body: string;
    back_to_list: string;
    field_slug: string;
    field_published_at: string;
    field_read_minutes: string;
    field_publish_state: string;
    publish_toggle: string;
    section_cover: string;
    section_cover_help: string;
    cover_constraints: string;
    cover_remove: string;
    cover_uploaded: string;
    save_before_upload: string;
    locale_hu: string;
    locale_en: string;
    field_category: string;
    field_title: string;
    field_lead: string;
    field_seo_title: string;
    field_seo_description: string;
    section_body: string;
    body_empty: string;
    block_p: string;
    block_h2: string;
    block_h3: string;
    block_ul: string;
    block_blockquote: string;
    block_img: string;
    block_cta: string;
    add_p: string;
    add_h2: string;
    add_h3: string;
    add_ul: string;
    add_blockquote: string;
    add_img: string;
    add_cta: string;
    add_ul_item: string;
    blockquote_text: string;
    blockquote_text_placeholder: string;
    blockquote_cite: string;
    cta_lead: string;
    cta_label: string;
    cta_href: string;
    img_src: string;
    img_alt: string;
    img_caption: string;
    img_credit: string;
    img_credit_href: string;
    move_up: string;
    move_down: string;
    remove_block: string;
    remove_item: string;
  };
  /** Re-login modal that pops on 401 mid-session. Copy stays short — the
   *  user is mid-task and just needs to resume. */
  session: {
    expired_title: string;
    expired_body: string;
    sign_in: string;
    sign_out: string;
    or_divider: string;
    continue_with_google: string;
    wrong_account: string;
  };
  /** Network resilience surface — toasts when fetch fails, timeouts, etc. */
  network: {
    offline_banner: string;
    request_failed: string;
    request_timeout: string;
    retry: string;
  };
  /** Workspace-switcher chip in the AppShell header. Strings shared
   *  with the Profile "Workspaces" panel where appropriate. */
  workspace: {
    switcher_aria: string;
    active_marker: string;
    create_link: string;
  };
  /** Desktop-only keyboard-shortcut help sheet — opens with `?` or via the
   *  Keyboard icon button in /app's header. Hidden on touch widths. */
  shortcuts: {
    title: string;
    hint: string;
    close: string;
    group_global: string;
    group_seating: string;
    group_rsvp: string;
    global_help: string;
    global_dismiss: string;
    seating_new_table: string;
    seating_move: string;
    seating_fine: string;
    seating_seats: string;
    seating_delete: string;
    rsvp_keyboard_mode: string;
  };
  /** First-run coach-marks shown on mobile only, once per device. Three
   *  steps surface the bottom-nav, the More sheet, and the partner-invite
   *  section so cohort C (older relatives) don't miss them. */
  coach: {
    bottom_nav_title: string;
    bottom_nav_body: string;
    more_button_title: string;
    more_button_body: string;
    partner_invite_title: string;
    partner_invite_body: string;
    next: string;
    done: string;
    skip: string;
    step_position: string;
  };
  /** Feature tour triggered via the Sparkles button in the top nav.
   *  One step per major Weddly surface — spotlights the sidebar link and
   *  explains what the surface does. */
  tour: {
    dashboard_title: string;
    dashboard_body: string;
    dashboard_p1_title: string;
    dashboard_p1_body: string;
    dashboard_p2_title: string;
    dashboard_p2_body: string;
    dashboard_p3_title: string;
    dashboard_p3_body: string;
    guests_title: string;
    guests_body: string;
    guests_p1_title: string;
    guests_p1_body: string;
    guests_p2_title: string;
    guests_p2_body: string;
    guests_p3_title: string;
    guests_p3_body: string;
    guests_p4_title: string;
    guests_p4_body: string;
    budget_title: string;
    budget_body: string;
    budget_p1_title: string;
    budget_p1_body: string;
    budget_p2_title: string;
    budget_p2_body: string;
    budget_p3_title: string;
    budget_p3_body: string;
    vendors_title: string;
    vendors_body: string;
    vendors_p1_title: string;
    vendors_p1_body: string;
    vendors_p2_title: string;
    vendors_p2_body: string;
    vendors_p3_title: string;
    vendors_p3_body: string;
    planning_title: string;
    planning_body: string;
    planning_p1_title: string;
    planning_p1_body: string;
    planning_p2_title: string;
    planning_p2_body: string;
    planning_p3_title: string;
    planning_p3_body: string;
    schedule_title: string;
    schedule_body: string;
    schedule_p1_title: string;
    schedule_p1_body: string;
    schedule_p2_title: string;
    schedule_p2_body: string;
    schedule_p3_title: string;
    schedule_p3_body: string;
    seating_title: string;
    seating_body: string;
    seating_p1_title: string;
    seating_p1_body: string;
    seating_p2_title: string;
    seating_p2_body: string;
    seating_p3_title: string;
    seating_p3_body: string;
    seating_p4_title: string;
    seating_p4_body: string;
    design_title: string;
    design_body: string;
    design_p1_title: string;
    design_p1_body: string;
    design_p2_title: string;
    design_p2_body: string;
    design_p3_title: string;
    design_p3_body: string;
    timeline_title: string;
    timeline_body: string;
    timeline_p1_title: string;
    timeline_p1_body: string;
    timeline_p2_title: string;
    timeline_p2_body: string;
    timeline_p3_title: string;
    timeline_p3_body: string;
    logistics_title: string;
    logistics_body: string;
    logistics_p1_title: string;
    logistics_p1_body: string;
    logistics_p2_title: string;
    logistics_p2_body: string;
    logistics_p3_title: string;
    logistics_p3_body: string;
    moodboard_title: string;
    moodboard_body: string;
    moodboard_p1_title: string;
    moodboard_p1_body: string;
    moodboard_p2_title: string;
    moodboard_p2_body: string;
    moodboard_p3_title: string;
    moodboard_p3_body: string;
    honeymoon_title: string;
    honeymoon_body: string;
    honeymoon_p1_title: string;
    honeymoon_p1_body: string;
    honeymoon_p2_title: string;
    honeymoon_p2_body: string;
    honeymoon_p3_title: string;
    honeymoon_p3_body: string;
    media_title: string;
    media_body: string;
    media_p1_title: string;
    media_p1_body: string;
    media_p2_title: string;
    media_p2_body: string;
    media_p3_title: string;
    media_p3_body: string;
    wishlist_title: string;
    wishlist_body: string;
    wishlist_p1_title: string;
    wishlist_p1_body: string;
    wishlist_p2_title: string;
    wishlist_p2_body: string;
    wishlist_p3_title: string;
    wishlist_p3_body: string;
    guest_page_title: string;
    guest_page_body: string;
    guest_page_p1_title: string;
    guest_page_p1_body: string;
    guest_page_p2_title: string;
    guest_page_p2_body: string;
    guest_page_p3_title: string;
    guest_page_p3_body: string;
    step_position: string;
    skip: string;
    done: string;
    next: string;
    aria_label: string;
  };
  /** /app chrome shown while the active workspace is a demo couple (is_demo).
   *  Two surfaces: a persistent banner across the top of /app, and a
   *  conversion popup that fires a few minutes in. Strings live here (not
   *  under `landing.*`) because they render inside the authenticated shell. */
  demo: {
    banner_title: string;
    banner_exit: string;
    banner_cta: string;
    banner_dismiss_aria: string;
    popup_title: string;
    popup_body: string;
    popup_cta: string;
    popup_microcopy: string;
  };
  /** Planner-side demo (Fairy Godmother Weddings sandbox) — banner + nudge
   *  inside /app/planner while the active session is the demo planner. */
  planner_demo: {
    banner_title: string;
    banner_exit: string;
    banner_cta: string;
    banner_dismiss_aria: string;
    popup_title: string;
    popup_body: string;
    popup_cta: string;
    popup_microcopy: string;
  };
  /** Vendor-side demo (Shrek-themed bakery sandbox): banner + nudge inside
   *  /vendor while the active session is the demo vendor. */
  vendor_demo: {
    banner_title: string;
    banner_exit: string;
    banner_cta: string;
    banner_dismiss_aria: string;
    popup_title: string;
    popup_body: string;
    popup_cta: string;
    popup_microcopy: string;
  };
  /** Standalone, SEO-targeted tool pages mounted at /eszkozok/* — public
   *  surfaces that double as ranking pages for long-tail Hungarian wedding
   *  queries Weddly can plausibly own (calculators, generators, templates). */
  tools: {
    budget_calculator: {
      page_eyebrow: string;
      page_h1: string;
      page_intro: string;
      averages_h2: string;
      averages_body: string;
      averages_source_note: string;
      ratios_h2: string;
      ratios_body: string;
      tips_h2: string;
      tips_li_1: string;
      tips_li_2: string;
      tips_li_3: string;
      cta_h2: string;
      cta_body: string;
      cta_button: string;
      faq_h2: string;
    };
    countdown: {
      page_eyebrow: string;
      page_h1: string;
      page_intro: string;
      input_label: string;
      result_days_unit: string;
      result_days_unit_one: string;
      result_until: string;
      result_passed: string;
      result_empty: string;
      breakdown_months: string;
      breakdown_weeks: string;
      breakdown_days: string;
      milestones_h2: string;
      milestone_12m: string;
      milestone_9m: string;
      milestone_6m: string;
      milestone_3m: string;
      milestone_1m: string;
      milestone_1w: string;
      cta_h2: string;
      cta_body: string;
      cta_button: string;
      faq_h2: string;
    };
    guest_list_template: {
      page_eyebrow: string;
      page_h1: string;
      page_intro: string;
      preview_h2: string;
      preview_caption: string;
      col_first_name: string;
      col_last_name: string;
      col_email: string;
      col_phone: string;
      col_household: string;
      col_diet: string;
      col_plus_one: string;
      col_status: string;
      download_h2: string;
      download_body: string;
      download_csv_btn: string;
      download_csv_hint: string;
      organization_h2: string;
      organization_li_1: string;
      organization_li_2: string;
      organization_li_3: string;
      cta_h2: string;
      cta_body: string;
      cta_button: string;
      faq_h2: string;
    };
    seating_chart: {
      page_eyebrow: string;
      page_h1: string;
      page_intro: string;
      what_h2: string;
      what_body: string;
      print_h2: string;
      print_body: string;
      print_li_a4: string;
      print_li_a6: string;
      print_li_a3: string;
      etiquette_h2: string;
      etiquette_li_1: string;
      etiquette_li_2: string;
      etiquette_li_3: string;
      etiquette_li_4: string;
      cta_h2: string;
      cta_body: string;
      cta_button: string;
      faq_h2: string;
    };
    rsvp_generator: {
      page_eyebrow: string;
      page_h1: string;
      page_intro: string;
      form_h2: string;
      form_partner_a_label: string;
      form_partner_a_placeholder: string;
      form_partner_b_label: string;
      form_partner_b_placeholder: string;
      form_date_label: string;
      form_venue_label: string;
      form_venue_placeholder: string;
      form_deadline_label: string;
      style_h2: string;
      style_formal: string;
      style_casual: string;
      style_poetic: string;
      output_h2: string;
      output_copy_btn: string;
      output_copied: string;
      cta_h2: string;
      cta_body: string;
      cta_button: string;
      faq_h2: string;
    };
    couple_cards: {
      page_eyebrow: string;
      page_h1: string;
      page_intro: string;
      decks_h2: string;
      deck_number_label: string;
      deck_count_label: string;
      deck_soon_label: string;
      deck_firstdate_title: string;
      deck_firstdate_blurb: string;
      deck_roots_title: string;
      deck_roots_blurb: string;
      deck_everyday_title: string;
      deck_everyday_blurb: string;
      deck_closeness_title: string;
      deck_closeness_blurb: string;
      deck_deepwater_title: string;
      deck_deepwater_blurb: string;
      deck_lemonade_title: string;
      deck_lemonade_blurb: string;
      card_position: string;
      card_empty: string;
      next_card: string;
      flip_card: string;
      draw_card: string;
      reshuffle: string;
      back_to_decks: string;
      lock_view: string;
      unlock_view: string;
      shuffle_random: string;
      previous_card: string;
      feedback_bad: string;
      feedback_ok: string;
      feedback_great: string;
      suggest_open: string;
      suggest_close: string;
      suggest_title: string;
      suggest_blurb: string;
      suggest_placeholder: string;
      suggest_submit: string;
      suggest_submitting: string;
      suggest_thanks: string;
      suggest_error: string;
      cta_h2: string;
      cta_body: string;
      cta_button: string;
      faq_h2: string;
    };
  };
  planners: {
    eyebrow: string;
    hero_title: string;
    hero_cta: string;
    demo_cta: string;
    demo_loading: string;
    demo_error: string;
    couple_escape: string;
    couple_escape_link: string;
    pricing_eyebrow: string;
    pricing_title: string;
    pricing_trial: string;
    pricing_active_note: string;
    billing_monthly: string;
    billing_annual: string;
    billing_save: string;
    plan_annual_billed: string;
    plan_basic_name: string;
    plan_basic_price: string;
    plan_basic_period: string;
    plan_basic_annual_price: string;
    plan_basic_annual_permonth: string;
    plan_basic_couples: string;
    plan_basic_couple_count: string;
    plan_basic_couple_label: string;
    plan_basic_guests: string;
    plan_basic_feature_1: string;
    plan_basic_feature_2: string;
    plan_basic_feature_3: string;
    plan_basic_excl_1: string;
    plan_basic_excl_2: string;
    plan_pro_name: string;
    plan_pro_price: string;
    plan_pro_period: string;
    plan_pro_annual_price: string;
    plan_pro_annual_permonth: string;
    plan_pro_couples: string;
    plan_pro_couple_count: string;
    plan_pro_couple_label: string;
    plan_pro_guests: string;
    plan_pro_badge: string;
    plan_pro_feature_1: string;
    plan_pro_feature_2: string;
    plan_pro_feature_3: string;
    plan_pro_feature_4: string;
    plan_pro_feature_5: string;
    plan_pro_excl_1: string;
    plan_unlimited_name: string;
    plan_unlimited_price: string;
    plan_unlimited_period: string;
    plan_unlimited_annual_price: string;
    plan_unlimited_annual_permonth: string;
    plan_unlimited_couples: string;
    plan_unlimited_couple_count: string;
    plan_unlimited_couple_label: string;
    plan_unlimited_guests: string;
    plan_unlimited_feature_1: string;
    plan_unlimited_feature_2: string;
    plan_unlimited_feature_3: string;
    plan_cta: string;
    step_indicator: string;
    step0_title: string;
    step1_title: string;
    step2_title: string;
    step3_title: string;
    step_label_plan: string;
    step_label_intro: string;
    step_label_business: string;
    step_label_usage: string;
    label_full_name: string;
    placeholder_full_name: string;
    label_email: string;
    placeholder_email: string;
    label_phone: string;
    placeholder_phone: string;
    label_company: string;
    placeholder_company: string;
    label_city: string;
    placeholder_city: string;
    label_website: string;
    placeholder_website: string;
    label_reference_links: string;
    placeholder_reference_links: string;
    label_km_radius: string;
    placeholder_km_radius: string;
    label_weddings_done: string;
    placeholder_weddings_done: string;
    label_style_intro: string;
    label_style_1: string;
    label_style_2: string;
    label_style_3: string;
    placeholder_style: string;
    label_other_style: string;
    placeholder_other_style: string;
    style_romantic: string;
    style_classic: string;
    style_rustic: string;
    style_modern: string;
    style_bohemian: string;
    style_elegant: string;
    style_vintage: string;
    style_outdoor: string;
    style_other: string;
    label_early_bird: string;
    early_bird_body: string;
    label_message: string;
    placeholder_message: string;
    privacy_consent_prefix: string;
    privacy_link: string;
    privacy_consent_suffix: string;
    submit: string;
    submitting: string;
    success_title: string;
    success_body: string;
    /** Variant when the applicant was signed in (grant already applied). */
    success_body_authed: string;
    success_cta_signup: string;
    success_cta_dashboard: string;
    /** Sign-in escape under the success CTA, for an applicant who turns out to
     *  already have an account (the page can't know, the mail can). */
    success_have_account: string;
    success_plan: string;
    back_home: string;
    not_a_planner: string;
    vendor_link: string;
    meta_title: string;
    meta_description: string;
    already_have_access: string;
    login_link: string;
    success_next_intro: string;
    success_follow: string;
    benefit_1_title: string;
    benefit_1_body: string;
    benefit_2_title: string;
    benefit_2_body: string;
    benefit_3_title: string;
    benefit_3_body: string;
    err_full_name: string;
    err_email: string;
    err_phone: string;
    err_privacy: string;
    err_plan: string;
    features_title: string;
    features_tagline: string;
    feature_guestlist_name: string;
    feature_guestlist_desc: string;
    feature_seating_name: string;
    feature_seating_desc: string;
    feature_tasks_name: string;
    feature_tasks_desc: string;
    feature_docs_name: string;
    feature_docs_desc: string;
    beta_badge: string;
    beta_eyebrow: string;
    beta_title: string;
    beta_body: string;
    beta_step_1_title: string;
    beta_step_1_body: string;
    beta_step_2_title: string;
    beta_step_2_body: string;
    beta_step_3_title: string;
    beta_step_3_body: string;
    step_label_contact: string;
    form_title: string;
    step1_cta: string;
    faq_title: string;
    faq_1_q: string;
    faq_1_a: string;
    faq_2_q: string;
    faq_2_a: string;
    faq_3_q: string;
    faq_3_a: string;
  };
  planner_nav: {
    greeting: string;
    dashboard: string;
    clients: string;
    calendar: string;
    stats: string;
    messages: string;
    settings: string;
    logout: string;
    collapse_sidebar: string;
    expand_sidebar: string;
  };
  planner_shell: {
    menu_label: string;
    menu_account: string;
    menu_plan: string;
  };
  planner_stats: {
    meta_title: string;
    meta_description: string;
    title: string;
    subtitle: string;
    kpi_active_clients: string;
    kpi_upcoming: string;
    kpi_completion: string;
    kpi_overdue: string;
    completion_title: string;
    plan_title: string;
    plan_usage: string;
    pending_title: string;
    pending_none: string;
    empty: string;
    tasks_total: string;
    view_client: string;
    completion_help: string;
    next_wedding: string;
    no_upcoming: string;
    upgrade_cta: string;
    pending_help: string;
    load_error: string;
    load_retry: string;
  };
  planner_calendar: {
    meta_title: string;
    meta_description: string;
    title: string;
    subtitle: string;
    today: string;
    prev_month: string;
    next_month: string;
    legend_weddings: string;
    legend_tasks: string;
    wedding_label: string;
    day_empty: string;
    upcoming_title: string;
    no_weddings: string;
    tasks_due: string;
    view_day: string;
    view_4day: string;
    view_week: string;
    view_month: string;
    view_year: string;
    view_schedule: string;
    mode_calendar: string;
    mode_tasks: string;
    tasks_title: string;
    tasks_empty: string;
    all_day: string;
    schedule_empty: string;
    nav_prev: string;
    nav_next: string;
    add_event: string;
    event_new_title: string;
    event_edit_title: string;
    field_title: string;
    field_date: string;
    field_time: string;
    field_time_end: string;
    field_time_end_invalid: string;
    field_client: string;
    field_client_none: string;
    field_notes: string;
    field_required: string;
    event_delete: string;
    event_saved: string;
    event_deleted: string;
    event_error: string;
    event_delete_confirm_title: string;
    event_delete_confirm_body: string;
    tasks_period_label: string;
    tasks_period_week: string;
    tasks_period_30: string;
    tasks_period_all: string;
    tasks_period_empty: string;
    tasks_count: string;
    tasks_view_list: string;
    tasks_view_board: string;
    tasks_search_placeholder: string;
    board_todo: string;
    board_doing: string;
    board_done: string;
    board_empty: string;
    board_move_prev: string;
    board_move_next: string;
    task_move_error: string;
    legend_events: string;
  };
  planner_clients_page: {
    meta_title: string;
    meta_description: string;
    title: string;
    subtitle: string;
    invite_section_title: string;
    invite_section_hint: string;
    invite_placeholder: string;
    invite_button: string;
    invite_sent: string;
    invite_request_sent: string;
    invite_error_duplicate: string;
    invite_error_limit: string;
    invite_error_generic: string;
    invite_revoked: string;
    status_pending: string;
    status_accepted: string;
    revoke_button: string;
    revoke_confirm_title: string;
    revoke_confirm_body: string;
  };
  planner_home: {
    title: string;
    load_error: string;
    load_retry: string;
    checklist_title: string;
    checklist_progress: string;
    checklist_dismiss: string;
    checklist_step_profile: string;
    checklist_step_client: string;
    checklist_step_message: string;
    checklist_cta_profile: string;
    checklist_cta_client: string;
    checklist_cta_message: string;
    welcome: string;
    subtitle: string;
    clients_heading: string;
    clients_empty: string;
    coming_soon: string;
    feature_clients: string;
    feature_clients_desc: string;
    feature_timeline: string;
    feature_timeline_desc: string;
    feature_runsheet: string;
    feature_runsheet_desc: string;
    logout: string;
    viewing_client: string;
    back_to_planner: string;
    add_client_heading: string;
    add_client_placeholder: string;
    add_client_button: string;
    add_client_success: string;
    add_client_error: string;
    enter_workspace: string;
    client_wedding_date_none: string;
    client_guests: string;
    clients_roster_heading: string;
    notes_placeholder: string;
    notes_saved: string;
    notes_add: string;
    upcoming_heading: string;
    upcoming_empty: string;
    task_summary: string;
    task_summary_ok: string;
    card_health_ok: string;
    card_health_overdue: string;
    messages_link: string;
    profile_link: string;
    back_label: string;
    invites_heading: string;
    invite_accept: string;
    invite_decline: string;
    invite_decline_confirm_title: string;
    invite_decline_confirm_body: string;
    kpi_active_clients: string;
    kpi_total_tasks: string;
    kpi_overdue: string;
    kpi_due_this_week: string;
    plan_chip: string;
    chart_heading: string;
    chart_done_label: string;
    chart_overdue_label: string;
    chart_week_label: string;
    chart_remaining_label: string;
    chart_show_more: string;
    chart_show_less: string;
    filter_all_clients: string;
    filter_toggle: string;
    filter_priority_all: string;
    filter_priority_high: string;
    filter_priority_medium: string;
    filter_timing_all: string;
    filter_timing_week: string;
    filter_timing_overdue: string;
    filter_clients_count: string;
    filter_clear: string;
    topbar_greeting_urgent: string;
    topbar_notif_aria: string;
    topbar_profile_aria: string;
    topbar_profile_link: string;
    topbar_logout: string;
    topbar_back_to_landing: string;
    topbar_feedback: string;
    rail_today_title: string;
    rail_today_nameday: string;
    rail_today_empty: string;
    rail_urgent_title: string;
    rail_collapse: string;
    rail_expand: string;
    rail_all_good: string;
    rail_more_overdue: string;
    rail_more_today: string;
    rail_overdue_yesterday: string;
    rail_overdue_days: string;
    rail_mark_done: string;
    pipeline_title: string;
    pipeline_add_btn: string;
    pipeline_pending_invites: string;
    pipeline_days_until: string;
    pipeline_today: string;
    pipeline_days_ago: string;
    pipeline_guests: string;
    pipeline_tasks_done: string;
    pipeline_tasks_overdue: string;
    pipeline_enter: string;
    pipeline_pending: string;
    pipeline_empty_title: string;
    pipeline_empty_body: string;
    pipeline_notes_add: string;
    pipeline_entering: string;
    meta_title: string;
    meta_description: string;
    topbar_clients_aria: string;
    notif_heading: string;
    notif_none: string;
    notif_overdue: string;
    notif_invites: string;
    notif_messages_link: string;
    rail_all_good_body: string;
    add_client_hint: string;
    checklist_step_done: string;
    kpi_caption: string;
    upcoming_empty_encouraging: string;
    upcoming_empty_filtered: string;
  };
  planner_onboarding: {
    step_indicator: string;
    step_label_profile: string;
    step_label_package: string;
    step_label_client: string;
    step1_title: string;
    step1_body: string;
    step1_cta: string;
    step2_title: string;
    step2_body: string;
    full_name_label: string;
    business_name_label: string;
    business_name_required: string;
    city_label: string;
    city_required: string;
    phone_label: string;
    website_label: string;
    bio_label: string;
    bio_placeholder: string;
    bio_chars_remaining: string;
    save_error: string;
    step3_title: string;
    step3_body: string;
    plan_starter_name: string;
    plan_starter_clients: string;
    plan_starter_tagline: string;
    plan_pro_name: string;
    plan_pro_clients: string;
    plan_pro_tagline: string;
    plan_premium_name: string;
    plan_premium_clients: string;
    plan_premium_tagline: string;
    plan_active_badge: string;
    plan_coming_soon: string;
    step4_title: string;
    step4_body: string;
    first_client_label: string;
    first_client_placeholder: string;
    first_client_add: string;
    first_client_adding: string;
    first_client_success: string;
    first_client_error: string;
    skip: string;
    step5_title: string;
    step5_body: string;
    step5_cta: string;
    meta_title: string;
    meta_description: string;
    later: string;
    first_client_hint: string;
    prefill_banner_title: string;
    prefill_banner_body: string;
    prefill_review_title: string;
    prefill_review_body: string;
    prefill_confirm_cta: string;
    prefill_summary_title: string;
    summary_weddings: string;
    summary_radius: string;
    summary_km_unit: string;
    summary_styles: string;
  };
  planner_messages: {
    heading: string;
    back: string;
    inbox_empty: string;
    empty_add_client_cta: string;
    select_client: string;
    compose_heading: string;
    field_to: string;
    field_subject: string;
    field_body: string;
    send: string;
    sending: string;
    sent_ok: string;
    error_send: string;
    thread_heading: string;
    msg_sent: string;
    msg_received: string;
    no_messages: string;
    to_placeholder: string;
    subject_placeholder: string;
    body_placeholder: string;
    meta_title: string;
    meta_description: string;
    empty_no_clients: string;
    empty_back_cta: string;
    first_message_cta: string;
  };
  planner_client: {
    back_label: string;
    contact_heading: string;
    phone_label: string;
    alt_email_label: string;
    lead_source_label: string;
    lead_source_placeholder: string;
    financial_heading: string;
    contract_value_label: string;
    deposit_paid_label: string;
    balance_label: string;
    notes_heading: string;
    notes_placeholder: string;
    note_add_button: string;
    notes_empty: string;
    note_delete_aria: string;
    save_button: string;
    save_success: string;
    enter_workspace: string;
    quick_call: string;
    quick_email: string;
    quick_whatsapp: string;
    stage_label: string;
    stage_inquiry: string;
    stage_proposal: string;
    stage_deposit: string;
    stage_active: string;
    stage_completed: string;
    stage_archived: string;
    no_phone: string;
    /** Guest-page (vendégoldal) editing control: the planner switches the
     *  couple's own guest-page editing on once they've prepaid the add-on. */
    guest_page_heading: string;
    guest_page_desc: string;
    guest_page_locked: string;
    guest_page_toggle_aria: string;
    guest_page_on: string;
    guest_page_off: string;
    guest_page_enable_success: string;
    guest_page_disable_success: string;
    guest_page_not_prepaid: string;
    guest_page_error: string;
    tasks_heading: string;
    tasks_empty: string;
    danger_heading: string;
    remove_explain: string;
    remove_button: string;
    remove_arm_prompt: string;
    remove_arm_continue: string;
    remove_confirm_title: string;
    remove_confirm_body: string;
    remove_success: string;
  };
  planner_clients: {
    wedding_label: string;
  };
  /** Free official business-registry lookup (planner onboarding + settings).
   *  Copy is country-agnostic; the search kinds come from the backend. */
  company_lookup: {
    title: string;
    /** {kinds} = localised query kinds joined with " / ". */
    subtitle: string;
    kind_name: string;
    kind_tax_number: string;
    kind_registry_number: string;
    search_button: string;
    searching: string;
    no_results: string;
    error_upstream: string;
    use_button: string;
    status_active: string;
    status_inactive: string;
    manual_hint: string;
    /** {source} = official source attribution from the backend. */
    source_label: string;
    filled_toast: string;
  };
  geo: {
    /** OSM licence line shown under the address suggestion list. */
    address_attribution: string;
  };
  planner_profile: {
    heading: string;
    full_name_label: string;
    business_name_label: string;
    city_label: string;
    phone_label: string;
    website_label: string;
    country_label: string;
    registry_number_label: string;
    vat_number_label: string;
    legal_form_label: string;
    address_label: string;
    bio_label: string;
    bio_placeholder: string;
    /** The style picker on the account tab. The style NAMES come from the
     *  `planners.style_*` keys the /planners application already uses, since the
     *  stored slugs are the same vocabulary. `styles_hint` receives `{max}`. */
    styles_label: string;
    styles_hint: string;
    availability_label: string;
    availability_placeholder: string;
    availability_help: string;
    save_button: string;
    save_success: string;
    tabs_aria: string;
    tab_account: string;
    tab_offerings: string;
    /** Public-profile nudge on the planner dashboard: the showcase sections a
     *  couple meets (photos / packages / availability) that this planner has
     *  not filled in yet. Deliberately separate from the getting-started
     *  checklist, which is dismissible and about the account. */
    nudge_title: string;
    nudge_body: string;
    nudge_cta: string;
    nudge_photo: string;
    nudge_package: string;
    nudge_availability: string;
    tab_subscription: string;
    tab_data: string;
    subscription_heading: string;
    subscription_plan_label: string;
    subscription_clients_label: string;
    subscription_upgrade_cta: string;
    subscription_no_billing: string;
    data_heading: string;
    data_export_button: string;
    data_delete_heading: string;
    data_delete_body: string;
    data_delete_button: string;
    meta_title: string;
    meta_description: string;
    load_error: string;
    load_retry: string;
    badge_planner: string;
    avatar_change: string;
    avatar_remove: string;
    avatar_saved: string;
    avatar_error: string;
    avatar_invalid: string;
    avatar_hint: string;
    references_title: string;
    references_subtitle: string;
    references_empty: string;
    reference_title_ph: string;
    reference_desc_ph: string;
    reference_image: string;
    reference_add: string;
    reference_adding: string;
    reference_delete: string;
    reference_need_text: string;
  };
  /** Weddly Points, planner side. The rules, the values and the perk lines all
   *  render from `shared/planner_points.ts`, so no point value or threshold is
   *  ever written into the copy here.
   *
   *  The tier NAMES are deliberately absent: Blue / Gold / Platinum / Black is
   *  one shared vocabulary with the vendor ladder and lives at
   *  `vendor.points.tier.*`, which `TierBadge` already reads. A second copy for
   *  planners would only be a second place to drift. */
  planner_points: {
    /** Small label above the total. */
    label: string;
    /** Accessible name of the tier progress ring. */
    ring_label: string;
    /** Receives `{points}` + `{tier}`: how far to the next tier. */
    to_next: string;
    /** Shown instead of `to_next` at the highest tier. */
    at_top: string;
    /** Opens the earning rules. */
    how_to_earn: string;
    /** One line per rule in PLANNER_EARNABLE_EVENTS, keyed `earn_<event>`. The
     *  point value is rendered from PLANNER_POINTS_BY_EVENT, never written in. */
    earn_profile_completeness: string;
    earn_first_review: string;
    earn_review_collected: string;
    earn_client_linked: string;
    earn_couple_invited: string;
    /** Lifetime points from one rule. Receives `{n}`. */
    earned_so_far: string;
    /** Lead-in to the next tier's perks. Receives `{tier}`. */
    next_unlocks: string;
    /** Perk lines. Only the perks a tier actually holds are listed. */
    perk_directory: string;
    perk_badge: string;
    /** The planner's place among the planners a couple can find. The country
     *  variant receives `{rank}`, `{total}` and `{country}` (a display name from
     *  `countryName`, never an ISO code); the `_all` variant is for a planner
     *  with no country set, who is ranked against the whole pool rather than
     *  dropped. */
    rank_position_country: string;
    rank_position_all: string;
    /** How far behind the planner immediately above. Receives `{points}`. */
    rank_gap: string;
  };
  /** The planner's profile setup checklist on /app/planner/settings/account.
   *  Steps are keyed `step_<PlannerChecklistStep>` and the percentage comes from
   *  `plannerChecklistCompleteness`, the same helper the points engine awards
   *  its 25% milestones from. Distinct from `planner_profile.nudge_*`, which is
   *  the shorter dashboard version and disappears once finished. */
  planner_setup: {
    title: string;
    body: string;
    /** Accessible name of the completeness ring. */
    ring_label: string;
    /** Receives `{pct}`. */
    progress: string;
    /** Per-row call to action on an unfinished step. */
    cta: string;
    /** Receives `{points}`: what one 25% milestone pays. */
    points_hint: string;
    /** The finished state. Kept rather than hidden, so the page does not lose
     *  its progress block the moment it is earned. */
    done_title: string;
    done_body: string;
    step_business_name: string;
    step_city: string;
    step_bio: string;
    step_styles: string;
    step_has_photo: string;
    step_has_package: string;
    step_has_availability: string;
  };
  planner_billing: {
    meta_title: string;
    meta_description: string;
    price_soon: string;
    price_note: string;
    notify_cta: string;
    notify_done: string;
    notify_toast: string;
    feat_clients: string;
    feat_messaging: string;
    feat_calendar: string;
    feat_stats: string;
    feat_references: string;
    feat_priority_support: string;
    /** "{price}/mo" — price already currency-formatted by the component. */
    price_per_month: string;
    /** "{n} of 25 free founding spots left". */
    founding_spots: string;
    /** Status banner lines. `state_founding` takes {date}; `state_trial` {days}. */
    state_founding: string;
    state_trial: string;
    state_active: string;
    state_past_due: string;
    state_readonly: string;
    /** Short chip variants (no interpolation) for the settings status pill. */
    state_trial_short: string;
    state_readonly_short: string;
    renews_on: string;
    compare_hint: string;
    /** Plan-card CTAs. */
    cta_subscribe: string;
    cta_current: string;
    cta_switch: string;
    manage_cta: string;
    /** Shown on the cards while Stripe billing isn't wired server-side yet. */
    disabled_note: string;
    checkout_error: string;
  };
  planner_settings: {
    reference_add_toggle: string;
    reference_form_close: string;
    data_export_heading: string;
    data_export_desc: string;
    data_export_soon: string;
    data_delete_desc: string;
  };
  /** Couple-facing planner directory rail on /app/vendors. */
  planner_directory: {
    title: string;
    subtitle: string;
    connect: string;
    invited: string;
    approve: string;
    linked: string;
    /** "{n} weddings a year" chip on the planner card. */
    weddings_per_year: string;
    website_aria: string;
    website: string;
    km_radius: string;
    availability_label: string;
    references_label: string;
    view_profile: string;
    /** Tooltip/aria on the azure "verified" badge next to a planner's name. */
    verified: string;
    /** Same badge, drawn as an outline: verified account, profile still
     *  half-filled. See `<VerifiedBadge>`. */
    verified_incomplete: string;
    /** Full planner detail page (/app/planners/:id). */
    back: string;
    about_label: string;
    styles_label: string;
    not_found: string;
    pricing_label: string;
    contact_label: string;
    phone_label: string;
    email_label: string;
    address_label: string;
    package_download: string;
    busy_label: string;
    /** "Next free date: {date}". */
    busy_next_free: string;
  };
  /** Shared read/edit availability month-grid (AvailabilityCalendar). */
  availability_calendar: {
    prev_month: string;
    next_month: string;
    legend_booked: string;
    legend_free_hint: string;
    empty: string;
    /** "Mark {date} as booked". */
    block_aria: string;
    /** "Mark {date} as free". */
    unblock_aria: string;
  };
  /** Planner "Offerings" settings tab: price packages + availability editor. */
  planner_offerings: {
    pricing_title: string;
    pricing_subtitle: string;
    add_package: string;
    packages_full: string;
    new_package_default: string;
    package_name_label: string;
    package_price_label: string;
    package_price_placeholder: string;
    package_description_label: string;
    package_pdf_label: string;
    package_pdf_upload: string;
    package_pdf_replace: string;
    package_pdf_remove: string;
    package_delete: string;
    package_delete_confirm: string;
    package_saved: string;
    package_deleted: string;
    pdf_uploaded: string;
    pdf_removed: string;
    pdf_too_large: string;
    pdf_invalid: string;
    save_error: string;
    availability_title: string;
    availability_subtitle: string;
    /** "Next free date: {date}". */
    availability_next_free: string;
    availability_none_free: string;
    availability_error: string;
    note_title: string;
    note_subtitle: string;
    note_placeholder: string;
    note_saved: string;
  };
  couple_planners: {
    heading: string;
    empty: string;
    invite_heading: string;
    invite_placeholder: string;
    invite_button: string;
    invite_success: string;
    invite_error_not_found: string;
    invite_error_duplicate: string;
    status_active: string;
    status_pending: string;
    status_requested: string;
    accept_button: string;
    decline_button: string;
    revoke_button: string;
    revoke_confirm: string;
    approval_banner_title: string;
    approval_banner_body: string;
    approval_banner_cta: string;
  };
  guest_invites: {
    back_to_guests: string;
    title: string;
    subtitle: string;
    monitoring_title: string;
    guests_section_title: string;
    stat_total: string;
    stat_adults: string;
    stat_children: string;
    stat_babies: string;
    channel_section_title: string;
    invited_online: string;
    invited_physical: string;
    invited_both: string;
    not_invited: string;
    rsvp_title: string;
    rsvp_yes: string;
    rsvp_no: string;
    rsvp_maybe: string;
    rsvp_pending: string;
    col_name: string;
    col_channel: string;
    col_rsvp: string;
    col_responded: string;
    table_empty: string;
    channel_online: string;
    channel_physical: string;
    responded_never: string;
    comm_title: string;
    audience_label: string;
    audience_all: string;
    audience_pending: string;
    audience_confirmed: string;
    /** Spells out who the picked audience is, with the headcount. The pills
     *  themselves only carry a number, so this line is the label. */
    audience_sending_all: string;
    audience_sending_pending: string;
    audience_sending_confirmed: string;
    /** Confirmation before an immediate, unrecallable send. */
    send_confirm_title: string;
    send_confirm_body_all: string;
    send_confirm_body_pending: string;
    send_confirm_body_confirmed: string;
    send_mode_schedule: string;
    /** Refusal when the clock toggle is on but no time has been picked: a
     *  scheduled send with no time would go out immediately. */
    schedule_required: string;
    schedule_label: string;
    send_now_button: string;
    schedule_button: string;
    sending: string;
    send_success: string;
    send_error: string;
    subject_required: string;
    body_required: string;
    subject_label: string;
    subject_placeholder: string;
    body_label: string;
    body_placeholder: string;
    template_invite: string;
    template_major_update: string;
    template_pre_wedding_info: string;
    invite_desc: string;
    major_update_desc: string;
    pre_wedding_desc: string;
    envelope_tip_title: string;
    envelope_tip_desc: string;
    envelope_tip_include: string;
    envelope_tip_mode_label: string;
    envelope_tip_auto: string;
    envelope_tip_manual: string;
    envelope_tip_amount_label: string;
    /** Per-head amount line. `{amount}` = formatted money. */
    envelope_tip_per_head: string;
    envelope_tip_none: string;
    envelope_tip_saved: string;
    envelope_tip_save_error: string;
    broadcasts_title: string;
    broadcasts_empty: string;
    /** `{count}` = recipient count. */
    recipients: string;
    /** `{date}` = formatted timestamp. */
    scheduled_for: string;
    /** `{date}` = formatted timestamp. */
    sent_on: string;
    status_scheduled: string;
    status_sending: string;
    status_sent: string;
    status_failed: string;
    cancel_button: string;
    cancel_confirm_title: string;
    cancel_confirm_body: string;
    cancel_confirm_yes: string;
    cancel_success: string;
  };
  /** Public, unauthenticated vendor page (`/vendors/:id`) — the shareable
   *  surface for people outside Weddly. */
  publicVendor: {
    signupCta: string;
    notFoundTitle: string;
    notFoundBody: string;
    browseCta: string;
    bandTitle: string;
    bandBody: string;
    bandCta: string;
    footerHome: string;
    footerVendors: string;
    footerAbout: string;
    nextAvailable: string;
    /** Shown only on listings nobody has claimed. This is the "appropriate
     *  measure" GDPR Art. 14(5)(b) asks for when the information cannot be
     *  delivered to each data subject individually: the notice sits on the
     *  page carrying their data, and links to the policy chapter, the free
     *  claim flow, and a human address. */
    ownerNoticeTitle: string;
    ownerNoticeBody: string;
    ownerNoticeClaim: string;
    ownerNoticeContact: string;
    ownerNoticePrivacy: string;
  };
  vendorBrowse: {
    title: string;
    subtitle: string;
    couples_stat: string;
    cta_couple: string;
    cta_vendor: string;
    empty: string;
    convert_title: string;
    convert_sub: string;
    vendor_prompt: string;
    /** Aria-label for the sticky category rail that indexes the page. */
    nav_categories: string;
    /** Rail header link into the whole category, and the paginated grid it
     *  opens: the visitor can now see every vendor, not a sample. */
    show_all: string;
    results_count: string;
    load_more: string;
    all_towns: string;
    /** Clears the ?city= filter a landing-page town pick arrives with. */
    city_filter_clear: string;
    /** Aria-label on the town picker beside the country one. */
    city_filter_label: string;
    /** Aria-labels for the desktop scrubbers on each category rail. */
    rail_prev: string;
    rail_next: string;
    /** Distinct planner module: planners are workspace collaborators, invited
     *  via /planners, not directory contacts. */
    planner_badge: string;
    planner_title: string;
    planner_body: string;
    planner_cta: string;
    planner_featured: string;
    /** "Nearby" block, appended when a town filter came back nearly empty.
     *  A one-card page reads as an empty directory, so the surrounding region
     *  is offered with the drive attached. `{city}` is the filtered town. */
    nearby_title: string;
    nearby_body: string;
    /** Distance suffix on a nearby card's meta line. `{km}` is a whole number
     *  of kilometres, straight-line from the filtered town. */
    distance_km: string;
  };
}
