/**
 * The types for `buyer-match.mjs`, which TypeScript cannot infer usefully.
 *
 * WHY THIS FILE EXISTS. Without it, `matchBuyers` resolves to `any`, and an
 * `any` crossing a module boundary is not "untyped" — it is a place where every
 * annotation on the other side becomes a silent assertion. Checked by writing a
 * deliberately wrong return type in reconcile.ts (`bogusField: symbol`) and
 * watching `tsc --noEmit` pass, which is precisely the kind of quiet agreement
 * that let the two copies of this matcher drift in the first place.
 *
 * The module is plain .mjs because the script side cannot import TypeScript;
 * this declaration is how the page side still gets checked.
 */

/** A buyer as read from the payment processor. */
export interface MatchableBuyer {
  email: string;
  name?: string;
  /** The name on the card. The only one that reliably matches a call row. */
  billing?: string;
}

/** How an item was tied to a buyer. */
export interface BuyerMatch<B> {
  buyer: B;
  /** Higher is a better fit. `Infinity` for an email match. */
  score: number;
  /** True only for an email match; a name match is always a guess. */
  certain: boolean;
}

export interface MatchAccessors<T> {
  emailOf: (item: T) => string | null | undefined;
  nameOf: (item: T) => string | null | undefined;
}

export declare const MIN_NAME_TOKEN: number;
export declare const MIN_SUBSTRING_TOKEN: number;
export declare const MIN_SCORE: number;
export declare const CASH_TOLERANCE: number;

export declare function normalise(value: string | null | undefined): string;
export declare function buyerText(buyer: MatchableBuyer): string;
export declare function buyerHaystacks<B extends MatchableBuyer>(
  buyers: Iterable<B>
): { buyer: B; text: string }[];
export declare function nameScore(name: string | null | undefined, text: string): number;
export declare function matchBuyers<T, B extends MatchableBuyer>(
  items: Iterable<T>,
  buyers: Iterable<B>,
  accessors: MatchAccessors<T>
): Map<T, BuyerMatch<B>>;
