// Type-only contract for the locale tree. Both hu.ts and en.ts must satisfy this.

export interface LocaleMessages {
  common: {
    save: string;
    cancel: string;
    next: string;
    back: string;
    loading: string;
    yes: string;
    no: string;
    optional: string;
    error_generic: string;
    sign_out: string;
  };
  app: {
    name: string;
    tagline: string;
  };
  auth: {
    login_title: string;
    register_title: string;
    email_label: string;
    password_label: string;
    full_name_label: string;
    submit_login: string;
    submit_register: string;
    no_account: string;
    have_account: string;
    bad_credentials: string;
    duplicate_email: string;
    short_password: string;
    rate_limited: string;
  };
  onboarding: {
    welcome: string;
    intro: string;
    step1_title: string;
    step1_help: string;
    display_name_label: string;
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
    target_guests: string;
    budget_ceiling: string;
    pick_up_where: string;
    coming_soon: string;
    feature_budget: string;
    feature_guests: string;
    feature_seating: string;
    feature_print: string;
    feature_suppliers: string;
  };
  invite: {
    title: string;
    intro: string;
    expired: string;
    accept: string;
    accepting: string;
    need_account: string;
  };
  landing: {
    hero_title: string;
    hero_sub: string;
    cta_signup: string;
    cta_login: string;
    feature_planning_title: string;
    feature_planning_body: string;
    feature_guests_title: string;
    feature_guests_body: string;
    feature_seating_title: string;
    feature_seating_body: string;
  };
}
