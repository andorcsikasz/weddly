// Single source of truth for the throwaway-demo session flag.
//
// Launching the Shrek & Fiona demo stamps `weddly.demo_session = "1"` so the
// rest of the app (the demo overlay banner, the seating read-only hint) can
// tell a demo workspace apart from a real one *before* /api/couples/current
// resolves the authoritative `is_demo`.
//
// The flag MUST die the moment the demo session ends — on logout, on the
// "Start your own" conversion, and whenever a real session is established on
// the device. If it leaks past the demo, the next real account on the same
// browser is mistaken for a demo (banner shown) and, worse, the auth-redirect
// guard treats the real session as a demo. Keeping the helpers in `lib/` lets
// the auth layer clear the flag without importing a component.
const DEMO_FLAG_KEY = "weddly.demo_session";

export function isCurrentSessionDemo(): boolean {
  try {
    return localStorage.getItem(DEMO_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function markCurrentSessionDemo() {
  try {
    localStorage.setItem(DEMO_FLAG_KEY, "1");
  } catch {
    // localStorage blocked — the overlay just falls back to the server flag.
  }
}

export function clearDemoSessionFlag() {
  try {
    localStorage.removeItem(DEMO_FLAG_KEY);
  } catch {
    // ignore
  }
}
