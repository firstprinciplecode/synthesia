import NextAuth from 'next-auth'
import GitHub from 'next-auth/providers/github'
import Google from 'next-auth/providers/google'
import Credentials from 'next-auth/providers/credentials'

export const authOptions = {
  providers: [
    GitHub({
      clientId: process.env.GITHUB_ID || '',
      clientSecret: process.env.GITHUB_SECRET || '',
    }),
    Google({
      clientId: process.env.GOOGLE_ID || '',
      clientSecret: process.env.GOOGLE_SECRET || '',
    }),
    Credentials({
      name: 'Email and Password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = String(credentials?.email || '')
        const password = String(credentials?.password || '')
        if (!email || !password) return null
        try {
          const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_HTTP || 'http://localhost:3001'}/api/local-auth/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          })
          if (!res.ok) return null
          const user = await res.json()
          return user && user.id ? user : null
        } catch {
          return null
        }
      },
    }),
  ],
  session: { strategy: 'jwt' as const },
  pages: { signIn: '/signin' },
  callbacks: {
    async jwt({ token, account, profile, user }: any) {
      if (user?.id) token.userId = user.id
      if (account && profile) {
        token.userId = (profile as any).email || token.email || token.sub || token.userId
      }
      return token
    },
    async session({ session, token }: any) {
      (session as any).userId = token.userId || token.email || token.sub
      return session
    },
    async redirect({ url, baseUrl }: any) {
      // Always land on dashboard after sign-in
      try {
        const b = new URL(baseUrl)
        return `${b.origin}/dashboard`
      } catch {
        return '/dashboard'
      }
    },
  },
}

const handler = NextAuth(authOptions as any)
export { handler as GET, handler as POST }


