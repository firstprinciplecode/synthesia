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
  Inbox,
} from "lucide-react"
import Image from "next/image"

// Custom Goose Icon Component
const GooseIcon = ({ className }: { className?: string }) => (
  <Image
    src="/geese.svg"
    alt="Geese"
    width={64}
    height={64}
    className={`${className}`}
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
import { useUnreadStore } from "@/stores/unread-store"

// Defaults; user will be loaded from backend profile
const data = {
  user: {
    name: "User",
    email: "",
    avatar: "",
  },
  teams: [
    {
      name: "Goose Cloud",
      logo: GooseIcon,
      plan: "Public Network",
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
    { title: "Inbox", url: "/inbox", icon: Inbox, isActive: false },
    // Integrations moved to user popup menu
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
  const totalUnread = useUnreadStore((state) => state.totalUnread())
  const { status, data: session } = useSession()
  const hasMounted = React.useRef(false)

  React.useEffect(() => {
    hasMounted.current = true
    return () => {
      hasMounted.current = false
    }
  }, [])

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

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher teams={data.teams} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        {status === 'authenticated' ? <NavProjects /> : null}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
