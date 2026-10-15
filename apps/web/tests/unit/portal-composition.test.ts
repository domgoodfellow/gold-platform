import { describe, expect, it } from 'vitest';
import { DEFAULT_PORTAL_CONTENT, parsePortalContent, portalFromTemplate, removePortalPage, newPortalModule, portalPageForPath } from '@/lib/domain/portal/composition';
describe('Portal pages, modules and navigation contract', () => {
 it('roundtrips typed templates and creates independent drafts',()=>{for(const key of ['basic','service-business','managed-services']){const a=portalFromTemplate(key);expect(parsePortalContent(a)).toEqual(a);a.settings.title='Changed';expect(portalFromTemplate(key).settings.title).toBe('Customer portal');}});
 it('upgrades unpublished historical definitions without introducing Batch C Services',()=>{const value=parsePortalContent({title:' Portal ',introduction:'<b>literal</b>',modules:['services','invoices']});expect(value.settings.title).toBe(' Portal ');expect(value.pages[0].modules.map(item=>item.kind)).toEqual(['invoices']);});
 it('rejects forged data, duplicated identities, invalid paths and navigation references',()=>{
   const cases:unknown[]=[null,[],{}, {...DEFAULT_PORTAL_CONTENT,customerId:'forged'}];
   for(const mutate of [
     (v:typeof DEFAULT_PORTAL_CONTENT)=>{v.pages[0].id=1 as unknown as string;},
     (v:typeof DEFAULT_PORTAL_CONTENT)=>{v.pages[0].path='../secret';},
     (v:typeof DEFAULT_PORTAL_CONTENT)=>{v.navigation[0].pageId='missing';},
     (v:typeof DEFAULT_PORTAL_CONTENT)=>{v.settings.title='\u00a0';},
     (v:typeof DEFAULT_PORTAL_CONTENT)=>{v.settings.title='\u0000';},
     (v:typeof DEFAULT_PORTAL_CONTENT)=>{v.settings.title='\ud800';},
     (v:typeof DEFAULT_PORTAL_CONTENT)=>{v.pages[0].modules.push(structuredClone(v.pages[0].modules[0]));},
     (v:typeof DEFAULT_PORTAL_CONTENT)=>{v.pages[0].modules.push(newPortalModule('forms'));},
     (v:typeof DEFAULT_PORTAL_CONTENT)=>{v.pages[0].modules[0].config.limit=1.5;},
     (v:typeof DEFAULT_PORTAL_CONTENT)=>{v.pages[0].modules[0].config.variant='secret';},
   ]) {const v=structuredClone(DEFAULT_PORTAL_CONTENT);mutate(v);cases.push(v);}
   for(const value of cases)expect(()=>parsePortalContent(value)).toThrow();
 });
 it('repairs default and navigation references when deleting a page',()=>{const v=portalFromTemplate('service-business');const next=removePortalPage(v,'home');expect(next.defaultPageId).toBe('work');expect(parsePortalContent(next)).toEqual(next);expect(portalPageForPath(next,'missing')).toBeNull();});
 it('allows separately configured Work and invoice instances with unique stable identities',()=>{const v=structuredClone(DEFAULT_PORTAL_CONTENT);v.pages[0].modules.push(newPortalModule('work'));expect(parsePortalContent(v)).toEqual(v);});
});
