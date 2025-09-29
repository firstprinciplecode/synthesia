import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'

export default withAuth(
  function middleware(req) {
    return NextResponse.next()
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: '/signin',
    },
  }
)

export const config = {
  matcher: [
    '/dashboard',
    '/agents/:path*',
    '/connections',
    '/inbox',
    '/rooms/:path*',
    '/c/:path*',
    '/integrations',
    '/profile',
  ],
}
