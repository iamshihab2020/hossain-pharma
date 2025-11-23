import { Navbar } from '@/components/layout/navbar'

export default function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <Navbar />
      <main className="flex flex-col gap-16 px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </>
  )
}
