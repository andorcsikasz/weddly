// Client "still here" heartbeat cadence for the admin's per-user total-active-time
// metric (domain/activity.ts on the backend, useActivityHeartbeat.ts on the
// frontend). The server credits exactly this many seconds per accepted
// heartbeat — never a client-reported duration — so both sides need to agree
// on the interval for the credited total to match what the tab actually waited
// between pings.
export const ACTIVITY_HEARTBEAT_INTERVAL_S = 25;
