import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AdminGuard } from './common/guards/admin.guard.js';
import { StorageModule } from './common/storage/storage.module.js';
import { AuthGuard } from './common/guards/auth.guard.js';
import { CapabilityGuard } from './common/guards/capability.guard.js';
import { TenantInterceptor } from './common/interceptors/tenant.interceptor.js';
import { AddressesModule } from './modules/addresses/addresses.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { CartModule } from './modules/cart/cart.module.js';
import { CheckoutModule } from './modules/checkout/checkout.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CatalogueModule } from './modules/catalogue/catalogue.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { LedgerModule } from './modules/ledger/ledger.module.js';
import { ListingsModule } from './modules/listings/listings.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { ShippingModule } from './modules/shipping/shipping.module.js';
import { OrgsModule } from './modules/orgs/orgs.module.js';
import { SearchModule } from './modules/search/search.module.js';

/**
 * Root module. Each domain area from PRD 7.2 arrives as its own module under
 * `src/modules/` and is registered here: auth, tenancy, catalogue, search,
 * cart, checkout, orders, fulfilment, logistics, reviews, returns, promotions,
 * loyalty, ads, admin.
 *
 * PRD 13 deny-by-default and PRD 6.4 criterion 1 are wired GLOBALLY here, not
 * per-controller. A controller added tomorrow with no decorators is closed and
 * tenant-scoped; opting in per controller fails silently the first time someone
 * forgets, and it fails open.
 *
 * CapabilityGuard is registered as a PLAIN provider, deliberately not as a
 * second APP_GUARD. NestJS runs every guard before any interceptor, so a guard
 * cannot read the roles TenantInterceptor resolves - registering it that way
 * made every capability-gated route a 500 reading "No request context: this
 * code ran outside the TenantInterceptor". The interceptor calls it instead.
 * See ADR 0009.
 */
@Module({
  imports: [
    StorageModule,
    ShippingModule,
    PaymentsModule,
    AddressesModule,
    AdminModule,
    CartModule,
    CheckoutModule,
    AuthModule,
    CatalogueModule,
    HealthModule,
    LedgerModule,
    ListingsModule,
    OrdersModule,
    OrgsModule,
    SearchModule,
  ],
  providers: [
    CapabilityGuard,
    { provide: APP_GUARD, useClass: AuthGuard },
    // AFTER AuthGuard, and that order is load-bearing: guards run in
    // registration order and AdminGuard reads the token payload AuthGuard put
    // on the request. Registered before it, it would see undefined and refuse
    // every admin.
    { provide: APP_GUARD, useClass: AdminGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
  ],
})
export class AppModule {}
