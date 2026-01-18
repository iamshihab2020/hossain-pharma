'use client'

import { ArrowRight, ShieldCheck, Truck, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FadeIn } from '@/components/animations/fade-in'
import { StaggerContainer, StaggerItem } from '@/components/animations/stagger-container'
import { ScaleIn } from '@/components/animations/scale-in'

export function Hero() {
  return (
    <section className="flex items-center flex-col relative overflow-hidden bg-gradient-to-b from-background to-muted/20 py-12 sm:py-16 lg:py-20 px-10 w-full">
        <div className="max-w-7xl w-full grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-20 items-center">
          {/* Left */}
          <div className="flex flex-col gap-6 lg:gap-8">
            <FadeIn direction="up" duration={0.6}>
              <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
                Quality Medicines{' '}
                <span className="text-primary">Delivered</span>{' '}
                to Your Doorstep
              </h1>
            </FadeIn>

            <FadeIn direction="up" delay={0.2} duration={0.6}>
              <p className="text-lg leading-8 text-muted-foreground sm:text-xl">
                Shop from trusted pharmaceutical sellers and get authentic medicines delivered fast.
                Your health, our priority - safe, convenient, and reliable.
              </p>
            </FadeIn>

            <FadeIn direction="up" delay={0.4} duration={0.6}>
              <div className="flex flex-col sm:flex-row gap-4">
                <Button size="lg" className="w-full sm:w-auto group">
                  Shop Medicines Now
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Button>
                <Button size="lg" variant="outline" className="w-full sm:w-auto">
                  Search by Prescription
                </Button>
              </div>
            </FadeIn>
          </div>

          {/* Right  */}
          <FadeIn direction="left" delay={0.3} duration={0.8}>
            <div className="relative aspect-square lg:aspect-auto lg:h-[500px] w-full">
              {/* Medicine illustration using shapes and icons */}
              <div className="relative w-full h-full flex items-center justify-center">
                <div className="relative w-full h-full max-w-md">
                  {/* Large medicine bottle illustration */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-96 bg-gradient-to-b from-primary/25 to-primary/35 rounded-[4rem] border-4 border-primary/50 shadow-2xl backdrop-blur-sm">
                    {/* Bottle cap */}
                    <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-36 h-14 bg-primary/70 rounded-t-3xl shadow-lg"></div>

                    {/* Main label area */}
                    <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-56 h-48 bg-white/90 rounded-3xl p-6 flex flex-col items-center justify-center shadow-xl">
                      <div className="text-center space-y-3">
                        <div className="relative">
                          <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full"></div>
                          <ShieldCheck className="relative h-16 w-16 text-primary mx-auto" strokeWidth={2.5} />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xl font-bold text-primary">100% Authentic</p>
                          <p className="text-xs text-muted-foreground px-2">Licensed & Verified Medicines</p>
                        </div>
                        <div className="pt-2 flex items-center justify-center gap-2">
                          <Truck className="h-4 w-4 text-primary" />
                          <span className="text-xs font-semibold text-primary">Fast Delivery</span>
                        </div>
                      </div>
                    </div>

                    {/* Bottom badge */}
                    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-primary/80 px-4 py-2 rounded-full">
                      <p className="text-xs font-semibold text-white text-center">Trusted by Thousands</p>
                    </div>
                  </div>

                  {/* Floating pills decoration with better styling */}
                  <div className="absolute top-10 left-10 w-20 h-20 bg-gradient-to-br from-primary/40 to-primary/20 rounded-full animate-bounce shadow-lg flex items-center justify-center">
                    <Clock className="h-8 w-8 text-primary" />
                  </div>
                  <div className="absolute bottom-20 right-10 w-16 h-16 bg-gradient-to-br from-primary/35 to-primary/15 rounded-full animate-bounce shadow-lg flex items-center justify-center" style={{ animationDelay: '0.2s' }}>
                    <ShieldCheck className="h-6 w-6 text-primary" />
                  </div>
                  <div className="absolute top-1/4 right-5 w-14 h-14 bg-gradient-to-br from-primary/30 to-primary/10 rounded-full animate-bounce shadow-lg flex items-center justify-center" style={{ animationDelay: '0.4s' }}>
                    <Truck className="h-5 w-5 text-primary" />
                  </div>

                  {/* Additional floating pills - capsule shapes */}
                  <div className="absolute top-20 right-20 w-12 h-6 bg-gradient-to-r from-red-400/40 to-yellow-400/40 rounded-full animate-bounce shadow-md" style={{ animationDelay: '0.1s' }}></div>
                  <div className="absolute bottom-32 left-5 w-10 h-5 bg-gradient-to-r from-blue-400/40 to-cyan-400/40 rounded-full animate-bounce shadow-md" style={{ animationDelay: '0.3s' }}></div>
                  <div className="absolute top-1/3 left-20 w-8 h-4 bg-gradient-to-r from-green-400/40 to-emerald-400/40 rounded-full animate-bounce shadow-md" style={{ animationDelay: '0.5s' }}></div>
                  <div className="absolute bottom-12 right-24 w-11 h-5 bg-gradient-to-r from-purple-400/40 to-pink-400/40 rounded-full animate-bounce shadow-md" style={{ animationDelay: '0.6s' }}></div>
                  <div className="absolute top-2/3 right-8 w-9 h-4 bg-gradient-to-r from-orange-400/40 to-red-400/40 rounded-full animate-bounce shadow-md" style={{ animationDelay: '0.7s' }}></div>

                  {/* Round pills */}
                  <div className="absolute top-32 left-32 w-6 h-6 bg-gradient-to-br from-pink-400/30 to-rose-400/30 rounded-full animate-bounce shadow-md" style={{ animationDelay: '0.8s' }}></div>
                  <div className="absolute bottom-28 right-32 w-7 h-7 bg-gradient-to-br from-indigo-400/30 to-blue-400/30 rounded-full animate-bounce shadow-md" style={{ animationDelay: '0.9s' }}></div>
                  <div className="absolute top-1/2 left-8 w-5 h-5 bg-gradient-to-br from-teal-400/30 to-cyan-400/30 rounded-full animate-bounce shadow-md" style={{ animationDelay: '1s' }}></div>
                </div>
              </div>
            </div>
          </FadeIn>
      </div>

      <StaggerContainer staggerDelay={0.15} initialDelay={0.6} className="mt-20 px-10">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            <StaggerItem>
              <ScaleIn delay={0} duration={0.5}>
                <div className="flex flex-col items-center text-center p-6 rounded-lg bg-card border">
                  <div className="rounded-full bg-primary/10 p-3 mb-4">
                    <ShieldCheck className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">100% Authentic</h3>
                  <p className="text-sm text-muted-foreground">
                    All medicines are sourced from licensed and verified sellers
                  </p>
                </div>
              </ScaleIn>
            </StaggerItem>

            <StaggerItem>
              <ScaleIn delay={0} duration={0.5}>
                <div className="flex flex-col items-center text-center p-6 rounded-lg bg-card border">
                  <div className="rounded-full bg-primary/10 p-3 mb-4">
                    <Truck className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">Fast Delivery</h3>
                  <p className="text-sm text-muted-foreground">
                    Quick and secure delivery right to your doorstep
                  </p>
                </div>
              </ScaleIn>
            </StaggerItem>

            <StaggerItem>
              <ScaleIn delay={0} duration={0.5}>
                <div className="flex flex-col items-center text-center p-6 rounded-lg bg-card border">
                  <div className="rounded-full bg-primary/10 p-3 mb-4">
                    <Clock className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">24/7 Available</h3>
                  <p className="text-sm text-muted-foreground">
                    Order anytime, anywhere with our easy-to-use platform
                  </p>
                </div>
              </ScaleIn>
            </StaggerItem>
          </div>
      </StaggerContainer>

      {/* Background */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-1/2 top-0 -translate-x-1/2 blur-3xl opacity-20">
          <div className="aspect-[1155/678] w-[72.1875rem] bg-gradient-to-tr from-primary to-primary/50" />
        </div>
      </div>
    </section>
  )
}
