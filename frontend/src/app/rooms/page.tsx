"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function RoomsPage(): React.JSX.Element {
  const router = useRouter();
  const [agentIds, setAgentIds] = useState<string>("");
  const [userIds, setUserIds] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [creating, setCreating] = useState<boolean>(false);
  const [joinId, setJoinId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [actors, setActors] = useState<Array<{ id: string; name: string }>>([]);
  const [agentSearch, setAgentSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [aRes, uRes] = await Promise.all([
          fetch('/api/agents', { cache: 'no-store' }),
          fetch('/api/actors', { cache: 'no-store' }),
        ]);
        if (!cancelled) {
          try {
            const aData = await aRes.json();
            const aList = Array.isArray(aData) ? aData : (Array.isArray(aData?.agents) ? aData.agents : []);
            setAgents(aList.map((x: any) => ({ id: x.id, name: x.name || 'Agent' })));
          } catch {}
          try {
            const uData = await uRes.json();
            const actorsArr = Array.isArray(uData) ? uData : (Array.isArray(uData?.actors) ? uData.actors : []);
            const users = (actorsArr || []).filter((x: any) => String(x.type) === 'user').map((x: any) => ({ id: x.id, name: x.displayName || 'User' }));
            setActors(users);
          } catch {}
        }
      } catch {}
    })();
    return () => { cancelled = true };
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const ids = agentIds
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length === 0) {
        setError("Enter at least one agent ID");
        setCreating(false);
        return;
      }
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentIds: ids, participants: userIds.split(',').map(s=>s.trim()).filter(Boolean), title }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Create failed: ${res.status} ${txt}`);
      }
      const data = (await res.json()) as any;
      const rid: string | undefined = data?.roomId || data?.id;
      if (!rid) throw new Error("Missing room id in response");
      router.push(`/c/${rid}`);
    } catch (e: any) {
      setError(e?.message || "Failed to create room");
    } finally {
      setCreating(false);
    }
  }

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!joinId.trim()) {
      setError("Enter a room ID to join");
      return;
    }
    router.push(`/c/${joinId.trim()}`);
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      <h2 className="text-xl font-semibold">Rooms</h2>

      {error ? (
        <div className="text-sm text-red-600">{error}</div>
      ) : null}

      <form onSubmit={handleCreate} className="space-y-3 p-4 border rounded-md">
        <div className="font-medium">Create a room</div>
        <label className="block text-sm">Agent IDs (comma separated)</label>
        <input
          type="text"
          className="w-full px-3 py-2 border rounded-md bg-background"
          value={agentIds}
          onChange={(e) => setAgentIds(e.target.value)}
          placeholder="6049f7be-..."
        />
        <div className="text-xs text-muted-foreground">or pick from list</div>
        <input className="w-full px-3 py-2 border rounded-md bg-background" placeholder="Search agents…" value={agentSearch} onChange={(e) => setAgentSearch(e.target.value)} />
        <div className="max-h-40 overflow-auto grid grid-cols-2 gap-2">
          {agents.filter(a => a.name.toLowerCase().includes(agentSearch.toLowerCase()) || a.id.includes(agentSearch)).map(a => (
            <button type="button" key={a.id} onClick={() => setAgentIds(prev => prev ? (prev + "," + a.id) : a.id)} className="text-left text-xs border rounded px-2 py-1 hover:bg-accent">
              <div className="font-medium truncate">{a.name}</div>
              <div className="text-muted-foreground truncate">{a.id}</div>
            </button>
          ))}
        </div>
        <label className="block text-sm mt-2">Title (optional)</label>
        <input
          type="text"
          className="w-full px-3 py-2 border rounded-md bg-background"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="WS Social Test"
        />
        <label className="block text-sm mt-2">User Actor IDs (optional, comma separated)</label>
        <input
          type="text"
          className="w-full px-3 py-2 border rounded-md bg-background"
          value={userIds}
          onChange={(e) => setUserIds(e.target.value)}
          placeholder="actor-id-1, actor-id-2"
        />
        <div className="text-xs text-muted-foreground">or pick from list</div>
        <input className="w-full px-3 py-2 border rounded-md bg-background" placeholder="Search users…" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
        <div className="max-h-40 overflow-auto grid grid-cols-2 gap-2">
          {actors.filter(u => u.name.toLowerCase().includes(userSearch.toLowerCase()) || u.id.includes(userSearch)).map(u => (
            <button type="button" key={u.id} onClick={() => setUserIds(prev => prev ? (prev + "," + u.id) : u.id)} className="text-left text-xs border rounded px-2 py-1 hover:bg-accent">
              <div className="font-medium truncate">{u.name}</div>
              <div className="text-muted-foreground truncate">{u.id}</div>
            </button>
          ))}
        </div>
        <button
          type="submit"
          disabled={creating}
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground disabled:opacity-60"
        >
          {creating ? "Creating..." : "Create & Open"}
        </button>
      </form>

      <form onSubmit={handleJoin} className="space-y-3 p-4 border rounded-md">
        <div className="font-medium">Join an existing room</div>
        <label className="block text-sm">Room ID</label>
        <input
          type="text"
          className="w-full px-3 py-2 border rounded-md bg-background"
          value={joinId}
          onChange={(e) => setJoinId(e.target.value)}
          placeholder="d669e5e6-..."
        />
        <button
          type="submit"
          className="px-4 py-2 rounded-md bg-secondary text-secondary-foreground"
        >
          Join
        </button>
      </form>
    </div>
  );
}


