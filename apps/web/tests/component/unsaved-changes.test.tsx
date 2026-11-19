// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUnsavedChanges } from '@/components/controls/use-unsaved-changes';

/** A stand-in for the browser's Navigation API: it raises the `navigate` event a Back or Forward raises. */
class FakeNavigation extends EventTarget {
  move(url: string, { type = 'traverse', cancelable = true } = {}) {
    const event = Object.assign(new Event('navigate', { cancelable }), {
      navigationType: type,
      destination: { url: new URL(url, window.location.href).href },
    });
    this.dispatchEvent(event);
    return event.defaultPrevented ? 'stayed' : 'moved';
  }
}

function Editor({ dirty }: { dirty: boolean }) {
  useUnsavedChanges(dirty);
  return <a href="/elsewhere">Workflows</a>;
}

const QUESTION = 'You have unsaved changes. Leave this editor and discard them?';
let navigation: FakeNavigation;
let confirm: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  window.history.replaceState(null, '', '/organizations/org-1/automations/workflows/new?step=name');
  navigation = new FakeNavigation();
  Object.defineProperty(window, 'navigation', { value: navigation, configurable: true });
  confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
});
afterEach(() => {
  cleanup();
  confirm.mockRestore();
  Reflect.deleteProperty(window, 'navigation');
});

describe('leaving a changed editor with browser Back or Forward', () => {
  it('asks before Back leaves the page, and stays when the answer is no', () => {
    render(<Editor dirty />);
    expect(navigation.move('/organizations/org-1/automations/workflows')).toBe('stayed');
    expect(confirm).toHaveBeenCalledWith(QUESTION);
    confirm.mockReturnValue(true);
    expect(navigation.move('/organizations/org-1/automations/workflows')).toBe('moved');
  });

  it('never questions Back and Forward within the same page, such as a phone’s steps', () => {
    render(<Editor dirty />);
    expect(navigation.move('/organizations/org-1/automations/workflows/new?step=details')).toBe('moved');
    expect(navigation.move('/organizations/org-1/automations/workflows/new')).toBe('moved');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('leaves an unchanged editor, a move the browser will not let a page cancel, and a new address alone', () => {
    const { rerender } = render(<Editor dirty={false} />);
    expect(navigation.move('/organizations/org-1/automations/workflows')).toBe('moved');
    rerender(<Editor dirty />);
    expect(navigation.move('/organizations/org-1/automations/workflows', { cancelable: false })).toBe('moved');
    // A page's own pushState or the router's push is not a Back or Forward.
    expect(navigation.move('/organizations/org-1/automations/workflows/rule-1', { type: 'push' })).toBe('moved');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('stops asking once the editor is saved or closed', () => {
    const { rerender, unmount } = render(<Editor dirty />);
    rerender(<Editor dirty={false} />);
    expect(navigation.move('/organizations/org-1/automations/workflows')).toBe('moved');
    rerender(<Editor dirty />);
    unmount();
    expect(navigation.move('/organizations/org-1/automations/workflows')).toBe('moved');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('still works where the browser has no Navigation API', () => {
    Reflect.deleteProperty(window, 'navigation');
    const { getByRole } = render(<Editor dirty />);
    getByRole('link', { name: 'Workflows' }).click();
    expect(confirm).toHaveBeenCalledWith(QUESTION);
  });
});
