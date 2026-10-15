// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ServiceReviewResponse } from '@/features/portal-access/service-review-response';
import { respondServiceReviewAction } from '@/app/(public)/portal/review-actions';
import type { PortalServiceReview } from '@/lib/domain/customers/service-reviews';
vi.mock('@/app/(public)/portal/review-actions', () => ({ respondServiceReviewAction: vi.fn(async () => ({ error: null, saved: true })) }));
afterEach(() => { cleanup(); vi.mocked(respondServiceReviewAction).mockClear(); });
const review: PortalServiceReview = { id: 'review', revisionId: 'revision', revisionNumber: 4, version: 1, state: 'pending', releasedAt: '2026-10-15T12:00:00Z', finishedAt: null, targetTitle: 'Approved website', materialAvailable: true, changeDescription: null };
describe('customer operational service review', () => {
  it('requires explicit final approval and restores focus after cancellation', async () => {
    const user = userEvent.setup(); render(<ServiceReviewResponse review={review} timezone="UTC"/>);
    await user.click(screen.getByRole('button', { name: 'Approve deliverable' }));
    expect(screen.getByText('I have reviewed this deliverable and accept it for the purposes of this service review.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Confirm approval' })).toHaveFocus();
    expect(respondServiceReviewAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve deliverable' })).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'Approve deliverable' }));
    await user.click(screen.getByRole('button', { name: 'Confirm approval' }));
    expect(await screen.findByText('Your response has been recorded.')).toBeVisible();
    const form = vi.mocked(respondServiceReviewAction).mock.calls[0][1];
    expect(Object.fromEntries(form)).toEqual({ reviewId: 'review', version: '1', decision: 'approved' });
    expect(screen.queryByRole('button', { name: 'Approve deliverable' })).toBeNull();
  });
  it('bounds change text, sends it once and retains failures for correction', async () => {
    const user = userEvent.setup(); render(<ServiceReviewResponse review={review} timezone="UTC"/>);
    await user.click(screen.getByRole('button', { name: 'Request changes' }));
    const input = screen.getByLabelText('What would you like changed?');
    expect(input).toHaveAttribute('maxlength', '3000'); expect(input).toBeRequired();
    await user.type(input, 'Move the booking form.');
    vi.mocked(respondServiceReviewAction).mockResolvedValueOnce({ error: 'Review changed. Reload before responding.', saved: false });
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Review changed');
    expect(input).toHaveValue('Move the booking form.');
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByText('Your response has been recorded.')).toBeVisible();
    expect(vi.mocked(respondServiceReviewAction).mock.calls[1][1].get('description')).toBe('Move the booking form.');
  });
  it('retains change text and offers retry when the server action transport fails', async () => {
    const user = userEvent.setup(); render(<ServiceReviewResponse review={review} timezone="UTC"/>);
    await user.click(screen.getByRole('button', { name: 'Request changes' }));
    await user.type(screen.getByLabelText('What would you like changed?'), 'Retain this request.');
    vi.mocked(respondServiceReviewAction).mockRejectedValueOnce(new Error('Network unavailable'));
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh and try again');
    expect(screen.getByLabelText('What would you like changed?')).toHaveValue('Retain this request.');
  });
  it('renders terminal states, unavailable material and untrusted text without response controls', () => {
    const { rerender, container } = render(<ServiceReviewResponse review={{ ...review, materialAvailable: false }} timezone="UTC"/>);
    expect(screen.getByText(/Review material unavailable/)).toBeVisible(); expect(screen.queryByRole('button')).toBeNull();
    for (const state of ['approved', 'changes_requested', 'withdrawn', 'superseded'] as const) {
      rerender(<ServiceReviewResponse review={{ ...review, state, version: 2, changeDescription: '<script>unsafe</script>' }} timezone="UTC"/>);
      expect(screen.queryByRole('button')).toBeNull(); expect(container.querySelector('script')).toBeNull();
    }
  });
});
