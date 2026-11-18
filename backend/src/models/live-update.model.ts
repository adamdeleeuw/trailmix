/**
 * The live update message the app polls for during Navigation (#87), as agreed in #85.
 *
 * @remarks
 * This is the only definition of the message on the backend: the builder in `live-updates.service.ts` makes these,
 * and the endpoint sends them as JSON, so dates become ISO 8601 strings. The app's copy is
 * `frontend/.../data/LiveUpdate.kt`. Change both together.
 *
 * ```json
 * {
 *   "live": true,
 *   "updatedAt": "2026-11-18T17:02:30.000Z",
 *   "legs": [
 *     { "legIndex": 1, "matched": true, "departAt": "…", "arriveAt": "…", "delaySeconds": 180, "cancelled": false }
 *   ],
 *   "alerts": [
 *     { "id": "733912", "header": "9 Boundary detour…", "description": "…", "effect": "DETOUR",
 *       "legIndexes": [1], "activeUntil": null }
 *   ]
 * }
 * ```
 */

/** The live times of one transit leg. */
export interface LiveLeg {
  legIndex: number; // index into the trip's legs
  matched: boolean; // whether TransLink predicted the run this leg rides; if not, the times are the trip's scheduled ones
  departAt: Date | null; // predicted departure from the leg's first stop, else scheduled
  arriveAt: Date | null; // predicted arrival at the leg's last stop, else scheduled
  delaySeconds: number | null; // how late the run leaves compared with the trip's plan, negative when early; null unless matched
  // TransLink cancelled the run (or it skips the boarding stop), so the times are the scheduled ones and delaySeconds
  // is null. Optional for clients, where missing means false; the backend always sends it.
  cancelled?: boolean;
}

/** A TransLink service alert on one or more of the trip's transit legs. */
export interface LiveAlert {
  id: string; // stable while the alert lasts, so the app can tell a new alert from one it has shown
  header: string; // the short text, e.g. "9 Boundary detour beginning Mon Jul 20"
  description: string | null; // the details, when TransLink gives any
  effect: string; // GTFS-RT's Alert.Effect name, e.g. "DETOUR", "REDUCED_SERVICE", "NO_SERVICE"
  legIndexes: number[]; // the trip's legs it applies to
  activeUntil: Date | null; // when the alert's current period ends, null for until further notice
}

/** The whole message. */
export interface LiveUpdate {
  live: boolean; // false when TransLink's data couldn't be used; the app then shows "scheduled times, not live"
  updatedAt: Date | null; // when TransLink made the oldest feed used, null when not live
  legs: LiveLeg[]; // each transit leg from the rider's current leg on, in order
  alerts: LiveAlert[]; // active alerts on those legs, in TransLink's order
}
