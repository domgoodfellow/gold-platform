import { Banknote, Building2, CreditCard, Globe, Mail, Palette, Plug, Settings2, ShieldCheck, SlidersHorizontal, Tags, UserRound, UsersRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const SETTINGS_ICONS: Record<string, LucideIcon> = {
  'settings-profile': UserRound,
  'settings-security': ShieldCheck,
  'settings-appearance': SlidersHorizontal,
  'settings-general': Building2,
  'settings-payments': Banknote,
  'settings-branding': Palette,
  'settings-domains': Globe,
  'settings-email': Mail,
  'settings-features': Settings2,
  'settings-terminology': Tags,
  'settings-access': UsersRound,
  'settings-connections': Plug,
  'settings-plan': CreditCard,
};
