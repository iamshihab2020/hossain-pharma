import { Navbar } from '@/components/layout/navbar'
import { SkipLink } from '@/components/accessibility/skip-link'
import { Hero } from './../components/pages/home/hero';
import { CertificationBadges } from '@/components/trust/certification-badges';
import { QuickTools } from '@/components/pages/home/quick-tools';
import { TrustBanner } from '@/components/trust/trust-banner';
import { Categories } from '@/components/pages/home/categories';
import { HowItWorks } from '@/components/pages/home/how-it-works';
import { VendorShowcase } from '@/components/features/vendor-comparison/vendor-showcase';
import { LatestProductsEnhanced } from '@/components/pages/home/latest-products-enhanced';
import { DiscountedProductsEnhanced } from '@/components/pages/home/discounted-products-enhanced';
import { FeaturedProducts } from '@/components/pages/home/featured-products';
import { Testimonials } from '@/components/pages/home/testimonials';
import { HealthResources } from '@/components/pages/home/health-resources';

export default function HomePage() {
  return (
    <>
      <SkipLink />
      <Navbar />
      <main id="main-content" className="flex flex-col">
        <Hero />
        <CertificationBadges />
        <div className="container mx-auto">
          <QuickTools />
        </div>
        <TrustBanner />
        <div className="container mx-auto">
          <Categories />
        </div>
        <HowItWorks />
        <div className="container mx-auto">
          <VendorShowcase />
        </div>
        <LatestProductsEnhanced />
        <DiscountedProductsEnhanced />
        <div className="container mx-auto">
          <FeaturedProducts />
        </div>
        <Testimonials />
        <HealthResources />
      </main>
    </>
  )
}
