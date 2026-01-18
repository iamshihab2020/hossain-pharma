'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { useState, useEffect } from 'react'
import { useAuthStore } from '@/lib/stores/auth-store'
import { useCartStore } from '@/lib/stores/cart-store'

// Component to handle store hydration
function StoreHydration({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, setLoading } = useAuthStore()
  const { syncWithServer } = useCartStore()
  const [isHydrated, setIsHydrated] = useState(false)

  useEffect(() => {
    // Mark as hydrated after first render
    setIsHydrated(true)
    setLoading(false)
  }, [setLoading])

  useEffect(() => {
    // Sync cart with server when user logs in
    if (isHydrated && isAuthenticated && user?.email) {
      syncWithServer(user.email)
    }
  }, [isHydrated, isAuthenticated, user?.email, syncWithServer])

  return <>{children}</>
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            refetchOnWindowFocus: false,
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem
        disableTransitionOnChange
      >
        <StoreHydration>
          {children}
        </StoreHydration>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
