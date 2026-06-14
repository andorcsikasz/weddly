// Referral invite-link endpoint. Returns the couple's unique referral code
// plus share URLs and a summary of rewards earned.

import { CONFIG } from "../config";
import { getReferralInfo, type ReferralInfo } from "../domain/referrals";
import { getCoupleForUser } from "../domain/couples";
import { type Ctx, HttpError, json, requireAuth, type Router } from "../lib/http";

export interface ReferralStatusResponse extends ReferralInfo {
  couple_url: string;
  vendor_url: string;
}

function handleGet(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const info = getReferralInfo(couple.id);
  const base = CONFIG.frontendBaseUrl;
  const body: ReferralStatusResponse = {
    ...info,
    couple_url: `${base}/register?ref_code=${info.code}`,
    vendor_url: `${base}/vendors?ref_code=${info.code}`,
  };
  return json(body);
}

export function registerReferralRoutes(router: Router) {
  router.get("/api/referral", handleGet, true);
}
