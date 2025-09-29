"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"
import Image from "next/image"
import Link from "next/link"

export default function SignUpPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/local-auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || "Failed to sign up")
      }
      router.push("/signin")
    } catch (e) {
      const msg = (e as { message?: string })?.message || "Failed to sign up"
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-card flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Card>
          <CardHeader className="text-center">
            <div className="flex items-center justify-center mb-2">
              <Image src="/goose.svg" alt="Goose" width={28} height={28} className="filter brightness-0 dark:brightness-100" />
            </div>
            <CardTitle className="text-xl">Create an account</CardTitle>
            <CardDescription>Sign up with email and password</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit}>
              <div className="grid gap-6">
                <Input type="text" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
                <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                {error ? <div className="text-sm text-red-500">{error}</div> : null}
                <Button type="submit" className="w-full" disabled={loading}>{loading ? 'Creating…' : 'Create account'}</Button>
                <div className="text-center text-sm text-muted-foreground">
                  Already have an account? <Link href="/signin" className="underline underline-offset-4">Sign in</Link>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}


