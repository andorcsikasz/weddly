// Type-only contract for the locale tree. Both hu.ts and en.ts must satisfy this.

export interface LocaleMessages {
  common: {
    save: string;
    saving: string;
    edit: string;
    cancel: string;
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
    planning_title: string;
    planning_description: string;
    admin_suppliers_title: string;
    admin_suppliers_description: string;
    admin_feedback_title: string;
    admin_feedback_description: string;
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
  };
  /** Gantt-style task timeline + point-of-contact panel. */
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
    /** Edit drawer. */
    edit_title: string;
    field_start_date: string;
    field_due_date: string;
    field_supplier: string;
    supplier_none: string;
    /** Tooltip label on the vertical "today" marker. */
    today_label: string;
    error_dates: string;
    seo_title: string;
    seo_description: string;
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
    bad_credentials: string;
    duplicate_email: string;
    short_password: string;
    rate_limited: string;
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
    gate_open_inbox: string;
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
    bride_name_label: string;
    groom_name_label: string;
    partner_one_label: string;
    partner_two_label: string;
    step2_title: string;
    wedding_date_label: string;
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
    budget_currency_huf: string;
    budget_currency_eur: string;
    budget_currency_usd: string;
    // ── Ceremony kind — optional radio group on the Couple step ───────
    ceremony_kind_question: string;
    ceremony_kind_civil: string;
    ceremony_kind_religious: string;
    ceremony_kind_both: string;
    ceremony_kind_skip: string;
    ceremony_kind_help: string;
    // ── Already-onboarded welcome (partner B lands here after invite) ──
    welcome_existing_title: string;
    welcome_existing_body: string;
    welcome_existing_date_label: string;
    welcome_existing_guests_label: string;
    welcome_existing_budget_label: string;
    welcome_existing_style_label: string;
    welcome_existing_continue: string;
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
    feature_budget: string;
    feature_guests: string;
    feature_seating: string;
    feature_print: string;
    feature_suppliers: string;
    // ── KPI dashboard ────────────────────────────────────────────────
    kpi_days_label: string;
    kpi_days_unit: string;
    kpi_days_tbd: string;
    kpi_days_edit_hint: string;
    kpi_guests_label: string;
    kpi_guests_unit: string;
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
    tasks_title: string;
    tasks_progress: string;
    task_set_date: string;
    task_lock_budget: string;
    task_lock_guests: string;
    task_invite_partner: string;
    task_add_guests: string;
    task_get_rsvps: string;
    task_plan_budget: string;
    task_under_cap: string;
    task_add_tables: string;
    task_seat_guests: string;
    quick_links_title: string;
    /** "Next action" hero CTA above the KPIs. */
    next_action_label: string;
    /** Inline set-date dialog opened from the "Next step: lock the wedding date"
     *  CTA — keeps the user on the dashboard instead of bouncing to onboarding. */
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
  landing: {
    hero_title: string;
    hero_sub: string;
    cta_signup: string;
    cta_login: string;
    cta_signup_sub: string;
    faq_title: string;
    faq_q_free: string;
    faq_a_free: string;
    faq_q_partner: string;
    faq_a_partner: string;
    faq_q_data: string;
    faq_a_data: string;
    /** Retention Q&A — surfaces the pause / 30-day-grace policy so the
     *  question of "what happens to my workspace after the wedding" has
     *  a real answer on the landing page. */
    faq_q_after_wedding: string;
    faq_a_after_wedding: string;
    faq_q_planner: string;
    faq_a_planner: string;
    faq_q_ready: string;
    faq_a_ready: string;
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
    feedback_message_label: string;
    feedback_message_placeholder: string;
    feedback_rating_label: string;
    feedback_rating_hint: string;
    feedback_rating_low: string;
    feedback_rating_high: string;
    feedback_monthly_label: string;
    feedback_monthly_hint: string;
    feedback_monthly_zero: string;
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
    audience_sub: string;
    card_couples_title: string;
    card_couples_body: string;
    card_couples_cta: string;
    card_vendors_title: string;
    card_vendors_body: string;
    card_vendors_cta: string;
    card_guests_title: string;
    card_guests_body: string;
    card_guests_cta: string;
    suppliers_section_title: string;
    suppliers_section_body: string;
    suppliers_couple_cta: string;
    suppliers_vendor_cta: string;
    guest_sheet_title: string;
    guest_sheet_body: string;
    guest_sheet_label: string;
    guest_sheet_placeholder: string;
    guest_sheet_cta: string;
    guest_sheet_cancel: string;
    guest_sheet_invalid: string;
    footer_tagline: string;
    footer_couples: string;
    footer_vendors: string;
    footer_guests: string;
    footer_couples_signup: string;
    footer_couples_signin: string;
    footer_couples_features: string;
    footer_vendors_waitlist: string;
    footer_vendors_about: string;
    footer_guests_enter: string;
    footer_guests_about: string;
    footer_legal_terms: string;
    footer_legal_privacy: string;
    footer_legal_about: string;
    /** Replaces the second vendor-direction link in the For-vendors footer
     *  column (the original `footer_vendors_about` also pointed at
     *  /vendors, creating a duplicate). Now links to /about. */
    footer_about_link: string;
    footer_band_text: string;
    footer_band_cta: string;
    skip_to_main: string;
    // ── Round 2: stats strip + product features + testimonials ────────
    stats_eyebrow: string;
    stats_a_value: string;
    stats_a_label: string;
    stats_b_value: string;
    stats_b_label: string;
    stats_c_value: string;
    stats_c_label: string;
    stats_footnote: string;
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
    pricing_eyebrow: string;
    pricing_title: string;
    pricing_body: string;
    pricing_bullet_1: string;
    pricing_bullet_2: string;
    pricing_bullet_3: string;
    pricing_v2_note: string;
    why_eyebrow: string;
    why_title: string;
    why_a_title: string;
    why_a_body: string;
    why_b_title: string;
    why_b_body: string;
    why_c_title: string;
    why_c_body: string;
    why_d_title: string;
    why_d_body: string;
    mockup_date: string;
    mockup_live_budget_label: string;
    mockup_total_spend: string;
    mockup_yes_count: string;
    mockup_pending_count: string;
    mockup_seating_summary: string;
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
    mockup_vendor_category: string;
    mockup_vendor_reviews: string;
    mockup_vendor_cta: string;
  };
  vendors: {
    seo_title: string;
    seo_description: string;
    pill: string;
    hero_title: string;
    hero_sub: string;
    benefit_1_title: string;
    benefit_1_body: string;
    benefit_2_title: string;
    benefit_2_body: string;
    benefit_3_title: string;
    benefit_3_body: string;
    form_title: string;
    form_sub: string;
    form_business_label: string;
    form_email_label: string;
    form_category_label: string;
    form_category_placeholder: string;
    form_location_label: string;
    form_location_placeholder: string;
    form_location_help: string;
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
    contact_subject: string;
    back_to_landing: string;
  };
  public: {
    menu_open: string;
    menu_close: string;
  };
  nav: {
    dashboard: string;
    guests: string;
    budget: string;
    seating: string;
    /** Day-of run-of-show timeline page — sidebar only. */
    schedule: string;
    suppliers: string;
    /** Free-form planning surface (tasks / ideas / wedding-day schedule). */
    planning: string;
    /** Gantt-style timeline + point-of-contact panel — sidebar only. */
    timeline: string;
    /** Post-wedding follow-up surfaces — honeymoon planning + photo share. */
    honeymoon: string;
    /** Pre-wedding inspiration — embeds a Pinterest board the couple links. */
    moodboard: string;
    media: string;
    print: string;
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
    more_sheet_title: string;
  };
  /** Free-form planning surface — three tabs over the planning_items table. */
  planning: {
    title: string;
    sub: string;
    /** aria-label for the tablist wrapping the three category tabs. */
    tabs_aria: string;
    tab_tasks: string;
    tab_ideas: string;
    tab_schedule: string;
    /** Quick-add form CTA. */
    add: string;
    /** Per-tab placeholder for the quick-add title input. */
    task_placeholder: string;
    idea_placeholder: string;
    schedule_placeholder: string;
    /** Inputs surfaced inline next to the quick-add title. */
    due_date_label: string;
    time_label: string;
    /** Expanded-row notes textarea placeholder. */
    body_placeholder: string;
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
    idea_suggested_by: string;
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
    flight_estimate_attribution: string;
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
    destination_placeholder: string;
    destination_empty_cta: string;
    /** Aria-label + tooltip for the small map icon in the destination tile. */
    show_on_map: string;
    /** Body text for the map modal when Nominatim returned no hits. */
    map_not_found: string;
    map_error: string;
    /** Aria-label + tooltip for the "open in OpenStreetMap" link in the map modal. */
    map_open_external: string;
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
    costs_empty_title: string;
    costs_empty_body: string;
    /** Per-card "spent so far" inline label. Receives `{actual}` pre-formatted. */
    cost_actual_inline: string;
    /** Aria-label for the per-card range slider. Receives `{label}`. */
    slider_aria: string;
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
  };
  media: {
    title: string;
    sub: string;
    coming_soon_title: string;
    coming_soon_body: string;
  };
  /** Inspiration page that renders pins from a linked public Pinterest board. */
  moodboard: {
    title: string;
    sub: string;
    url_label: string;
    url_placeholder: string;
    url_help: string;
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
  };
  /** Day-of run-of-show — CRUD over the schedule_events table. */
  schedule: {
    title: string;
    sub: string;
    add_event: string;
    edit_event: string;
    delete_event: string;
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
  };
  guests: {
    title: string;
    add: string;
    import_csv: string;
    csv_help: string;
    full_name: string;
    email: string;
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
    household_section_title: string;
    household_section_help: string;
    couple_slug_title: string;
    couple_slug_help: string;
    couple_slug_save: string;
    couple_slug_invalid: string;
    couple_slug_taken: string;
    /** Compact "Check-in: ANDORSARI · + 4-digit code (?)" pill at the top
     *  of /app/guests. Expands to slug edit + help text on click. */
    checkin_pill_lead: string;
    checkin_pill_suffix: string;
    checkin_pill_show: string;
    checkin_pill_hide: string;
    checkin_pill_url_hint: string;
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
    invite_state_cycle_to_invited: string;
    invite_state_cycle_to_delivered: string;
    invite_state_cycle_to_clear: string;
    /** Page-level summary chips above the household list. */
    total_summary_unit: string;
    total_summary_households: string;
    total_summary_invited: string;
    total_summary_households_unit: string;
    total_summary_invited_unit: string;
    /** Adult / child / baby kind selector. */
    kind_label: string;
    kind_help: string;
    kind_adult: string;
    kind_child: string;
    kind_baby: string;
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
    saving: string;
    import_done_one: string;
    import_done_other: string;
    download_template: string;
    guest_section_divider: string;
    hosts_badge: string;
  };
  budget: {
    title: string;
    sub: string;
    category: string;
    label: string;
    planned: string;
    actual: string;
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
    lines_title: string;
    lines_sub: string;
    lines_empty: string;
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
    add_template_help: string;
    edit_planned_aria: string;
    per_guest_unit: string;
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
    /** Soft tier (0–5 % over). Calm "a touch over" copy, no alarm. */
    overcap_soft_label: string;
    /** Medium tier (5–20 % over). Replaces the legacy `budget.over_by` pill
     *  copy with the same magnitude semantics. Receives `{amount}`. */
    overcap_medium_label: string;
    /** Serious tier (>20 % over). Action line under the warning pill that
     *  deep-links to /app/budget#top-overage. */
    overcap_serious_action: string;
    /** Always-on planned row under the headline.
     *  Receives `{amount}` (per-guest planned) and `{count}` (slider count). */
    per_guest_planned: string;
    /** Actual row, only when at least one yes-RSVP exists. Receives
     *  `{amount}` (per-guest actual) and `{confirmed}` (yes-RSVP count). */
    per_guest_actual: string;
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
    no_tables: string;
    add_first_table: string;
    drag_help: string;
    conflicts_title: string;
    no_conflicts: string;
    conflict_split: string;
    conflict_avoid: string;
    print_a4: string;
    print_a3: string;
    print_place_cards: string;
    print_format_a4: string;
    print_format_a3: string;
    map_title: string;
    map_help: string;
    map_expand: string;
    map_collapse: string;
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
  };
  suppliers: {
    title: string;
    sub: string;
    contact_email: string;
    visit_website: string;
    filter_all: string;
    chain_help: string;
    community_pill: string;
    drop_your_own: string;
    /** "Csinálom magam" / DIY flow — couple-private supplier entries. */
    diy_pill: string;
    diy_button: string;
    diy_button_short: string;
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
    /** Free-text search input above the chain. */
    search_label: string;
    search_placeholder: string;
    /** City select / filter. */
    city_label: string;
    city_all: string;
    /** Empty result state when search/city filters out everything. */
    empty_filtered: string;
    /** Price-band scale tooltip / legend. */
    price_legend: string;
    /** Saved-supplier star + filter chip. */
    save_aria: string;
    unsave_aria: string;
    saved_filter: string;
    /** Per-category "this is our pick" selection — one card per sub-category. */
    pick_aria: string;
    unpick_aria: string;
    picked_filter_idle: string;
    picked_filter_active: string;
    picked_pill: string;
    chain_progress_aria: string;
    /** Per-couple planned + final cost row on each supplier card. */
    cost_planned_label: string;
    cost_actual_label: string;
    cost_saved_indicator: string;
    cost_currency_suffix: string;
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
    guests_filter_placeholder: string;
    guests_filter_help: string;
    guests_filter_clear: string;
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
    submit: {
      title: string;
      intro: string;
      trust_review: string;
      trust_email_private: string;
      trust_no_fees: string;
      next_steps_title: string;
      next_steps_body: string;
      next_steps_review_title: string;
      next_steps_review_body: string;
      category_label: string;
      category_placeholder: string;
      name_label: string;
      city_label: string;
      address_label: string;
      address_help: string;
      address_resolving: string;
      address_resolved: string;
      address_resolved_partial: string;
      address_resolve_failed: string;
      website_label: string;
      email_label: string;
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
      /** Hero "paste a Google Maps link" affordance copy + smart-fill input. */
      magic_title: string;
      magic_help: string;
      magic_placeholder: string;
      magic_or_manual: string;
      magic_resolve: string;
      magic_clear: string;
      /** Section headings on the form side. */
      section_who: string;
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
      venue_stay: string;
      food_drink: string;
      atmosphere: string;
      experience: string;
      style: string;
      details: string;
    };
    cat: {
      venue: string;
      accommodation: string;
      catering: string;
      cake_dessert: string;
      bar_drinks: string;
      decor_floral: string;
      lighting: string;
      music_dj: string;
      photo_video: string;
      entertainment: string;
      attire: string;
      hair_makeup: string;
      stationery: string;
      transport: string;
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
    nav_waitlist: string;
    nav_taxonomy: string;
    /** /app/admin/categories page — supplier groups + categories CRUD. */
    taxonomy_title: string;
    taxonomy_sub: string;
    taxonomy_empty: string;
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
    waitlist_card_message_label: string;
    waitlist_card_notes_label: string;
    waitlist_card_sent_label: string;
    waitlist_action_respond: string;
    waitlist_action_reopen: string;
    waitlist_modal_title: string;
    waitlist_modal_outcome_label: string;
    waitlist_modal_outcome_accepted: string;
    waitlist_modal_outcome_under_review: string;
    waitlist_modal_outcome_rejected: string;
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
    waitlist_toast_decided: string;
    waitlist_toast_reopened: string;
    /** /app/admin/users page — read-only directory of users + couples. */
    users_title: string;
    users_sub: string;
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
    /** New v1.2 layout: one row per workspace (couple), with both partners
     *  collapsed inside it. */
    workspaces_section: string;
    workspaces_count_one: string;
    workspaces_count_other: string;
    orphans_section: string;
    orphans_count_one: string;
    orphans_count_other: string;
    orphans_empty: string;
    table_workspace_id: string;
    table_workspace_name: string;
    table_workspace_members: string;
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
    workspace_status_paused: string;
    workspace_status_deleting: string;
    /** One-shot bulk purge of every couple in `status="deleting"` — already
     *  PII-scrubbed tombstones the regular UI now hides. */
    purge_deleting_button: string;
    purge_deleting_confirm_title: string;
    purge_deleting_confirm_body: string;
    purge_deleting_confirm: string;
    purge_deleting_success: string;
    badge_admin: string;
    badge_suspended: string;
    badge_unverified: string;
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
    enrich: string;
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
    suppliers_card_field_submitted_at: string;
    suppliers_card_field_updated_at: string;
    suppliers_card_field_hidden_at: string;
    suppliers_card_field_hide_reason: string;
    suppliers_card_field_open_reports: string;
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
    /** /app/admin/feedback page — triage of Visszajelzés submissions. */
    nav_feedback: string;
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
  };
  rsvp: {
    title: string;
    sub: string;
    not_found: string;
    will_attend: string;
    pick_yes: string;
    pick_no: string;
    pick_maybe: string;
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
     *  mode so a borrowed phone is one mis-tap from /app. */
    kiosk_banner: string;
    kiosk_enter: string;
    kiosk_exit_hold: string;
    kiosk_exit_confirmed: string;
  };
  notfound: {
    title: string;
    body: string;
    go_home: string;
  };
  profile: {
    title: string;
    menu_label: string;
    menu_profile: string;
    no_name: string;
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
    partner_invite_cancelling: string;
    /** Activity log — dark "what happened in the workspace" panel. The
     *  per-action `activity_action_*` keys cover the visible set defined
     *  in routes/couples.ts (`ACTIVITY_VISIBLE_ACTIONS`). */
    activity_title: string;
    activity_body: string;
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
    budget_currency_huf: string;
    budget_currency_eur: string;
    budget_currency_usd: string;
    /** Confirm dialog shown when the user taps a different currency pill —
     *  spells out that we DON'T retro-convert past entries by FX rate. */
    budget_currency_confirm_title: string;
    budget_currency_confirm_body: string;
    budget_currency_confirm_yes: string;
    payments_title: string;
    payments_body: string;
    /** "Wedding RSVP" settings card on /app/profile. Today it carries a
     *  single opt-in: whether the RSVP flow asks guests if they need
     *  accommodation. Default off so couples who don't offer it don't ask. */
    rsvp_title: string;
    rsvp_body: string;
    rsvp_offers_accommodation_label: string;
    rsvp_offers_accommodation_help: string;
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
    archive_deleting: string;
    archive_kind_json: string;
    archive_kind_seating_pdf: string;
    archive_kind_place_cards_pdf: string;
    archive_kind_guest_csv: string;
    /** Delete-account flow (30-day grace before admin purge). */
    delete_account_title: string;
    delete_account_body: string;
    delete_account_button: string;
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
    go_home: string;
  };
  /** Trust microcopy under the RegisterPage submit button. Split into
   *  three pieces so the privacy-policy link can be a real <Link>
   *  without resorting to dangerouslySetInnerHTML. */
  register: {
    trust_microcopy_prefix: string;
    trust_microcopy_privacy_link: string;
    trust_microcopy_suffix: string;
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
    retention_title: string;
    retention_body: string;
    rights_title: string;
    rights_intro: string;
    rights_access: string;
    rights_deletion: string;
    rights_portability: string;
    rights_contact: string;
    cookies_title: string;
    cookies_intro: string;
    cookies_locale: string;
    cookies_verify_dismiss: string;
    cookies_session: string;
    cookies_saved_suppliers: string;
    cookies_onboarding_draft: string;
    third_parties_title: string;
    third_parties_body: string;
    changes_title: string;
    changes_body: string;
    contact_title: string;
    contact_body: string;
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
    directory_title: string;
    directory_body: string;
    law_title: string;
    law_body: string;
    contact_title: string;
    contact_body: string;
    en_section_label: string;
  };
  /** /about — who built Weddly. Founder name is intentionally a
   *  placeholder string so a human can fill it in before launch. */
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
    paragraph_principles_title: string;
    principle_calm: string;
    principle_no_lock_in: string;
    principle_hungarian: string;
    en_section_label: string;
    /** Placeholder founder name — replace before going public. */
    founder_placeholder: string;
  };
  /** Re-login modal that pops on 401 mid-session. Copy stays short — the
   *  user is mid-task and just needs to resume. */
  session: {
    expired_title: string;
    expired_body: string;
    sign_in: string;
    sign_out: string;
  };
  /** Network resilience surface — toasts when fetch fails, timeouts, etc. */
  network: {
    offline_banner: string;
    request_failed: string;
    request_timeout: string;
    retry: string;
  };
}
