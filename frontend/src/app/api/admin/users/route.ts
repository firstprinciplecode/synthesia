import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_HTTP || 'http://localhost:3001'
    
    const res = await fetch(`${backendUrl}/api/admin/users`, {
      headers: userId ? { 'x-user-id': userId } : {},
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch users' },
        { status: res.status }
      )
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch users' },
      { status: 500 }
    )
  }
}

