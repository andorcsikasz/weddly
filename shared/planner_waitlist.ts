// Planner waitlist contract — public submission shape + admin list shape.
// Phase 1: simple data collection; no triage email flow yet.

export type PlannerWaitlistStatus = "new" | "under_review" | "accepted" | "rejected";
export type PlannerWaitlistOutcome = "under_review" | "accepted" | "rejected";

export interface SubmitPlannerWaitlistInput {
  full_name: string;
  email: string;
  phone: string | null;
  company_name: string | null;
  city: string | null;
  years_experience: number | null;
  message: string | null;
  privacy_version: string;
  selected_plan: "basic" | "pro" | "unlimited" | null;
  website: string | null;
  weddings_per_year: number | null;
  usage: string | null;
}

export interface PlannerWaitlistEntry {
  id: number;
  full_name: string;
  email: string;
  phone: string;
  company_name: string | null;
  city: string | null;
  years_experience: number | null;
  message: string | null;
  status: PlannerWaitlistStatus;
  selected_plan: "basic" | "pro" | "unlimited" | null;
  website: string | null;
  weddings_per_year: number | null;
  usage: string | null;
  created_at: number;
}

export interface PlannerWaitlistAdminView {
  id: number;
  full_name: string;
  email: string;
  phone: string;
  company_name: string | null;
  city: string | null;
  years_experience: number | null;
  message: string | null;
  status: PlannerWaitlistStatus;
  reviewed_at: number | null;
  outcome_at: number | null;
  notes: string | null;
  selected_plan: "basic" | "pro" | "unlimited" | null;
  website: string | null;
  weddings_per_year: number | null;
  usage: string | null;
  created_at: number;
}

export interface DecidePlannerWaitlistInput {
  outcome: PlannerWaitlistOutcome;
  notes: string;
}
