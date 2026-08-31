import type { LucideIcon, LucideProps } from "lucide-react";
import {
  ArrowUp, AtSign, Brain, Check, ChevronDown, ChevronRight, CircleGauge, CircleStop, Command, Cpu, File,
  Folder, FolderOpen, GitBranch, Globe, Image, Keyboard, LayoutPanelLeft, ListChecks, Loader2, PanelRight, PanelTop, Paperclip, Play, Plus, Search, Settings, Shield, Terminal, Wrench, X,
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
  | "chevronDown"
  | "chevronRight"
  | "command"
  | "context"
  | "file"
  | "folder"
  | "folderOpen"
  | "image"
  | "keyboard"
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
  add: Plus, arrowUp: ArrowUp, at: AtSign, brain: Brain, browser: Globe, check: Check, chevronDown: ChevronDown, cpu: Cpu, gitBranch: GitBranch, listChecks: ListChecks, spinner: Loader2, wrench: Wrench,
  chevronRight: ChevronRight, command: Command, context: CircleGauge, file: File, folder: Folder, folderOpen: FolderOpen, image: Image, keyboard: Keyboard, paperclip: Paperclip,
  panel: LayoutPanelLeft, panelRight: PanelRight, panelTop: PanelTop, play: Play, search: Search, settings: Settings, shield: Shield,
  stop: CircleStop, terminal: Terminal, x: X,
};

export function Icon({ name, className, ...props }: IconProps): React.JSX.Element {
  const Glyph = icons[name];
  return <Glyph aria-hidden="true" className={className ? `icon ${className}` : "icon"} strokeWidth={1.5} {...props} />;
}
