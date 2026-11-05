import {
  Activity,
  Building2,
  ChartColumn,
  Clock,
  Crop,
  Image,
  KeyRound,
  LayoutDashboard,
  Link,
  Palette,
  PenLine,
  Plug,
  QrCode,
  SlidersHorizontal,
  Star,
  Users,
  UsersRound,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";

export type ToolKey =
  | "generate"
  | "recolor"
  | "aplus"
  | "looks"
  | "copy"
  | "history"
  | "analytics"
  | "resize"
  | "qr"
  | "links";

/** `soon` items are in the Figma rail but have no page yet; the rail shows them disabled. */
export type NavItem = { key: ToolKey; href: `/${string}`; icon: LucideIcon; soon?: boolean };

// Order matches the Figma icon rail (Section 1, node 98:216). Analytics is not in that rail; it is the
// "Dashboard" item of the dark design (30:6), placed with History since both look back at jobs.
// Copy (product descriptions) has no Figma rail item; it sits after the image tools.
export const navItems: NavItem[] = [
  { key: "generate", href: "/generate", icon: WandSparkles },
  { key: "recolor", href: "/recolor", icon: Palette },
  { key: "aplus", href: "/aplus", icon: Image },
  { key: "looks", href: "/looks", icon: Star },
  { key: "copy", href: "/copy", icon: PenLine },
  { key: "history", href: "/history", icon: Clock },
  { key: "analytics", href: "/dashboard", icon: ChartColumn },
  { key: "resize", href: "/resize", icon: Crop },
  { key: "qr", href: "/qr", icon: QrCode },
  { key: "links", href: "/links", icon: Link },
];

export function activeTool(pathname: string): NavItem | undefined {
  return navItems.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
}

export type MoreItem = { key: string; href: `/${string}`; icon: LucideIcon };

/** Rail "More" menu: org settings, for everyone. */
export const moreItems: MoreItem[] = [
  { key: "team", href: "/settings/team", icon: UsersRound },
  { key: "apiKeys", href: "/settings/api-keys", icon: KeyRound },
  { key: "integrations", href: "/settings/integrations", icon: Plug },
];

/** Super-admin console pages (rail "More" menu and the console's own nav). */
export const adminItems: MoreItem[] = [
  { key: "adminOverview", href: "/admin", icon: LayoutDashboard },
  { key: "adminOrgs", href: "/admin/organizations", icon: Building2 },
  { key: "adminUsers", href: "/admin/users", icon: Users },
  { key: "adminActivity", href: "/admin/activity", icon: Activity },
  { key: "adminControls", href: "/admin/controls", icon: SlidersHorizontal },
];
