// Public surface of the emails module. Routes import from here only.

export type { EmailKind, EmailCategory } from "./kinds";
export { KIND_CATEGORY } from "./kinds";
export { sendKind, markDispatched } from "./send";
export {
  ensurePreferences,
  getPreferencesByToken,
  setLifecycleOptOut,
  type PreferencesRow,
} from "./preferences";
export type { KindPayload } from "./templates";
