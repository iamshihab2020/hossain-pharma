import { SetMetadata, type CustomDecorator } from '@nestjs/common';

export const PLATFORM_ADMIN_KEY = 'nexmarket:platformAdmin';

/**
 * Restricts a route to `users.platform_role = 'ADMIN'`.
 *
 * Separate from @RequireCapability on purpose. Capabilities are ORGANISATION
 * scoped - they answer "what may this person do inside that seller?" - and the
 * approval queue is not inside any seller. Expressing "platform admin" as a
 * capability would mean inventing an organisation for the platform, which is
 * exactly the modelling mistake PRD 6.1 avoids by saying an organisation IS a
 * tenant and buyers are not tenants.
 */
export const PlatformAdmin = (): CustomDecorator<string> => SetMetadata(PLATFORM_ADMIN_KEY, true);
