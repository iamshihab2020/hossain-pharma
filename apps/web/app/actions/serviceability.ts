'use server';

import { endpoints } from '@nexmarket/api-client';
import { ApiError, apiGet } from '@/lib/api/server';
import { marketToday, normalisePostcode, toAnswer, type DeliveryAnswer } from '@/lib/delivery';

/**
 * The product page's delivery check.
 *
 * A SERVER ACTION rather than a browser fetch, and not by preference: the API
 * registers no CORS, deliberately, so that the session cookies stay httpOnly.
 * The browser cannot reach it at all. Every call from a client component goes
 * through the Next server, which is the only thing holding a session - and this
 * particular endpoint is public, so it carries none.
 *
 * `auth: false` is therefore load-bearing rather than an optimisation. Sending
 * the buyer's access token to a public geography lookup would attach an
 * identity to a question that does not need one.
 */
export type ServiceabilityResult =
  | { status: 'ok'; answer: DeliveryAnswer }
  | { status: 'invalid'; message: string }
  | { status: 'error'; message: string };

export async function checkServiceability(input: {
  postcode: string;
  countryCode?: string;
  weightGrams?: number | null;
  dispatchDays?: number;
}): Promise<ServiceabilityResult> {
  const postcode = normalisePostcode(input.postcode);
  if (postcode === null) {
    return { status: 'invalid', message: 'Enter a postcode, like 1205.' };
  }

  try {
    const result = await apiGet(
      endpoints.serviceability({
        postcode,
        ...(input.countryCode === undefined ? {} : { country: input.countryCode }),
        // Omitted rather than sent as zero when unmeasured: the API treats a
        // missing weight as "no price, just the zone", and zero as a weight.
        ...(input.weightGrams === undefined || input.weightGrams === null
          ? {}
          : { weightGrams: input.weightGrams }),
        ...(input.dispatchDays === undefined ? {} : { dispatchDays: input.dispatchDays }),
      }),
      {
        auth: false,
        /**
         * Cached per postcode, and safely: the URL carries the postcode, the
         * weight and the dispatch days, so two buyers asking different
         * questions never share an entry, and geography changes about as often
         * as the rate card does.
         */
        revalidate: 300,
        tags: ['serviceability'],
      },
    );

    /**
     * The MARKET's today, resolved on the server, once, and passed in.
     *
     * Two things are load-bearing here. It is the market's calendar rather than
     * the server's, because a delivery date is a promise about a day where the
     * courier is - a plain `new Date()` read by UTC getters put every estimate
     * a day early between midnight and 06:00 Dhaka time. And it is computed
     * ONCE on the server rather than in the client component, so a page
     * rendered either side of midnight cannot disagree with itself.
     */
    return { status: 'ok', answer: toAnswer(result, marketToday()) };
  } catch (error) {
    if (error instanceof ApiError) {
      return { status: 'invalid', message: error.message };
    }
    return {
      status: 'error',
      message: 'Could not check delivery just now. Try again in a moment.',
    };
  }
}
