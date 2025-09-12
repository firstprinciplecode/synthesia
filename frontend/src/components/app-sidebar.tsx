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
      url: "/",
      icon: SquareTerminal,
      isActive: true,
      items: [
        { title: "All Messages", url: "/" },
        { title: "Unread", url: "/" },
        { title: "Starred", url: "/" },
      ],
    },
    {
      title: "Agent Studio",
      url: "/agents",
      icon: Bot,
      items: [
        { title: "My Agents", url: "/agents" },
        { title: "Create Agent", url: "/agents/new" },
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

  React.useEffect(() => {
    let cancelled = false
    async function loadProfile() {
      try {
        const res = await fetch("http://localhost:3001/api/profile", { cache: "no-store" })
        if (!res.ok) return
        const p = await res.json()
        if (cancelled) return
        const avatar = typeof p?.avatar === "string" && p.avatar.length
          ? (p.avatar.startsWith("/") ? `http://localhost:3001${p.avatar}` : p.avatar)
          : (typeof p?.avatarUrl === "string" && p.avatarUrl.length
              ? (p.avatarUrl.startsWith("/") ? `http://localhost:3001${p.avatarUrl}` : p.avatarUrl)
              : "")
        setUser({
          name: p?.name || p?.fullName || "User",
          email: p?.email || p?.username || "",
          avatar,
        })
      } catch {}
    }
    loadProfile()
    return () => { cancelled = true }
  }, [])

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher teams={data.teams} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavProjects />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
