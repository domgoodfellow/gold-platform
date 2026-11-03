// @vitest-environment jsdom
import { cleanup, render as renderBase, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { WorkspaceRailProvider } from '@/components/panels/workspace-right-rail';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { PortalWorkbench } from '@/features/studio/portal/portal-workbench';
import { DEFAULT_PORTAL_CONTENT } from '@/lib/domain/portal/composition';
import { DEFAULT_BRAND } from '@/lib/domain/branding/brand';
import { PortalModulePresenter } from '@/features/studio/portal/portal-renderer';
import type { PortalDefinition, PortalRevision } from '@/lib/domain/portal/definitions';
import { chooseOption } from '../support/select-field';
vi.mock('@/app/organizations/[organizationId]/studio/portal/actions', () => ({ portalAction: vi.fn() }));
function render(children:ReactNode){return renderBase(<WorkspaceRailProvider>{children}</WorkspaceRailProvider>);}
beforeEach(()=>{window.matchMedia=vi.fn().mockImplementation((query:string)=>({matches:false,media:query,addEventListener:vi.fn(),removeEventListener:vi.fn()}));});
afterEach(cleanup);
const definition:PortalDefinition={id:'portal',organization_id:'org',draft_version:2,draft_content:DEFAULT_PORTAL_CONTENT,published_revision_id:'revision',revision_number:1,created_at:'2026-10-13T12:00:00Z',updated_at:'2026-10-13T12:00:00Z',created_by:'owner',updated_by:'owner',draft_status:'draft',submitted_at:null,submitted_by:null};
const revision:PortalRevision={id:'revision',organization_id:'org',portal_id:'portal',number:1,content:DEFAULT_PORTAL_CONTENT,published_at:'2026-10-13T12:00:00Z',published_by:'owner',reviewed_at:null,reviewed_by:null};
const common={organizationId:'org',timezone:'America/Toronto',enabled:true,brand:DEFAULT_BRAND,logo:null,profile:{displayName:'Actual business',tagline:null,intro:null,contactEmail:null,contactPhone:null,address:null},availability:{defaultExperience:true,work:true,invoices:true,forms:true,services:true,payments:false,publish:true}};
describe('Portal workbench lifecycle and accessible composition',()=>{
 it('adds Services through the canonical chooser and configures its presentation',async()=>{
  const user=userEvent.setup();render(<PortalWorkbench {...common} definition={definition} history={[]}/>);
  await user.click(screen.getByRole('button',{name:'Add Services'}));
  expect(screen.getByLabelText('Module heading')).toHaveValue('Your services');
  await chooseOption(screen.getByLabelText('Presentation'),'cards');
  expect(screen.getByRole('region',{name:'Canvas'}).querySelector('[data-portal-module="services"]')).toHaveAttribute('data-portal-variant','cards');
  expect(screen.getByText('Example website implementation')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Save draft'})).toBeEnabled();
 });
 it('keeps the full legacy record list while applying configured limits after custom publication',()=>{
  const records=Array.from({length:25},(_,index)=>({id:String(index),title:`Authorized historical item ${index}`,detail:''}));
  const instance=DEFAULT_PORTAL_CONTENT.pages[0].modules[0];
  const {rerender}=render(<PortalModulePresenter module={instance} records={records} unbounded/>);
  expect(screen.getAllByText(/Authorized historical item/)).toHaveLength(25);
  rerender(<WorkspaceRailProvider><PortalModulePresenter module={instance} records={records}/></WorkspaceRailProvider>);
  expect(screen.getAllByText(/Authorized historical item/)).toHaveLength(instance.config.limit);
 });
 it('retains module selection and open history after an authoritative version refresh',async()=>{
  const user=userEvent.setup();const {rerender}=render(<PortalWorkbench {...common} definition={definition} history={[revision]}/>);
  await user.click(screen.getByRole('button',{name:'Forms'}));await user.click(screen.getByText('Publishing history & access'));
  rerender(<WorkspaceRailProvider><PortalWorkbench {...common} definition={{...definition,draft_version:3}} history={[revision]}/></WorkspaceRailProvider>);
  expect(screen.getByLabelText('Module heading')).toHaveValue('Forms');expect(screen.getByRole('button',{name:'Restore revision 1 to draft'})).toBeVisible();
 });
 it('requires review before publication and renders labelled examples with canonical branding',()=>{render(<PortalWorkbench {...common} definition={definition} history={[revision]}/>);expect(screen.getByRole('button',{name:'Publish portal'})).toBeDisabled();expect(screen.getByRole('button',{name:'Send for review'})).toBeEnabled();expect(screen.getByText('Actual business')).toBeInTheDocument();expect(screen.getByText(/labelled example records/)).toBeInTheDocument();});
 it('keeps edits private, renders text safely and blocks publication until saved',async()=>{const user=userEvent.setup();render(<PortalWorkbench {...common} definition={definition} history={[revision]}/>);await user.type(screen.getByLabelText('Portal title'),'<b>text</b>');expect(screen.getByRole('button',{name:'Save draft'})).toBeEnabled();expect(screen.getByRole('button',{name:'Send for review'})).toBeDisabled();const canvas=screen.getByRole('region',{name:'Canvas'});expect(within(canvas).getByRole('heading',{name:'Customer portal<b>text</b>'})).toBeInTheDocument();expect(canvas.querySelector('b')).toBeNull();});
 it('adds pages, validates unique paths and controls navigation access',async()=>{const user=userEvent.setup();render(<PortalWorkbench {...common} definition={definition} history={[]}/>);await user.click(screen.getByRole('button',{name:'Add page'}));await user.clear(screen.getByLabelText('Page path'));await user.type(screen.getByLabelText('Page path'),'home');expect(screen.getByRole('button',{name:'Save draft'})).toBeDisabled();await user.clear(screen.getByLabelText('Page path'));await user.type(screen.getByLabelText('Page path'),'customer-work');expect(screen.getByRole('button',{name:'Save draft'})).toBeEnabled();await user.click(screen.getByLabelText('Include in customer navigation'));expect(screen.getByText('Excluded from customer access')).toBeInTheDocument();});
 it('configures and duplicates permitted module instances and preserves a final module',async()=>{const user=userEvent.setup();render(<PortalWorkbench {...common} definition={definition} history={[]}/>);await user.click(screen.getByRole('button',{name:'Your work'}));await user.click(screen.getByRole('button',{name:'Duplicate module'}));expect(screen.getAllByRole('button',{name:'Your work'})).toHaveLength(2);await user.click(screen.getByRole('button',{name:'Remove module'}));await user.click(screen.getByRole('button',{name:'Forms'}));expect(screen.queryByRole('button',{name:'Duplicate module'})).toBeNull();});
 it('explains entitlement and compatibility for a new Portal',()=>{render(<PortalWorkbench {...common} availability={{...common.availability,publish:false}} definition={null} history={[]}/>);expect(screen.getByRole('button',{name:'Publish portal'})).toBeDisabled();expect(screen.getByRole('link',{name:'Configure Studio'})).toBeInTheDocument();expect(screen.getByText(/keep the default Portal/)).toBeInTheDocument();});
});
