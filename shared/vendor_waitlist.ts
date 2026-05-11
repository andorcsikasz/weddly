// Vendor waitlist contract — public submission shape + admin list shape.

import type { SupplierCategory } from "./suppliers";

export type VendorWaitlistStatus = "new" | "contacted" | "dismissed";

export interface SubmitVendorWaitlistInput {
  business_name: string;
  email: string;
  category: SupplierCategory;
  location: string | null;
  message: string | null;
}

export interface VendorWaitlistEntry {
  id: number;
  business_name: string;
  email: string;
  category: string;
  location: string | null;
  message: string | null;
  status: VendorWaitlistStatus;
  reviewed_at: number | null;
  created_at: number;
}
