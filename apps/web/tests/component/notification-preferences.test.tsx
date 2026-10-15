// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomerNotificationPreferences } from '@/features/portal-access/notification-preferences';
import { notificationPreferenceAction } from '@/app/(public)/portal/notification-actions';
vi.mock('@/app/(public)/portal/notification-actions', () => ({ notificationPreferenceAction: vi.fn(async () => ({ error: null, message: 'Confirmation queued.', challengeId: 'challenge' })) }));
afterEach(() => { cleanup(); vi.mocked(notificationPreferenceAction).mockClear(); });
describe('recipient-controlled service email preferences', () => {
  it('leaves consent unchecked, retains rejected choices, and renders the actual refusal', async () => {
    const user = userEvent.setup(); render(<CustomerNotificationPreferences preferences={null}/>);
    await user.click(screen.getByText('Email notifications', { exact: true }));
    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).not.toBeChecked();
    await user.type(screen.getByLabelText('Notification email address'), 'verified@example.test');
    await user.click(screen.getByLabelText('Service progress updates'));
    vi.mocked(notificationPreferenceAction).mockResolvedValueOnce({ error: 'Sender not ready.', message: null });
    await user.click(screen.getByRole('button', { name: 'Send confirmation code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sender not ready.');
    expect(screen.getByLabelText('Notification email address')).toHaveValue('verified@example.test');
    expect(screen.getByLabelText('Service progress updates')).toBeChecked();
    expect(screen.queryByLabelText('Email confirmation code')).toBeNull();
  });
  it('requests mailbox confirmation before reporting verified preferences', async () => {
    const user = userEvent.setup(); render(<CustomerNotificationPreferences preferences={null}/>);
    await user.click(screen.getByText('Email notifications', { exact: true }));
    await user.type(screen.getByLabelText('Notification email address'), 'verified@example.test');
    await user.click(screen.getByLabelText('Deliverables ready for review'));
    await user.click(screen.getByRole('button', { name: 'Send confirmation code' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Confirmation queued');
    expect(screen.getByLabelText('Email confirmation code')).toBeVisible();
    expect(screen.getByLabelText('Email confirmation code')).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Turn off email notifications' })).toBeNull();
  });
});
