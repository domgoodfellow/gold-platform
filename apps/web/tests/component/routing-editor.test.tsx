// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoutingSection } from '@/features/communications/voice/routing-section';
import type { Route } from '@/lib/domain/reception/routing';
const actions = vi.hoisted(() => ({ readRouteTargetsAction: vi.fn(), updateRouteAction: vi.fn(), createRouteAction: vi.fn(), setRouteEnabledAction: vi.fn(), previewInboundRouteAction: vi.fn() }));
vi.mock('@/app/organizations/[organizationId]/calls/routing-actions', () => actions);
const route: Route = { id:'route-1',name:'Main reception',numberId:null,enabled:true,whenMode:'always',ringStrategy:'sequential',ringTimeoutSeconds:20,destinationType:'members',destinationExternalNumber:null,destinationRouteId:null,fallbackType:'members',fallbackExternalNumber:null,fallbackRouteId:null,callbackAffinityEnabled:false };
const members = [{id:'member-1',displayName:'First operator'},{id:'member-2',displayName:'Second operator'}];
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe('editing persisted routing', () => {
  it('retains ordered primary and fallback members when saving unrelated configuration', async () => {
    actions.readRouteTargetsAction.mockResolvedValue({ok:true,data:[{slot:'primary',memberId:'member-2',position:0},{slot:'primary',memberId:'member-1',position:1},{slot:'fallback',memberId:'member-1',position:0}]});
    actions.updateRouteAction.mockResolvedValue({ok:true,data:null});
    render(<RoutingSection organizationId="org-1" routes={[route]} numbers={[]} members={members} />);
    await userEvent.click(screen.getByRole('button',{name:'Edit'}));
    await waitFor(() => expect(screen.getByRole('button',{name:'Save'})).toBeEnabled());
    await userEvent.click(screen.getByRole('button',{name:'Save'}));
    expect(actions.updateRouteAction).toHaveBeenCalledWith('org-1','route-1',expect.objectContaining({primaryMemberIds:['member-2','member-1'],fallbackMemberIds:['member-1']}));
  });
  it('refuses to save an existing route when its saved targets could not be read', async () => {
    actions.readRouteTargetsAction.mockResolvedValue({ok:false,error:'Your role cannot read saved targets.'});
    render(<RoutingSection organizationId="org-1" routes={[route]} numbers={[]} members={members} />);
    await userEvent.click(screen.getByRole('button',{name:'Edit'}));
    await screen.findByText('Your role cannot read saved targets.');
    expect(screen.getByRole('button',{name:'Loading saved members…'})).toBeDisabled();
    expect(actions.updateRouteAction).not.toHaveBeenCalled();
  });
  it('preserves route-to-route destinations and fallback references', async () => {
    actions.readRouteTargetsAction.mockResolvedValue({ok:true,data:[]});
    actions.updateRouteAction.mockResolvedValue({ok:true,data:null});
    render(<RoutingSection organizationId="org-1" routes={[{...route,destinationType:'route',destinationRouteId:'route-2',fallbackType:'route',fallbackRouteId:'route-2'},{...route,id:'route-2',name:'Escalation'}]} numbers={[]} members={members} />);
    await userEvent.click(screen.getAllByRole('button',{name:'Edit'})[0]);
    await waitFor(() => expect(screen.getByRole('button',{name:'Save'})).toBeEnabled());
    expect(screen.getByLabelText('Destination route')).toHaveValue('route-2');
    expect(screen.getByLabelText('Fallback route')).toHaveValue('route-2');
    await userEvent.click(screen.getByRole('button',{name:'Save'}));
    expect(actions.updateRouteAction).toHaveBeenCalledWith('org-1','route-1',expect.objectContaining({destinationRouteId:'route-2',fallbackRouteId:'route-2'}));
  });
});
