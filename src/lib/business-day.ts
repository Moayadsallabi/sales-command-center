/**
 * WHOSE DAY IS IT — re-exported from the one implementation.
 *
 * The rule itself lives in `scripts/lib/business-day.mjs`, because the check
 * scripts need it too and a .mjs script cannot import a .ts module. Read that
 * file for what it does and for the two September calls that were joined to the
 * wrong booking before it existed. This side only puts types on it, the same
 * arrangement `buyer-match.d.mts` and `live-read.d.mts` already have — without
 * them every field crossing this boundary would be `any`, and an `any` crossing
 * a module boundary is not "untyped", it is a place where the annotations on
 * the other side quietly become assertions.
 */
export {
  usableZone,
  dayInZone,
  timeInZone,
  businessDay,
  zoneLabel,
} from "../../scripts/lib/business-day.mjs";
