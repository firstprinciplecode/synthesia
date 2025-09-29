'use client'

import { useEffect, useRef } from 'react'
import { useUnreadStore } from '@/stores/unread-store'
import { WSClient, resolveWsUrl } from '@/lib/chat'
import { useSession } from 'next-auth/react'

export default function WsNotifier() {
  const setUnread = useUnreadStore(s => s.setUnread)
  const clearUnread = useUnreadStore(s => s.clearUnread)
  const clientRef = useRef<WSClient | null>(null)
  const { data: session, status } = useSession()

  // Keep global debug handle
  useEffect(() => { try { (window as any).__unreadStore = useUnreadStore } catch {} }, [])

  // Ensure uid/actor globals are set before connecting
  useEffect(() => {
    if (status !== 'authenticated') return
    const uid = (session as any)?.userId || (session as any)?.user?.email || ''
    try { (window as any).__superagent_uid = uid } catch {}
    // Resolve primary actor id for client-side filtering
    ;(async () => {
      try {
        const headers = uid ? { 'x-user-id': uid } as Record<string, string> : undefined
        const res = await fetch('/api/actors/me', { cache: 'no-store', headers })
        if (res.ok) {
          const me = await res.json()
          if (me?.id) {
            try { (window as any).__superagent_actor = String(me.id) } catch {}
          }
        }
      } catch {}
    })()
  }, [status, session])

  // (Re)connect when auth context changes so ws URL includes ?uid=
  useEffect(() => {
    if (status !== 'authenticated') return
    try { (window as any).__ws = { readyState: 0 } } catch {}

    const wsUrl = resolveWsUrl()
    try { console.log('[WsNotifier] connecting', { wsUrl }) } catch {}
    const client = new WSClient({
      wsUrl,
      getParticipants: () => [],
      getDefaults: () => ({}),
      setUnread,
      clearUnread,
      onConnected: async () => {
        try { (window as any).__ws = { readyState: 1 } } catch {}
        try { console.log('[WsNotifier] connected') } catch {}
        // Join all DM rooms for this user so unread events are guaranteed to reach this tab
        try {
          const uid = (window as any).__superagent_uid as string | undefined
          const headers = uid ? { 'x-user-id': uid } as Record<string, string> : undefined
          const r = await fetch('/api/rooms', { cache: 'no-store', headers })
          if (r.ok) {
            const data = await r.json()
            const rooms = Array.isArray(data) ? data : (Array.isArray(data?.rooms) ? data.rooms : [])
            // Collect all of my actorIds from room participants (isSelf)
            const myActorIds = new Set<string>()
            for (const room of rooms) {
              const parts = Array.isArray((room as any)?.participants) ? (room as any).participants : []
              for (const p of parts) {
                if (p?.isSelf && p?.actorId) myActorIds.add(String(p.actorId))
              }
            }
            try { (window as any).__superagent_actor_aliases = Array.from(myActorIds) } catch {}
            for (const room of rooms) {
              if ((room as any)?.kind === 'dm' && room?.id) {
                try { await client.joinRoom(String(room.id), uid) } catch {}
              }
            }
          }
        } catch {}
      },
      onDisconnected: () => { try { (window as any).__ws = { readyState: 0 }; console.log('[WsNotifier] disconnected') } catch {} },
      onError: (e) => { try { (window as any).__ws = { readyState: 0 }; console.error('[WsNotifier] error', e) } catch {} },
    })

    // Listen for dm.ping and set actor-based unread
    const onDmPing = (ev: any) => {
      try {
        const d = ev?.detail || {}
        const fromActorId = String(d.fromActorId || '')
        if (fromActorId) useUnreadStore.getState().setDmPing(fromActorId, true)
      } catch {}
    }
    try { window.addEventListener('dm-ping', onDmPing as EventListener) } catch {}
    // replace any previous client
    try { clientRef.current?.disconnect() } catch {}
    clientRef.current = client
    client.connect().catch(() => { /* noop */ })
    return () => {
      try { clientRef.current?.disconnect() } catch {}
      clientRef.current = null
      try { (window as any).__ws = { readyState: 0 } } catch {}
      try { window.removeEventListener('dm-ping', onDmPing as EventListener) } catch {}
    }
  }, [status, session, setUnread, clearUnread])

  return null
}


