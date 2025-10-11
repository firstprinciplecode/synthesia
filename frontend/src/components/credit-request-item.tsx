"use client"

import { Check, X, Coins, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useState } from "react"
import { useSession } from "next-auth/react"

interface CreditRequestItemProps {
  request: {
    id: string
    agentId: string
    amountRequested: string
    reason: string | null
    status: string
    createdAt: Date | string
    agent?: {
      name: string
      avatar?: string | null
    } | null
  }
  onApprove?: () => void
  onReject?: () => void
}

export function CreditRequestItem({ request, onApprove, onReject }: CreditRequestItemProps) {
  const { data: session } = useSession()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleApprove = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const userId = (session as any)?.userId
      const res = await fetch(`/api/wallet/approve-request/${request.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(userId ? { 'x-user-id': userId } : {}),
        },
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to approve request')
      }

      onApprove?.()
    } catch (err: any) {
      setError(err.message || 'Failed to approve request')
    } finally {
      setLoading(false)
    }
  }

  const handleReject = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const userId = (session as any)?.userId
      const res = await fetch(`/api/wallet/reject-request/${request.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(userId ? { 'x-user-id': userId } : {}),
        },
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to reject request')
      }

      onReject?.()
    } catch (err: any) {
      setError(err.message || 'Failed to reject request')
    } finally {
      setLoading(false)
    }
  }

  const amount = parseFloat(request.amountRequested)
  const agentName = request.agent?.name || 'Unknown Agent'
  const isPending = request.status === 'PENDING'

  return (
    <Card className={isPending ? 'border-amber-200 dark:border-amber-900' : ''}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-amber-100 dark:bg-amber-900 flex items-center justify-center">
              <Coins className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <CardTitle className="text-base">Credit Request</CardTitle>
              <CardDescription>
                {agentName} needs {amount.toLocaleString()} credits
              </CardDescription>
            </div>
          </div>
          {!isPending && (
            <span className={`text-xs px-2 py-1 rounded ${
              request.status === 'APPROVED' 
                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
            }`}>
              {request.status}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {request.reason && (
          <p className="text-sm text-muted-foreground mb-4">
            {request.reason}
          </p>
        )}
        
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 mb-4">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        )}

        {isPending && (
          <div className="flex gap-2">
            <Button
              onClick={handleApprove}
              disabled={loading}
              size="sm"
              className="flex-1"
            >
              <Check className="h-4 w-4 mr-2" />
              Approve
            </Button>
            <Button
              onClick={handleReject}
              disabled={loading}
              variant="outline"
              size="sm"
              className="flex-1"
            >
              <X className="h-4 w-4 mr-2" />
              Reject
            </Button>
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-4">
          {new Date(request.createdAt).toLocaleString()}
        </p>
      </CardContent>
    </Card>
  )
}

