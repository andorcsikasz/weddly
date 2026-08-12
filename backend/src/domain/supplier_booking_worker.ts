import { reportError } from "../lib/observability";
import { log } from "../lib/logger";
import { expireStaleBookings } from "./supplier_bookings";

const INTERVAL_MS = 60 * 60 * 1000;

export function startSupplierBookingWorker(): void {
  const tick = () => {
    try {
      const expired = expireStaleBookings();
      if (expired > 0) log.info("supplier_bookings.expired", { count: expired });
    } catch (error) {
      reportError("supplier_bookings.expiry_failed", error);
    }
  };
  const timer = setInterval(tick, INTERVAL_MS);
  timer.unref?.();
  tick();
}
