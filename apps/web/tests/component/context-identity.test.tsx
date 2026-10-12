// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ContextIdentity } from '@/components/navigation/context-switcher';

/** Restricted mobile identity stays noninteractive. */
afterEach(cleanup);

describe('ContextIdentity', () => {
  it('shows the supplied mark, the name and the role', () => {
    render(<ContextIdentity mark={<span data-testid="mark">G</span>} name="Grachtwerk Verhuur" role="Owner" />);
    expect(screen.getByTestId('mark')).toBeInTheDocument();
    expect(screen.getByText('Grachtwerk Verhuur')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
  });

  it('is not interactive: no button, no link, no menu', () => {
    render(<ContextIdentity mark={null} name="Grachtwerk Verhuur" role="Owner" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
