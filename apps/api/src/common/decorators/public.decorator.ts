import { SetMetadata, type CustomDecorator } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'nexmarket:isPublic';

/**
 * PRD 13: deny by default. The auth guard and the tenant interceptor are both
 * registered globally, so a route with no decorator is CLOSED. This opts a
 * route out of both - see plan D-E. Use it only where there is genuinely no
 * caller identity yet: register, login, refresh, health.
 */
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_KEY, true);
