'use client';
import { useActionState, useId } from 'react';
import { Button, ButtonLink } from '@/components/controls/button';
import { FormField } from '@/components/controls/form';
import { ErrorText, SelectInput } from '@/components/controls/inputs';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { serviceReviewAction, type ServiceActionState } from '@/app/organizations/[organizationId]/customers/[customerId]/service-actions';
import { REVIEW_STATES, type ServiceReview } from '@/lib/domain/customers/service-reviews';
import { parseDisclosureContent, type DisclosureRevision, type ServiceDisclosure } from '@/lib/domain/customers/service-disclosures';
import { NotificationChoice } from './service-notification-section';
import { NOTIFICATION_STATES, type NotificationHistory } from '@/lib/domain/customers/service-notifications';
import type { readEngagementDetails } from '@/app/organizations/[organizationId]/customers/[customerId]/service-actions';

export function ServiceReviewSection({ organizationId, customerId, engagementId, disclosure, history, reviews, timezone, mayManage, mayReadSupport, relationshipEnded, onSaved, notificationDetails }: {
  organizationId: string; customerId: string; engagementId: string; disclosure: ServiceDisclosure | null; history: DisclosureRevision[];
  reviews: ServiceReview[]; timezone: string; mayManage: boolean; mayReadSupport: boolean; relationshipEnded: boolean; onSaved: () => void;
  notificationDetails?: Awaited<ReturnType<typeof readEngagementDetails>>;
}) {
  const [state, action, pending] = useActionState(async (previous: ServiceActionState, form: FormData) => {
    try { const result = await serviceReviewAction(previous, form); if (result.saved) onSaved(); return result; }
    catch { return { error: 'The review could not be updated. Refresh and try again.', saved: false }; }
  }, { error: null, saved: false });
  const id = useId();
  const published = history.find(r => r.id === disclosure?.published_revision_id);
  const approved = published ? parseDisclosureContent(published.content) : null;
  const context = <><input type="hidden" name="organizationId" value={organizationId}/><input type="hidden" name="customerId" value={customerId}/><input type="hidden" name="engagementId" value={engagementId}/></>;
  return <Section><SectionHeading>Customer review</SectionHeading>
    <ErrorText role="alert">{state.error}</ErrorText>{state.saved ? <p role="status">Review updated.</p> : null}
    {!mayManage ? <p className="text-sm text-muted">Customer management permission is required to view reviews.</p> : <>
      {!reviews.length ? <p>Not requested</p> : null}
      {published && approved && !relationshipEnded ? <form action={action} className="space-y-3">{context}<input type="hidden" name="operation" value="release"/><input type="hidden" name="revisionId" value={published.id}/>
        <p className="text-sm">Published disclosure: Revision {published.number}</p>
        <FormField id={`${id}-target`} label="Review target">{props => <SelectInput className="min-h-11 sm:min-h-0" {...props} name="deliverableId" defaultValue=""><option value="">Entire approved update</option>{approved.deliverables.map(d => <option key={d.deliverableId} value={d.deliverableId}>{d.title}</option>)}</SelectInput>}</FormField>
        <NotificationChoice configuration={notificationDetails?.notificationConfig} identities={notificationDetails?.emailIdentities} maySend={notificationDetails?.maySend} purpose="service_review_requested"/>
        <Button className="min-h-11 sm:min-h-0" type="submit" disabled={pending}>Request customer review</Button>
        <p className="text-xs text-muted">Each target can be requested once per published revision. Publish a new revision for a new decision.</p>
      </form> : <p className="text-sm text-muted">{relationshipEnded ? 'Review material unavailable: relationship ended.' : 'Publish a customer update before requesting review.'}</p>}
      <ol className="space-y-4">{reviews.map(review => {
        const revision = review.revision ?? history.find(r => r.id === review.revision_id);
        const content = revision ? parseDisclosureContent(revision.content) : null;
        const target = review.deliverable_id ? content?.deliverables.find(d => d.deliverableId === review.deliverable_id) : content;
        return <li key={review.id} className="space-y-2 border-t border-border pt-3">
          <p className="font-medium">{REVIEW_STATES[review.state as keyof typeof REVIEW_STATES]}</p>
          <ReviewNotification notification={notificationDetails?.notifications.find(n => n.reviewId === review.id && n.purpose === 'service_review_requested')}/>
          <p className="text-sm">{target?.title ?? 'Historical review target'} · {revision ? `Revision ${revision.number}` : 'Earlier published revision'}</p>
          <p className="text-xs text-muted">Requested {new Date(review.released_at).toLocaleString('en-GB', { timeZone: timezone })}{review.finished_at ? ` · Response/state recorded ${new Date(review.finished_at).toLocaleString('en-GB', { timeZone: timezone })}` : ''}</p>
          {review.responder_name ? <p className="text-sm">Portal customer: {review.responder_name}. Operational acknowledgement.</p> : null}
          <details><summary className="min-h-11 cursor-pointer py-2 text-sm">View request</summary><div className="space-y-2 text-sm"><p className="whitespace-pre-wrap">{target?.summary ?? 'Original material is retained in publication history.'}</p>{review.change_description ? <p className="whitespace-pre-wrap break-words">{review.change_description}</p> : null}<p className="text-xs text-muted">Review {review.id} · Released by {review.released_by}{review.finished_by ? ` · Recorded by ${review.finished_by}` : ''}</p></div></details>
          {review.support_case_id && mayReadSupport ? <ButtonLink className="min-h-11 sm:min-h-0" tone="text" href={`/organizations/${organizationId}/support/cases/${review.support_case_id}`}>Open related Support Case</ButtonLink> : null}
          {review.state === 'pending' ? <form action={action}>{context}<input type="hidden" name="operation" value="withdraw"/><input type="hidden" name="reviewId" value={review.id}/><input type="hidden" name="version" value={review.version}/><NotificationChoice configuration={notificationDetails?.notificationConfig} identities={notificationDetails?.emailIdentities} maySend={notificationDetails?.maySend} purpose="service_review_status_changed"/><Button className="min-h-11 sm:min-h-0" type="submit" tone="secondary" disabled={pending}>Withdraw request</Button></form> : null}
        </li>;
      })}</ol>
      {reviews.length === 50 ? <p className="text-xs text-muted">Showing the latest 50 reviews. Earlier evidence is retained.</p> : null}
    </>}
  </Section>;
}
function ReviewNotification({ notification }: { notification?: NotificationHistory }) {
  return <p className="text-sm">Notification: {notification ? NOTIFICATION_STATES[notification.state] : 'Not requested'}{notification?.reason ? ` — ${notification.reason}` : ''}</p>;
}
