/** Types for `business-day.mjs`. See that file for the rule and why it is .mjs. */

/** A zone the runtime can format in, or "UTC" when it cannot. */
export function usableZone(zone: string | null | undefined): string;

/** The `YYYY-MM-DD` an instant falls on, in `zone`. Null if it will not parse. */
export function dayInZone(iso: string, zone: string): string | null;

/** `14:30`, in `zone`. Null if it will not parse. */
export function timeInZone(iso: string, zone: string): string | null;

/**
 * A stored date reduced to the day it belongs to.
 *
 * A bare `YYYY-MM-DD` comes back untouched; a timestamp is converted to `zone`.
 * Null for anything unparseable, and for null in.
 */
export function businessDay(
  value: string | null | undefined,
  zone: string | null | undefined
): string | null;

/** `America/New_York · GMT-4`, for saying on screen which zone was used. */
export function zoneLabel(zone: string, on?: Date): string;

/** The client's zone from the environment, for scripts. Null when unset. */
export function clientZone(): string | null;
