import {
  Activity, Bell, Bookmark as BookmarkIcon, BookOpen, Box, Bug, Calendar, ChartBar, ChartLine, ClipboardList, Cloud, Code,
  Container, Cpu, Database, Eye, FileText, Flame, Folder, Gauge, GitBranch, GitMerge, Globe, HardDrive, House, KeyRound,
  Layers, LayoutDashboard, LifeBuoy, Link as LinkIcon, Mail, Monitor, Network, Package, Radar, Rocket, ScrollText, Search,
  Server, Settings, Shield, ShieldAlert, Siren, Star, Terminal, Ticket, Users, Workflow, Wrench, Zap, type LucideIcon,
} from 'lucide-react';
import { ICON_NAMES, type IconName } from '../../shared/constants';

const MAP: Record<IconName, LucideIcon> = {
  globe: Globe, server: Server, database: Database, search: Search, 'chart-line': ChartLine, 'chart-bar': ChartBar,
  activity: Activity, gauge: Gauge, bell: Bell, siren: Siren, shield: Shield, 'shield-alert': ShieldAlert,
  'key-round': KeyRound, terminal: Terminal, code: Code, 'git-branch': GitBranch, 'git-merge': GitMerge, workflow: Workflow,
  wrench: Wrench, settings: Settings, cloud: Cloud, 'hard-drive': HardDrive, network: Network, cpu: Cpu, container: Container,
  box: Box, layers: Layers, package: Package, rocket: Rocket, zap: Zap, 'book-open': BookOpen, 'file-text': FileText,
  'scroll-text': ScrollText, 'clipboard-list': ClipboardList, 'life-buoy': LifeBuoy, ticket: Ticket, users: Users, mail: Mail,
  calendar: Calendar, bug: Bug, flame: Flame, eye: Eye, radar: Radar, monitor: Monitor, 'layout-dashboard': LayoutDashboard,
  folder: Folder, bookmark: BookmarkIcon, link: LinkIcon, star: Star, house: House,
};

export { ICON_NAMES };

export function NamedIcon({ name, size = 18, className }: { name: string | null | undefined; size?: number; className?: string }) {
  const Cmp = name && name in MAP ? MAP[name as IconName] : LinkIcon;
  return <Cmp size={size} className={className} aria-hidden="true" />;
}

export function hasIcon(name: string | null | undefined): boolean {
  return !!name && name in MAP;
}
