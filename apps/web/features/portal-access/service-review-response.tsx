'use client';
import { useActionState, useId, useRef, useState } from 'react';
import { Button } from '@/components/controls/button';
import { FormField } from '@/components/controls/form';
import { ErrorText, TextArea } from '@/components/controls/inputs';
import { REVIEW_STATES, type PortalServiceReview } from '@/lib/domain/customers/service-reviews';
import { respondServiceReviewAction, type ReviewResponseState } from '@/app/(public)/portal/review-actions';

export function ServiceReviewResponse({ review, timezone }: { review: PortalServiceReview; timezone: string }) {
  const [mode, setMode] = useState<'approved' | 'changes_requested' | null>(null);
  const [description, setDescription] = useState('');
  const approveTrigger = useRef<HTMLButtonElement>(null);
  const changesTrigger = useRef<HTMLButtonElement>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const [state, action, pending] = useActionState(async (previous: ReviewResponseState, form: FormData) => {
    try {
      const result = await respondServiceReviewAction(previous, form);
      if (result.saved) { setMode(null); requestAnimationFrame(() => feedback.current?.focus()); }
      return result;
    } catch { return { error: 'Your response could not be recorded. Refresh and try again.', saved: false }; }
  }, { error: null, saved: false });
  const id = useId();
  const date = review.finishedAt ?? review.releasedAt;
  return <section aria-label={`Customer review: ${review.targetTitle}`} className="space-y-3 border-t border-border pt-3">
    <p className="font-medium">{REVIEW_STATES[review.state]}</p>
    <p className="text-xs text-muted">{review.targetTitle} · Revision {review.revisionNumber} · <time dateTime={date}>{new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: timezone }).format(new Date(date))}</time></p>
    <ErrorText role="alert">{state.error}</ErrorText>
    <p ref={feedback} tabIndex={-1} role="status">{state.saved ? 'Your response has been recorded.' : null}</p>
    {review.state === 'pending' && !review.materialAvailable ? <p>Review material unavailable. Contact the service organization.</p> : null}
    {review.state === 'pending' && review.materialAvailable && !state.saved ? <>
      <p className="text-sm">Review the shared material above before responding. This service acknowledgement does not sign a contract or authorize deployment.</p>
      {!mode ? <div className="flex flex-wrap gap-2"><Button className="min-h-11 sm:min-h-0" ref={approveTrigger} onClick={() => setMode('approved')}>Approve deliverable</Button><Button className="min-h-11 sm:min-h-0" ref={changesTrigger} tone="secondary" onClick={() => setMode('changes_requested')}>Request changes</Button></div> : <form action={action} className="space-y-3 rounded-md border border-border p-3">
        <input type="hidden" name="reviewId" value={review.id}/><input type="hidden" name="version" value={review.version}/><input type="hidden" name="decision" value={mode}/>
        {mode === 'approved' ? <p>I have reviewed this deliverable and accept it for the purposes of this service review.</p> : <><FormField id={`${id}-description`} label="What would you like changed?">{props => <TextArea {...props} name="description" value={description} onChange={event => setDescription(event.target.value)} required maxLength={3000} autoFocus/>}</FormField><p className="text-xs text-muted">Your request will be recorded and sent to Support for follow-up.</p></>}
        <div className="flex flex-wrap gap-2"><Button className="min-h-11 sm:min-h-0" type="submit" autoFocus={mode === 'approved'} disabled={pending}>{pending ? 'Submitting…' : mode === 'approved' ? 'Confirm approval' : 'Submit request'}</Button><Button className="min-h-11 sm:min-h-0" type="button" tone="secondary" disabled={pending} onClick={() => { const origin = mode; setMode(null); requestAnimationFrame(() => (origin === 'approved' ? approveTrigger : changesTrigger).current?.focus()); }}>Cancel</Button></div>
      </form>}
    </> : null}
    {review.changeDescription ? <details><summary className="min-h-11 cursor-pointer py-2">View request</summary><p className="whitespace-pre-wrap break-words">{review.changeDescription}</p></details> : null}
  </section>;
}
