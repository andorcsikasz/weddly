// One typed wrapper per HTTP call. Components import these — never `fetch` directly.

import type { AuthSession, Couple, CoupleInvite, User, WeddingStyleTag } from "@shared/types";
import { apiFetch } from "./api";

export const authApi = {
  register: (body: { email: string; password: string; full_name: string }) =>
    apiFetch<AuthSession>("POST", "/api/auth/register", body),
  login: (body: { email: string; password: string }) =>
    apiFetch<AuthSession>("POST", "/api/auth/login", body),
  logout: () => apiFetch<{ ok: true }>("POST", "/api/auth/logout"),
  me: () => apiFetch<{ user: User }>("GET", "/api/auth/me"),
};

export interface OnboardInput {
  display_name: string;
  wedding_date: string | null;
  target_guest_count: number | null;
  budget_ceiling_huf: number | null;
  location_lat?: number | null;
  location_lng?: number | null;
  location_radius_km?: number | null;
  style_tags: WeddingStyleTag[];
}

export const coupleApi = {
  current: () => apiFetch<{ couple: Couple | null }>("GET", "/api/couples/current"),
  onboard: (body: OnboardInput) =>
    apiFetch<{ couple: Couple }>("POST", "/api/couples/onboard", body),
  createInvite: (body: { invited_email?: string }) =>
    apiFetch<{ invite: CoupleInvite }>("POST", "/api/couples/invites", body),
  getInvite: (token: string) =>
    apiFetch<{ invite: CoupleInvite; couple_display_name: string | null }>(
      "GET",
      `/api/invites/${encodeURIComponent(token)}`,
    ),
  acceptInvite: (token: string) =>
    apiFetch<{ couple: Couple }>("POST", `/api/invites/${encodeURIComponent(token)}/accept`, {}),
};
