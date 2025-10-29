'use client'

import React from 'react'
import { SessionProvider } from 'next-auth/react'
import { ThemeProvider } from '@/components/theme-provider'
import { AnimatePresence } from 'framer-motion'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <AnimatePresence mode="wait">
          {children}
        </AnimatePresence>
      </ThemeProvider>
    </SessionProvider>
  )
}


