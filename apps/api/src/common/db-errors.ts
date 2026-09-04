import { BadRequestException, ConflictException } from '@nestjs/common';

/**
 * Turns the database's own refusals into the status codes they deserve.
 *
 * A CHECK or a foreign key is a real part of the domain rules - "a sale price
 * cannot exceed the base price" lives in migration 0008 precisely so that no
 * code path can write around it. But a constraint the CALLER violated is a
 * caller error, and letting it reach the client as a 500 says the server broke
 * when it did exactly what it was built to do.
 *
 * SQLSTATEs rather than message text: the codes are stable across Postgres
 * versions and locales, the messages are not. Drizzle wraps driver errors, so
 * the code lives on `.cause`.
 */
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';

type PgError = { code?: string; constraint?: string };

export async function translateDbErrors<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause as PgError | undefined;
    const constraint = cause?.constraint ?? 'a database constraint';

    switch (cause?.code) {
      case CHECK_VIOLATION:
        // The constraint NAME is in the message on purpose. A support ticket
        // saying "listings_prices_non_negative" is answerable; "Bad Request" is
        // not, and the name reveals nothing an attacker cannot read in the
        // open-source migration anyway.
        throw new BadRequestException(`That value is not allowed: ${constraint}`);
      case FOREIGN_KEY_VIOLATION:
        throw new BadRequestException(`Referenced record does not exist: ${constraint}`);
      case UNIQUE_VIOLATION:
        throw new ConflictException(`That record already exists: ${constraint}`);
      default:
        // Anything else really is a server error, and swallowing it into a 400
        // would hide the failures worth paging someone about.
        throw error;
    }
  }
}
