// Personal-invite campaign contract, shared by the admin console and the
// backend. Unlike the two vendor campaigns this one targets the founder's own
// contacts, imported from a CSV, with a "you (or someone you love) is getting
// married, meet Weddly" note and a register CTA.
//
// The key structural difference: the audience is a FIXED imported list, not a
// live query over the directory. One send row is seeded per contact at import,
// deduped against `users` (already registered) and `email_optouts`; the paced
// sweep then drains 'queued' rows up to the rolling-24h `daily_cap`, RE-checking
// users/optouts at send time so anyone who registers or opts out between import
// and send is never mailed.
//
// Constraints encoded here so both sides agree:
//   - one row per ADDRESS per campaign (keyed by email)
//   - paced by a rolling-24h daily_cap: even a warm personal note shares the
//     sending reputation that verify + RSVP mail depend on
//   - conversion is attributed without click-tracking: the CTA carries a UTM the
//     signup-acquisition capture reads, and `registered` is computed live from
//     whether the address gained a `users` row after we wrote to it.

export type PersonalInviteCampaignStatus = "paused" | "running" | "done";
export type PersonalInviteCampaignSendStatus = "queued" | "sent" | "failed" | "skipped";

/** Default rolling-24h ceiling for a new campaign. Matches the vendor campaigns:
 *  cold-ish volume shares the domain reputation transactional mail relies on. */
export const PERSONAL_INVITE_DEFAULT_DAILY_CAP = 50;
export const PERSONAL_INVITE_MAX_DAILY_CAP = 200;

export interface PersonalInviteCampaign {
  id: number;
  slug: string;
  status: PersonalInviteCampaignStatus;
  daily_cap: number;
  created_at: number;
  updated_at: number;
  /** First time it went Running (the launch). Null until launched; never
   *  overwritten on a later re-launch. */
  started_at: number | null;
  /** When it retired to Done (queue drained). Null while it can still send. */
  ended_at: number | null;
}

/** Per-recipient row. `registered` is COMPUTED at read time from whether the
 *  address now has a `users` row, a login-free proxy for "this invite
 *  converted", however that person actually signed up. */
export interface PersonalInviteCampaignSend {
  id: number;
  name: string;
  email: string;
  locale: "hu" | "en";
  status: PersonalInviteCampaignSendStatus;
  error: string | null;
  sent_at: number | null;
  registered: boolean;
  created_at: number;
}

/** Funnel counters for the admin console. */
export interface PersonalInviteCampaignStats {
  /** Rows in the campaign (its imported size). */
  total: number;
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
  /** Distinct HU vs EN split of the queued+sent rows, so the operator can sanity
   *  check the language detection before launching. */
  hu: number;
  en: number;
  /** Sends whose address now has a `users` row. */
  registered: number;
  sent_last_24h: number;
}

export interface PersonalInviteCampaignDetail {
  campaign: PersonalInviteCampaign;
  stats: PersonalInviteCampaignStats;
}

/** One contact from the import (a CSV `name,email` row). */
export interface ImportContact {
  name: string;
  email: string;
}

/** What an import did, so the operator sees exactly who was kept and dropped and
 *  why before they ever launch. */
export interface PersonalInviteImportResult {
  imported: number;
  skipped_registered: number;
  skipped_optout: number;
  skipped_duplicate: number;
  skipped_invalid: number;
}

export interface CreatePersonalInviteCampaignInput {
  slug?: unknown;
  daily_cap?: unknown;
}

export interface ImportPersonalInviteContactsInput {
  /** Either a list of {name,email}, or a raw CSV string with a `name,email`
   *  header. The backend accepts both so the admin can paste a CSV directly. */
  contacts?: unknown;
  csv?: unknown;
}

export interface UpdatePersonalInviteCampaignInput {
  status?: unknown;
  daily_cap?: unknown;
}
