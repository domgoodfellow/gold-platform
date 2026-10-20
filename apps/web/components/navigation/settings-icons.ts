import { Building2, CreditCard, Globe, Mail, Palette, Plug, Settings2, ShieldCheck, SlidersHorizontal, UserRound, UsersRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const SETTINGS_ICONS: Record<string, LucideIcon> = {
  'settings-profile': UserRound,
  'settings-security': ShieldCheck,
  'settings-appearance': SlidersHorizontal,
  'settings-general': Building2,
  'settings-branding': Palette,
  'settings-domains': Globe,
  'settings-email': Mail,
  'settings-features': Settings2,
  'settings-access': UsersRound,
  'settings-connections': Plug,
  'settings-plan': CreditCard,
};
