import {
  Calendar,
  CheckSquare,
  ClipboardList,
  FileText,
  FolderOpen,
  Mail,
  MessageSquare,
  Puzzle,
  Sheet as SheetIcon,
  ShieldCheck,
  StickyNote,
  Table,
  Users,
  Video,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { BrandMark } from '@/components/display/brand-mark';

/**
 * A child app's identity, keyed by its own key alone — the same app key (`calendar`, `gmail`)
 * means the same generic glyph regardless of which suite it belongs to, rather than a second
 * registry per connector. Not a brand mark: these are generic Lucide glyphs standing in for what
 * the app *does* (a calendar icon for Calendar), never a vendor's exact logo — see
 * `connector-icon.tsx` for why that boundary exists. An app this registry has no glyph for falls
 * back to the parent connector's own `ConnectorIcon`, never a broken image.
 */
const APP_ICON: Record<string, ReactNode> = {
  calendar: <Calendar className="size-4" />,
  gmail: <Mail className="size-4" />,
  outlook: <Mail className="size-4" />,
  drive: <FolderOpen className="size-4" />,
  onedrive: <FolderOpen className="size-4" />,
  docs: <FileText className="size-4" />,
  sheets: <SheetIcon className="size-4" />,
  excel: <Table className="size-4" />,
  slides: <FileText className="size-4" />,
  forms: <ClipboardList className="size-4" />,
  meet: <Video className="size-4" />,
  teams: <Video className="size-4" />,
  chat: <MessageSquare className="size-4" />,
  tasks: <CheckSquare className="size-4" />,
  keep: <StickyNote className="size-4" />,
  people: <Users className="size-4" />,
  admin_sdk: <ShieldCheck className="size-4" />,
};

export function ConnectorAppIcon({
  appKey,
  label,
  size = 'small',
}: {
  appKey: string;
  label: string;
  size?: 'small' | 'default' | 'large';
}) {
  const icon = APP_ICON[appKey];
  if (!icon) return <BrandMark label={label} icon={<Puzzle className="size-4" />} size={size} />;
  return <BrandMark label={label} icon={icon} size={size} />;
}
