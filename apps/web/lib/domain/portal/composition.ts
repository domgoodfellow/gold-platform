import { DomainError } from '@/lib/domain/errors';
export type PortalModuleConfiguration = { heading: string; variant: string; limit: number; payments?: boolean };

function configurationSchema(variants: readonly string[], payments = false) {
  return { parse(value: unknown): PortalModuleConfiguration {
    if (!keys(value,payments ? ['heading','variant','limit','payments'] : ['heading','variant','limit']) || !text(value.heading,100) || typeof value.variant !== 'string' || !variants.includes(value.variant) || !Number.isInteger(value.limit) || Number(value.limit)<1 || Number(value.limit)>100 || (payments && typeof value.payments !== 'boolean')) return fail();
    return value as PortalModuleConfiguration;
  } };
}
export const PORTAL_MODULES = {
  work: { kind: 'work', label: 'Work', description: 'Work history and appointments for each customer.', heading: 'Your work', variants: ['history', 'upcoming'], defaultVariant: 'history', defaultConfiguration: {heading:'Your work',variant:'history',limit:20}, configurationSchema: configurationSchema(['history','upcoming']), feature: 'portal_history', multiple: true, access: 'Work belonging to the current Portal customer', presenter: 'work', preview: 'labelled_examples' },
  invoices: { kind: 'invoices', label: 'Invoices & payments', description: 'Invoices, balances and available payment actions.', heading: 'Your invoices', variants: ['list', 'summary'], defaultVariant: 'list', defaultConfiguration: {heading:'Your invoices',variant:'list',limit:20,payments:true}, configurationSchema: configurationSchema(['list','summary'],true), feature: 'portal_history', multiple: true, access: 'Customer-owned invoices; Finance verifies payment availability', presenter: 'invoices', preview: 'labelled_examples' },
  forms: { kind: 'forms', label: 'Forms', description: 'Published Forms explicitly offered to customers.', heading: 'Forms', variants: ['list', 'cards'], defaultVariant: 'list', defaultConfiguration: {heading:'Forms',variant:'list',limit:20}, configurationSchema: configurationSchema(['list','cards']), feature: 'portal_auth', multiple: false, access: 'Canonical Portal placement and currently published Form revision', presenter: 'forms', preview: 'labelled_examples' },
} as const;
export type PortalModule = keyof typeof PORTAL_MODULES;
export type PortalModuleInstance = { id: string; kind: PortalModule; config: PortalModuleConfiguration };
export type PortalPage = { id: string; name: string; path: string; modules: PortalModuleInstance[] };
export type PortalContent = {
  version: 2; settings: { title: string; introduction: string; layout: 'comfortable' | 'compact' };
  defaultPageId: string; pages: PortalPage[]; navigation: { pageId: string; label: string }[];
};
const fail = (): never => { throw new DomainError('Invalid Portal definition. Check page paths, navigation and instance configuration.', 'portal.invalid_content'); };
const text = (value: unknown, max: number, empty = false): value is string => typeof value === 'string' && !value.includes('\0') && !/[\uD800-\uDFFF]/u.test(value) && (empty || !!value.trim()) && Array.from(value).length <= max;
const keys = (value: unknown, expected: string[]): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const identity = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);

