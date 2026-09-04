import { createParamDecorator } from '@nestjs/common';
import { getRequestContext, type RequestContext } from '../request-context.js';

/**
 * The caller, as resolved by the auth guard and the tenant interceptor.
 *
 * Reads from the AsyncLocalStorage context rather than off the request object
 * so there is exactly one source of truth for identity: if the interceptor did
 * not run, this throws rather than handing back a half-populated request.
 *
 * Takes neither the data argument nor the ExecutionContext, on purpose - there
 * is nothing to read off the raw request that the context does not already
 * carry, and a parameter list that suggests otherwise invites someone to.
 */
export const CurrentUser = createParamDecorator((): RequestContext => getRequestContext());
