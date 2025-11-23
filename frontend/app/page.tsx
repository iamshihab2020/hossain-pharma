import { Navbar } from '@/components/layout/navbar'
import { Hero } from './../components/pages/home/hero';

export default function HomePage() {
  return (
    <>
      <Navbar />
      <main className="flex flex-col gap-16 container mx-auto  ">
        <Hero />
      </main>
    </>
  )
}
