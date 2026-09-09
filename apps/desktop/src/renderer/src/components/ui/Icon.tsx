import type { LucideIcon, LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Activity, Archive, ArrowLeft, ArrowRight, ArrowUp, AtSign, Bot, Brain, Check, ChevronDown, ChevronRight, Circle, CircleGauge, CircleStop, Command, Cpu, Ellipsis, File,
  Folder, FolderOpen, GitBranch, GitFork, Globe, Image, Keyboard, KeyRound, LayoutPanelLeft, ListChecks, ListTree, Loader2, MessageSquare, Package, Palette, PanelLeft, PanelRight, PanelTop, Paperclip, Play, Plus, Puzzle, RotateCw, Search, Settings, Shield, SlidersHorizontal, Sparkles, Terminal, Wrench, X,
} from "lucide-react";

export type IconName =
  | "activity"
  | "add"
  | "archive"
  | "arrowLeft"
  | "arrowRight"
  | "arrowUp"
  | "at"
  | "bot"
  | "brain"
  | "cpu"
  | "gitBranch"
  | "gitFork"
  | "key"
  | "listChecks"
  | "listTree"
  | "palette"
  | "puzzle"
  | "sliders"
  | "sparkles"
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
  | "sidebar"
  | "play"
  | "refresh"
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
  activity: Activity, add: Plus, archive: Archive, arrowLeft: ArrowLeft, arrowRight: ArrowRight, arrowUp: ArrowUp, at: AtSign, bot: Bot, brain: Brain, browser: Globe, check: Check, circle: Circle, chevronDown: ChevronDown, cpu: Cpu, gitBranch: GitBranch, gitFork: GitFork, key: KeyRound, listChecks: ListChecks, listTree: ListTree, palette: Palette, puzzle: Puzzle, refresh: RotateCw, sliders: SlidersHorizontal, sparkles: Sparkles, spinner: Loader2, wrench: Wrench,
  chevronRight: ChevronRight, command: Command, context: CircleGauge, ellipsis: Ellipsis, file: File, folder: Folder, folderOpen: FolderOpen, image: Image, keyboard: Keyboard, message: MessageSquare, package: Package, paperclip: Paperclip,
  panel: LayoutPanelLeft, panelRight: PanelRight, panelTop: PanelTop, play: Play, search: Search, settings: Settings, shield: Shield, sidebar: PanelLeft,
  stop: CircleStop, terminal: Terminal, x: X,
};

export function Icon({ name, className, ...props }: IconProps): React.JSX.Element {
  const Glyph = icons[name];
  return <Glyph aria-hidden="true" className={cn("size-4 shrink-0", className)} strokeWidth={1.5} {...props} />;
}
