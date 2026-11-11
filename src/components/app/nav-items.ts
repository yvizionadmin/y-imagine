import {
  Activity,
  Bot,
  Building2,
  ChartColumn,
  Clapperboard,
  Clock,
  Coins,
  CreditCard,
  LayoutGrid,
  Shapes,
  SwatchBook,
  UserRound,
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
  | "agents"
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
  // Agents (B3): the assistant that uses the tools itself, next to Chat.
  { key: "agents", href: "/agents", icon: Bot },
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

/** Super-admin console pages in the ⌘K search. */
export const searchAdminItems: Destination[] = adminItems.map((item) => ({ ...item, group: "admin" }));

// ⌘K search (top bar): every page a member can open. It only navigates; each page still checks access.
export type DestinationGroup = "tools" | "workspace" | "settings" | "admin";
export type Destination = { key: string; href: `/${string}`; icon: LucideIcon; group: DestinationGroup };

export const DESTINATIONS: Destination[] = [
  { key: "studio", href: "/home", icon: Sparkles, group: "tools" },
  { key: "generate", href: "/generate", icon: WandSparkles, group: "tools" },
  { key: "generateBulk", href: "/generate/bulk", icon: Layers, group: "tools" },
  { key: "recolor", href: "/recolor", icon: Palette, group: "tools" },
  { key: "recolorBulk", href: "/recolor/bulk", icon: Layers, group: "tools" },
  { key: "aplus", href: "/aplus", icon: Image, group: "tools" },
  { key: "aplusBulk", href: "/aplus/bulk", icon: Layers, group: "tools" },
  { key: "looks", href: "/looks", icon: Star, group: "tools" },
  { key: "boards", href: "/looks/boards", icon: LayoutGrid, group: "tools" },
  { key: "resize", href: "/resize", icon: Crop, group: "tools" },
  { key: "editor", href: "/editor", icon: Clapperboard, group: "tools" },
  { key: "director", href: "/editor/director", icon: Clapperboard, group: "tools" },
  { key: "characters", href: "/editor/characters", icon: UserRound, group: "tools" },
  { key: "copy", href: "/copy", icon: PenLine, group: "tools" },
  { key: "copyBulk", href: "/copy/bulk", icon: Layers, group: "tools" },
  { key: "chat", href: "/chat", icon: MessageSquare, group: "tools" },
  { key: "agents", href: "/agents", icon: Bot, group: "tools" },
  { key: "templates", href: "/templates", icon: ImagePlus, group: "tools" },
  { key: "qr", href: "/qr", icon: QrCode, group: "tools" },
  { key: "links", href: "/links", icon: Link, group: "tools" },
  { key: "history", href: "/history", icon: Clock, group: "workspace" },
  { key: "analytics", href: "/dashboard", icon: ChartColumn, group: "workspace" },
  { key: "team", href: "/settings/team", icon: UsersRound, group: "settings" },
  { key: "apiKeys", href: "/settings/api-keys", icon: KeyRound, group: "settings" },
  { key: "integrations", href: "/settings/integrations", icon: Plug, group: "settings" },
  { key: "brand", href: "/settings/brand", icon: SwatchBook, group: "settings" },
  { key: "productTypes", href: "/settings/product-types", icon: Shapes, group: "settings" },
  { key: "billing", href: "/settings/billing", icon: CreditCard, group: "settings" },
];

export const DESTINATION_GROUPS: DestinationGroup[] = ["tools", "workspace", "settings", "admin"];

/** Matches every word of the query against the page's name and its description. */
export function matchDestinations<T extends { label: string; hint: string }>(items: T[], query: string): T[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((item) => {
    const text = `${item.label} ${item.hint}`.toLocaleLowerCase();
    return words.every((w) => text.includes(w));
  });
}

