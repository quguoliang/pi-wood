import type { LucideIcon, LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ArrowUp, AtSign, Brain, Check, ChevronDown, ChevronRight, Circle, CircleGauge, CircleStop, Command, Cpu, Ellipsis, File,
  Folder, FolderOpen, GitBranch, Globe, Image, Keyboard, LayoutPanelLeft, ListChecks, Loader2, MessageSquare, Package, PanelRight, PanelTop, Paperclip, Play, Plus, Search, Settings, Shield, Terminal, Wrench, X,
} from "lucide-react";

export type IconName =
  | "add"
  | "arrowUp"
  | "at"
  | "brain"
  | "cpu"
  | "gitBranch"
  | "listChecks"
  | "spinner"
  | "wrench"
  | "browser"
  | "check"
  | "circle"
  | "chevronDown"
  | "chevronRight"
  | "command"
  | "context"
  | "ellipsis"
  | "file"
  | "folder"
  | "folderOpen"
  | "image"
  | "keyboard"
  | "message"
  | "package"
  | "paperclip"
  | "panel"
  | "panelRight"
  | "panelTop"
  | "play"
  | "search"
  | "settings"
  | "shield"
  | "stop"
  | "terminal"
  | "x";

interface IconProps extends LucideProps {
  name: IconName;
}

const icons: Record<IconName, LucideIcon> = {
  add: Plus, arrowUp: ArrowUp, at: AtSign, brain: Brain, browser: Globe, check: Check, circle: Circle, chevronDown: ChevronDown, cpu: Cpu, gitBranch: GitBranch, listChecks: ListChecks, spinner: Loader2, wrench: Wrench,
  chevronRight: ChevronRight, command: Command, context: CircleGauge, ellipsis: Ellipsis, file: File, folder: Folder, folderOpen: FolderOpen, image: Image, keyboard: Keyboard, message: MessageSquare, package: Package, paperclip: Paperclip,
  panel: LayoutPanelLeft, panelRight: PanelRight, panelTop: PanelTop, play: Play, search: Search, settings: Settings, shield: Shield,
  stop: CircleStop, terminal: Terminal, x: X,
};

export function Icon({ name, className, ...props }: IconProps): React.JSX.Element {
  const Glyph = icons[name];
  return <Glyph aria-hidden="true" className={cn("size-4 shrink-0", className)} strokeWidth={1.5} {...props} />;
}
