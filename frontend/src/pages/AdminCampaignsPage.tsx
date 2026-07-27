// Admin "Kampányok" — one sidebar entry that hosts BOTH vendor-outreach
// consoles behind a tab switch, so the rail carries a single row instead of
// two near-identical ones. The two consoles stay separate page components
// (AdminVendorCampaignPage = claim-invite outreach, AdminVendorReviewCampaignPage
// = review-collection outreach); this wrapper only adds the tab bar and mounts
// one at a time. The active tab lives in `?tab=` so a refresh or a shared deep
// link reopens the same console.
import { CalendarClock, Heart, Rocket, Send, Star } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { useT } from "../lib/i18n";
import AdminCampaignPlanPage from "./AdminCampaignPlanPage";
import AdminOnboardingCampaignPage from "./AdminOnboardingCampaignPage";
import AdminPersonalInviteCampaignPage from "./AdminPersonalInviteCampaignPage";
import AdminVendorCampaignPage from "./AdminVendorCampaignPage";
import AdminVendorReviewCampaignPage from "./AdminVendorReviewCampaignPage";

type CampaignTab = "plan" | "invite" | "reviews" | "personal" | "onboarding";

export default function AdminCampaignsPage() {
  const { t } = useT();
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  // The plan is the default landing tab: it is the one surface that answers
  // "what should go out now" without the operator composing anything.
  const tab: CampaignTab =
    raw === "invite"
      ? "invite"
      : raw === "reviews"
        ? "reviews"
        : raw === "personal"
          ? "personal"
          : raw === "onboarding"
            ? "onboarding"
            : "plan";

  const select = (next: CampaignTab) => {
    const p = new URLSearchParams(params);
    p.set("tab", next);
    setParams(p, { replace: true });
  };

  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl<CampaignTab>
        ariaLabel={t("admin.nav_campaigns")}
        value={tab}
        onChange={select}
        options={[
          { value: "plan", label: t("admin.plan_title"), icon: <CalendarClock size={15} /> },
          { value: "invite", label: t("admin.nav_vendor_campaign"), icon: <Send size={15} /> },
          {
            value: "reviews",
            label: t("admin.nav_vendor_review_campaign"),
            icon: <Star size={15} />,
          },
          {
            value: "personal",
            label: t("admin.nav_personal_invite"),
            icon: <Heart size={15} />,
          },
          {
            value: "onboarding",
            label: t("admin.nav_onboarding_campaign"),
            icon: <Rocket size={15} />,
          },
        ]}
      />
      {tab === "plan" ? (
        <AdminCampaignPlanPage />
      ) : tab === "invite" ? (
        <AdminVendorCampaignPage />
      ) : tab === "reviews" ? (
        <AdminVendorReviewCampaignPage />
      ) : tab === "personal" ? (
        <AdminPersonalInviteCampaignPage />
      ) : (
        <AdminOnboardingCampaignPage />
      )}
    </div>
  );
}
