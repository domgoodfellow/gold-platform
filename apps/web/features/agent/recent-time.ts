const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/**
 * How long ago something was, in the words History shows: "just now", "5 minutes ago", "yesterday",
 * and a plain date once it is a week or more old. `now` is a parameter so the same instant always
 * renders the same words.
 */
export function formatRecent(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);

  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return RELATIVE.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return RELATIVE.format(-hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 7) return RELATIVE.format(-days, 'day');
  return then.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });
}
