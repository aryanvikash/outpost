import type { ComponentType } from "react";
import { Link, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { Tent, Server, Cable, ScrollText, Settings, LogOut } from "lucide-react";
import { clearToken } from "../api";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";

const PLATFORM_ITEMS = [{ to: "/", label: "Machines", icon: Server }];

const DEPLOY_ITEMS = [
  { to: "/connections", label: "Connections", icon: Cable },
  { to: "/webhooks", label: "Webhook log", icon: ScrollText },
];

const WORKSPACE_ITEMS = [{ to: "/settings", label: "Settings", icon: Settings }];

export function AppSidebar() {
  const navigate = useNavigate();

  return (
    <Sidebar>
      <SidebarHeader>
        <Link to="/" className="flex items-center gap-3 rounded-md p-1">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary to-violet-500 shadow-lg shadow-primary/30">
            <Tent className="h-4 w-4 text-white" />
          </span>
          <span className="min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
            <span className="block truncate text-[15px] font-bold tracking-tight">Outpost</span>
            <span className="block truncate text-[11px] text-muted-foreground/70">API</span>
          </span>
        </Link>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        <NavGroup label="Platform" items={PLATFORM_ITEMS} />
        <NavGroup label="Deploy" items={DEPLOY_ITEMS} />
        <NavGroup label="Workspace" items={WORKSPACE_ITEMS} />
      </SidebarContent>

      <SidebarFooter>
        <SidebarSeparator className="mb-2" />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Sign out"
              onClick={() => {
                clearToken();
                navigate({ to: "/login" });
              }}
            >
              <LogOut />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

function NavGroup({
  label,
  items,
}: {
  label: string;
  items: Array<{ to: string; label: string; icon: ComponentType<{ className?: string }> }>;
}) {
  const matchRoute = useMatchRoute();
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map(({ to, label: itemLabel, icon: Icon }) => {
            const isActive = !!matchRoute({ to, fuzzy: to !== "/" });
            return (
              <SidebarMenuItem key={to}>
                <SidebarMenuButton asChild isActive={isActive} tooltip={itemLabel}>
                  <Link to={to}>
                    <Icon />
                    <span>{itemLabel}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
