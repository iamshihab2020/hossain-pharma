import { Navbar } from '@/components/layout/navbar'

export default function HomePage() {
  return (
    <>
      <Navbar />
      <div className="min-h-screen">
        <section className="container py-20">
          <div className="text-center space-y-4">
            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
              Welcome to Hossain Pharmaceuticals
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Your trusted platform for purchasing quality medicines from verified sellers
            </p>
          </div>
        </section>
      </div>
    </>
  )
}
