"use client"

import * as React from "react"
import {
  AudioWaveform,
  BookOpen,
  Bot,
  Command,
  Frame,
  GalleryVerticalEnd,
  Map,
  PieChart,
  Settings2,
  SquareTerminal,
} from "lucide-react"

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
      logo: GalleryVerticalEnd,
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
      title: "Inbox",
      url: "/inbox",
      icon: SquareTerminal,
      isActive: true,
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
        { title: "Create Agent", url: "/agents/new" },
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
  const { status, data: session } = useSession()

  React.useEffect(() => {
    let cancelled = false
    async function loadProfile() {
      try {
        const uid = (session as any)?.userId
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
  }, [status])

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
