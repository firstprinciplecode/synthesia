'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type User = {
  id: string
  email: string
  name: string
  balance: number
  createdAt: string
}

type Agent = {
  id: string
  name: string
  owner: {
    id: string
    name: string
    email: string
  }
  isPublic: boolean
  createdAt: string
}

type Follow = {
  id: string
  follower: {
    id: string
    name: string
    type: string
  }
  following: {
    id: string
    name: string
    type: string
  }
  metadata: any
  createdAt: string
}

export default function AdminPage() {
  const { data: session } = useSession()
  const [users, setUsers] = useState<User[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [follows, setFollows] = useState<Follow[]>([])
  const [activeTab, setActiveTab] = useState('users')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!session) return

    const fetchData = async () => {
      try {
        setLoading(true)
        const uid = (session as any)?.userId

        const [usersRes, agentsRes, followsRes] = await Promise.all([
          fetch('/api/admin/users', { headers: uid ? { 'x-user-id': uid } : {} }),
          fetch('/api/admin/agents', { headers: uid ? { 'x-user-id': uid } : {} }),
          fetch('/api/admin/follows', { headers: uid ? { 'x-user-id': uid } : {} }),
        ])

        if (!usersRes.ok || !agentsRes.ok || !followsRes.ok) {
          throw new Error('Failed to fetch admin data')
        }

        const [usersData, agentsData, followsData] = await Promise.all([
          usersRes.json(),
          agentsRes.json(),
          followsRes.json(),
        ])

        setUsers(usersData)
        setAgents(agentsData)
        setFollows(followsData)
        setError(null)
      } catch (err: any) {
        setError(err.message || 'Failed to load admin data')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [session])

  if (!session) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p>Please sign in to access the admin panel</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p>Loading...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Card className="w-96">
          <CardHeader>
            <CardTitle>Error</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Admin Control Panel</h1>
      
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="users">Users ({users.length})</TabsTrigger>
          <TabsTrigger value="agents">Agents ({agents.length})</TabsTrigger>
          <TabsTrigger value="follows">Follows ({follows.length})</TabsTrigger>
        </TabsList>
        
        <TabsContent value="users">
          <Card>
            <CardHeader>
              <CardTitle>All Users</CardTitle>
              <CardDescription>List of all registered users with wallet balances</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>{u.name || '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{u.email}</TableCell>
                      <TableCell>{u.balance.toFixed(2)} credits</TableCell>
                      <TableCell>{new Date(u.createdAt).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="agents">
          <Card>
            <CardHeader>
              <CardTitle>All Agents</CardTitle>
              <CardDescription>List of all agents with owner information</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent Name</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Public</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agents.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell>
                        <div>
                          <div>{a.owner?.name || '—'}</div>
                          <div className="text-xs text-muted-foreground">{a.owner?.email}</div>
                        </div>
                      </TableCell>
                      <TableCell>{a.isPublic ? 'Yes' : 'No'}</TableCell>
                      <TableCell>{new Date(a.createdAt).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="follows">
          <Card>
            <CardHeader>
              <CardTitle>All Follows</CardTitle>
              <CardDescription>List of active follow relationships</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Follower</TableHead>
                    <TableHead>Following</TableHead>
                    <TableHead>Metadata</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {follows.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{f.follower?.name || '—'}</div>
                          <div className="text-xs text-muted-foreground">{f.follower?.type}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{f.following?.name || '—'}</div>
                          <div className="text-xs text-muted-foreground">{f.following?.type}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs font-mono max-w-xs truncate">
                          {f.metadata ? JSON.stringify(f.metadata) : '—'}
                        </div>
                      </TableCell>
                      <TableCell>{new Date(f.createdAt).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

