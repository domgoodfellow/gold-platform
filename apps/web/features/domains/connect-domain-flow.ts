import type { DnsRecord } from '@/lib/adapters/domains';
import type { DomainOutcome } from '@/lib/domain/domains/domains';
import type { DomainSurface } from '@/lib/domain/domains/presentation';
import { checkHostname, HOSTNAME_PROBLEM } from '@/lib/domain/domains/hostname';

/**
 * The Connect domain dialog's steps, as a plain reducer: hostname → surface → registering → the
 * provider's answer (DNS to publish, active, or why not) → recheck → active.
 *
 * Kept apart from the component so each transition is a function a test can call, and so the
 * dialog holds no rule of its own: what a hostname may be is `checkHostname`, what an answer means
 * is the domain layer's `DomainOutcome`. A generic wizard would be a framework with one caller.
 */

/** What a server action hands back: the domain layer's outcome, or a refusal in words. */
export type DomainActionResult = { ok: true; outcome: DomainOutcome } | { ok: false; message: string };

export type FlowState =
  | { step: 'hostname'; hostname: string; problem: string | null }
  | { step: 'surface'; hostname: string; surface: DomainSurface }
  | { step: 'working'; hostname: string; surface: DomainSurface; action: 'connect' | 'check'; domainId: string | null }
  /** `rechecked`: the provider has been asked again and DNS still does not point here — misconfigured. */
  | { step: 'dns'; hostname: string; surface: DomainSurface; domainId: string; records: DnsRecord[]; rechecked: boolean }
  | { step: 'active'; hostname: string; domainId: string }
  | { step: 'conflict'; hostname: string; message: string }
  | { step: 'unavailable'; hostname: string; surface: DomainSurface; domainId: string | null; message: string }
  | { step: 'error'; hostname: string; surface: DomainSurface; domainId: string | null; message: string };

export type FlowEvent =
  | { type: 'edit'; hostname: string }
  | { type: 'continue'; platformZone: string | null }
  | { type: 'choose'; surface: DomainSurface }
  | { type: 'back' }
  | { type: 'submit' }
  | { type: 'recheck' }
  | { type: 'answered'; result: DomainActionResult }
  | { type: 'reset' };

export const INITIAL_FLOW: FlowState = { step: 'hostname', hostname: '', problem: null };

export function connectDomainFlow(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case 'reset':
      return INITIAL_FLOW;

    case 'edit':
      return state.step === 'hostname' ? { step: 'hostname', hostname: event.hostname, problem: null } : state;

    case 'continue': {
      if (state.step !== 'hostname') return state;
      const checked = checkHostname(state.hostname, event.platformZone);
      if (!checked.ok) return { ...state, problem: HOSTNAME_PROBLEM[checked.problem] };
      return { step: 'surface', hostname: checked.hostname, surface: 'website' };
    }

    case 'choose':
      return state.step === 'surface' ? { ...state, surface: event.surface } : state;

    case 'back':
      return state.step === 'surface' ? { step: 'hostname', hostname: state.hostname, problem: null } : state;

    case 'submit':
      return state.step === 'surface'
        ? { step: 'working', hostname: state.hostname, surface: state.surface, action: 'connect', domainId: null }
        : state;

    case 'recheck':
      if ((state.step === 'dns' || state.step === 'unavailable' || state.step === 'error') && state.domainId) {
        return { step: 'working', hostname: state.hostname, surface: state.surface, action: 'check', domainId: state.domainId };
      }
      return state;

    case 'answered': {
      if (state.step !== 'working') return state;
      const { hostname, surface } = state;
      if (!event.result.ok) return { step: 'error', hostname, surface, domainId: state.domainId, message: event.result.message };

      const outcome = event.result.outcome;
      switch (outcome.kind) {
        case 'active':
          return { step: 'active', hostname, domainId: outcome.domainId };
        case 'pending_dns':
          return {
            step: 'dns',
            hostname,
            surface,
            domainId: outcome.domainId,
            records: outcome.standing.dnsRecords,
            rechecked: state.action === 'check',
          };
        case 'conflict':
          return { step: 'conflict', hostname, message: outcome.message };
        case 'provider_unavailable':
          return { step: 'unavailable', hostname, surface, domainId: outcome.domainId, message: outcome.message };
        case 'provider_error':
          return { step: 'error', hostname, surface, domainId: outcome.domainId, message: outcome.message };
      }
    }
  }
  return state;
}
