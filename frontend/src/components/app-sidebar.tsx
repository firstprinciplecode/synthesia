"use client"

import * as React from "react"
import {
  AudioWaveform,
  BookOpen,
  Bot,
  Command,
  Frame,
  // GalleryVerticalEnd,
  Map,
  PieChart,
  Settings2,
  SquareTerminal,
} from "lucide-react"
import Image from "next/image"

// Custom Goose Icon Component
const GooseIcon = ({ className }: { className?: string }) => (
  <Image
    src="/goose.svg"
    alt="Goose"
    width={16}
    height={16}
    className={`${className} brightness-0`}
  />
)

import { NavMain } from "@/components/nav-main"
import { NavProjects } from "@/components/nav-projects"
import { NavUser } from "@/components/nav-user"
import { TeamSwitcher } from "@/components/team-switcher"
import { useSession } from "next-auth/react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"

// Defaults; user will be loaded from backend profile
const data = {
  user: {
    name: "User",
    email: "",
    avatar: "",
  },
  teams: [
    {
      name: "Acme Inc",
      logo: GooseIcon,
      plan: "Enterprise",
    },
    {
      name: "Acme Corp.",
      logo: AudioWaveform,
      plan: "Startup",
    },
    {
      name: "Evil Corp.",
      logo: Command,
      plan: "Free",
    },
  ],
  navMain: [
    {
      title: "Feed",
      url: "/feed",
      icon: BookOpen,
      isActive: true
    },
    {
      title: "Inbox",
      url: "/inbox",
      icon: SquareTerminal,
      isActive: false,
      items: [
        { title: "All Messages", url: "/inbox" },
        { title: "Unread", url: "/inbox" },
        { title: "Starred", url: "/inbox" },
      ],
    },
    {
      title: "Agent Studio",
      url: "/agents",
      icon: Bot,
      items: [
        { title: "My Agents", url: "/agents" },
        { title: "Connections", url: "/connections" },
      ],
    },
    {
      title: "Integrations",
      url: "/integrations",
      icon: Settings2,
      items: [
        { title: "Tools & APIs", url: "/integrations" },
      ],
    },
  ],
  projects: [
    {
      name: "Design Engineering",
      url: "#",
      icon: Frame,
    },
    {
      name: "Sales & Marketing",
      url: "#",
      icon: PieChart,
    },
    {
      name: "Travel",
      url: "#",
      icon: Map,
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const [user, setUser] = React.useState(data.user)
  const [unread, setUnread] = React.useState<number>(0)
  const { status, data: session } = useSession()

  React.useEffect(() => {
    let cancelled = false
    async function loadProfile() {
      try {
        const uid = (session as unknown as { userId?: string })?.userId
        const res = await fetch("/api/profile", { cache: "no-store", headers: uid ? { 'x-user-id': uid } : undefined })
        if (!res.ok) return
        const p = await res.json()
        if (cancelled) return
        const avatar = typeof p?.avatar === "string" && p.avatar.length
          ? (p.avatar.startsWith("/") ? `/uploads${p.avatar.replace(/^\/uploads/, "")}` : p.avatar)
          : (typeof p?.avatarUrl === "string" && p.avatarUrl.length
              ? (p.avatarUrl.startsWith("/") ? p.avatarUrl : p.avatarUrl)
              : "")
        setUser({
          name: p?.name || p?.fullName || "User",
          email: p?.email || p?.username || "",
          avatar,
        })
      } catch {}
    }
    if (status === 'authenticated') {
      loadProfile()
    } else {
      setUser({ name: "", email: "", avatar: "" })
    }
    return () => { cancelled = true }
  }, [status, session])

  // Poll inbox summary
  React.useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch('/api/inbox?summary=1', { cache: 'no-store' })
        if (cancelled) return
        if (res.ok) {
          const j = await res.json()
          setUnread(Number(j?.unread || 0))
        }
      } catch {}
      t = setTimeout(poll, 60000)
    }
    poll()
    return () => { cancelled = true; if (t) clearTimeout(t) }
  }, [])

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher teams={data.teams} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain.map(it => it.title === 'Inbox' ? { ...it, badge: unread > 0 ? String(unread) : undefined } : it)} />
        {status === 'authenticated' ? <NavProjects /> : null}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
