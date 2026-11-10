import {
  Activity,
  Building2,
  ChartColumn,
  Clapperboard,
  Clock,
  Coins,
  Crop,
  Image,
  ImagePlus,
  Layers,
  KeyRound,
  LayoutDashboard,
  Link,
  MessageSquare,
  Palette,
  PenLine,
  Plug,
  QrCode,
  SlidersHorizontal,
  Sparkles,
  Star,
  Users,
  UsersRound,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";

export type ToolKey =
  | "create"
  | "editor"
  | "generate"
  | "recolor"
  | "aplus"
  | "looks"
  | "copy"
  | "chat"
  | "history"
  | "analytics"
  | "resize"
  | "qr"
  | "links";

/** `soon` items are in the Figma rail but have no page yet; the rail shows them disabled. */
export type NavItem = { key: ToolKey; href: `/${string}`; icon: LucideIcon; soon?: boolean };

// Order matches the Figma icon rail (Section 1, node 98:216). Analytics is not in that rail; it is the
// "Dashboard" item of the dark design (30:6), placed with History since both look back at jobs.
// Copy (product descriptions) and Chat (the assistant) have no Figma rail item; they sit after the image tools.
export const navItems: NavItem[] = [
  { key: "create", href: "/home", icon: Sparkles },
  // Video editor (B10): next to the Studio, where the videos are made.
  { key: "editor", href: "/editor", icon: Clapperboard },
  { key: "generate", href: "/generate", icon: WandSparkles },
  { key: "recolor", href: "/recolor", icon: Palette },
  { key: "aplus", href: "/aplus", icon: Image },
  { key: "looks", href: "/looks", icon: Star },
  { key: "copy", href: "/copy", icon: PenLine },
  { key: "chat", href: "/chat", icon: MessageSquare },
  { key: "history", href: "/history", icon: Clock },
  { key: "analytics", href: "/dashboard", icon: ChartColumn },
  { key: "resize", href: "/resize", icon: Crop },
  { key: "qr", href: "/qr", icon: QrCode },
  { key: "links", href: "/links", icon: Link },
];

/**
 * Image tools grouped under the rail's "AI Image" item (it takes the Generate slot). The rail shows
 * only that item; hovering it opens the menu below, next to the org's image models.
 */
export const AI_IMAGE_KEYS: readonly ToolKey[] = ["generate", "recolor", "aplus", "looks", "resize"];

export type AiImageTool = { key: "create" | "generate" | "generateBulk" | "recolor" | "aplus" | "looks" | "resize"; href: `/${string}`; icon: LucideIcon };

/** The AI Image menu's Tools column, in order. */
export const aiImageTools: AiImageTool[] = [
  { key: "create", href: "/home", icon: ImagePlus },
  { key: "generate", href: "/generate", icon: WandSparkles },
  { key: "generateBulk", href: "/generate/bulk", icon: Layers },
  { key: "recolor", href: "/recolor", icon: Palette },
  { key: "aplus", href: "/aplus", icon: Image },
  { key: "looks", href: "/looks", icon: Star },
  { key: "resize", href: "/resize", icon: Crop },
];

/** What the rail lists: everything except the grouped image tools, which collapse into "generate". */
export const railItems = navItems.filter((item) => item.key === "generate" || !AI_IMAGE_KEYS.includes(item.key));

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
  { key: "adminCredits", href: "/admin/credits", icon: Coins },
  { key: "adminControls", href: "/admin/controls", icon: SlidersHorizontal },
];
