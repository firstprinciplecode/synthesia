'use client'

import * as React from 'react'

type TabsContext = { value: string; setValue: (v: string) => void }
const Ctx = React.createContext<TabsContext | null>(null)

export function Tabs({ defaultValue, value: controlled, onValueChange, children }: { defaultValue?: string; value?: string; onValueChange?: (v: string) => void; children: React.ReactNode }) {
  const [val, setVal] = React.useState<string>(controlled ?? defaultValue ?? '')
  const isControlled = controlled !== undefined
  const value = isControlled ? (controlled as string) : val
  const setValue = (v: string) => { if (!isControlled) setVal(v); onValueChange?.(v) }
  return <Ctx.Provider value={{ value, setValue }}>{children}</Ctx.Provider>
}

export function TabsList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={className}>{children}</div>
}

export function TabsTrigger({ value, children }: { value: string; children: React.ReactNode }) {
  const ctx = React.useContext(Ctx)!
  const active = ctx?.value === value
  return (
    <button type="button" onClick={() => ctx.setValue(value)} className={`px-3 py-1 text-sm rounded ${active ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}>
      {children}
    </button>
  )
}

export function TabsContent({ value, children }: { value: string; children: React.ReactNode }) {
  const ctx = React.useContext(Ctx)!
  if (ctx?.value !== value) return null
  return <div>{children}</div>
}