export function newPortalModule(kind: PortalModule, id: string = crypto.randomUUID()): PortalModuleInstance {
  const registry = PORTAL_MODULES[kind];
  return { id, kind, config: { ...registry.defaultConfiguration } };
}
export const DEFAULT_PORTAL_CONTENT: PortalContent = {
  version: 2, settings: { title: 'Customer portal', introduction: '', layout: 'comfortable' }, defaultPageId: 'home',
  pages: [{ id: 'home', name: 'Home', path: 'home', modules: ['work','forms','invoices'].map(kind => newPortalModule(kind as PortalModule, `home-${kind}`)) }],
  navigation: [{ pageId: 'home', label: 'Home' }],
};
export function upgradePortalContent(value: unknown): unknown {
  if (!keys(value, ['title','introduction','modules']) || !text(value.title,100) || !text(value.introduction,1000,true) || !Array.isArray(value.modules) || !value.modules.length || value.modules.length > 4 || new Set(value.modules).size !== value.modules.length || value.modules.some(kind => typeof kind !== 'string' || !['work','forms','invoices','services'].includes(kind))) return value;
  const kinds = value.modules.filter(kind => kind !== 'services') as PortalModule[];
  return { ...structuredClone(DEFAULT_PORTAL_CONTENT), settings: { title: value.title, introduction: value.introduction, layout: 'comfortable' }, pages: [{ id: 'home', name: 'Home', path: 'home', modules: (kinds.length ? kinds : ['work'] as PortalModule[]).map(kind => newPortalModule(kind, `home-${kind}`)) }] };
}
export function parsePortalModule(value: unknown): PortalModuleInstance {
  if (!keys(value,['id','kind','config']) || !identity(value.id) || typeof value.kind !== 'string' || !Object.hasOwn(PORTAL_MODULES,value.kind)) return fail();
  const kind = value.kind as PortalModule;
  PORTAL_MODULES[kind].configurationSchema.parse(value.config);
  return value as unknown as PortalModuleInstance;
}
export function parsePortalContent(raw: unknown): PortalContent {
  const value = upgradePortalContent(raw);
  if (!keys(value,['version','settings','defaultPageId','pages','navigation']) || value.version !== 2 || !keys(value.settings,['title','introduction','layout']) || !text(value.settings.title,100) || !text(value.settings.introduction,1000,true) || (typeof value.settings.layout !== 'string' || !['comfortable','compact'].includes(value.settings.layout)) || !identity(value.defaultPageId) || !Array.isArray(value.pages) || !value.pages.length || value.pages.length > 12 || !Array.isArray(value.navigation) || !value.navigation.length || value.navigation.length > 12) return fail();
  const pageIds = new Set<string>(); const paths = new Set<string>(); const moduleIds = new Set<string>();
  for (const page of value.pages) {
    if (!keys(page,['id','name','path','modules']) || !identity(page.id) || pageIds.has(page.id) || !text(page.name,80) || typeof page.path !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(page.path) || page.path.length > 64 || paths.has(page.path) || !Array.isArray(page.modules) || !page.modules.length || page.modules.length > 12) return fail();
    pageIds.add(page.id); paths.add(page.path); const kinds = new Set<PortalModule>();
    for (const candidate of page.modules) {
      const instance = parsePortalModule(candidate);
      if (moduleIds.has(instance.id) || (kinds.has(instance.kind) && !PORTAL_MODULES[instance.kind].multiple)) return fail();
      kinds.add(instance.kind); moduleIds.add(instance.id);
    }
  }
  const navIds = new Set<string>();
  for (const entry of value.navigation) {
    if (!keys(entry,['pageId','label']) || !identity(entry.pageId) || !pageIds.has(entry.pageId) || navIds.has(entry.pageId) || !text(entry.label,80)) return fail();
    navIds.add(entry.pageId);
  }
  if (!pageIds.has(value.defaultPageId) || !navIds.has(value.defaultPageId)) return fail();
  return value as unknown as PortalContent;
}
export function portalPageForPath(content: PortalContent, path?: string): PortalPage | null {
  return (path === undefined ? content.pages.find(page => page.id === content.defaultPageId) : content.pages.find(page => page.path === path)) ?? null;
}
export function portalPageHref(page: PortalPage, content: PortalContent): string {
  return page.id === content.defaultPageId ? '/portal' : `/portal/p/${encodeURIComponent(page.path || 'home')}`;
}
export function removePortalPage(content: PortalContent, id: string): PortalContent {
  if (content.pages.length === 1) return content;
  const pages = content.pages.filter(page => page.id !== id);
  let navigation = content.navigation.filter(item => item.pageId !== id);
  const defaultPageId = id === content.defaultPageId ? pages[0].id : content.defaultPageId;
  if (!navigation.some(item => item.pageId === defaultPageId)) navigation = [{ pageId: defaultPageId, label: pages.find(page => page.id === defaultPageId)!.name }, ...navigation];
  return { ...content, pages, navigation, defaultPageId };
}
export const PORTAL_TEMPLATES = [
  { key: 'basic', name: 'Basic Customer Portal', description: 'Work, invoices and offered Forms on a welcoming home page.', category: 'Customer portal', definition: DEFAULT_PORTAL_CONTENT },
  { key: 'service-business', name: 'Service Business Portal', description: 'Upcoming appointments, history, billing and offered Forms on dedicated pages.', category: 'Customer portal', definition: {
    version: 2, settings: { title: 'Customer portal', introduction: '', layout: 'comfortable' }, defaultPageId: 'home',
    pages: [
      { id: 'home', name: 'Home', path: 'home', modules: [{ ...newPortalModule('work','upcoming-work'), config: { heading: 'Upcoming work', variant: 'upcoming', limit: 5 } }] },
      { id: 'work', name: 'Work', path: 'work', modules: [newPortalModule('work','work-history')] },
      { id: 'billing', name: 'Billing', path: 'billing', modules: [newPortalModule('invoices','billing-invoices')] },
      { id: 'forms', name: 'Forms', path: 'forms', modules: [newPortalModule('forms','offered-forms')] },
    ], navigation: [{pageId:'home',label:'Home'},{pageId:'work',label:'Work'},{pageId:'billing',label:'Billing'},{pageId:'forms',label:'Forms'}],
  } satisfies PortalContent },
] as const;
export function portalFromTemplate(key: string): PortalContent {
  const template = PORTAL_TEMPLATES.find(item => item.key === key);
  if (!template) throw new DomainError('Choose a supported Portal template.', 'portal.template_unavailable');
  return structuredClone(template.definition) as PortalContent;
}
