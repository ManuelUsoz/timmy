import type { Language } from '../../../shared/settings/settings.model';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "hace 2 min", "ayer", "2 days ago": how long before `now` something happened, in the user's language. */
export const timeAgo = (then: number, now: number, language: Language): string => {
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto', style: 'short' });
  const elapsed = Math.max(0, now - then);
  if (elapsed < MINUTE) return format.format(0, 'second');
  if (elapsed < HOUR) return format.format(-Math.floor(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return format.format(-Math.floor(elapsed / HOUR), 'hour');
  return format.format(-Math.floor(elapsed / DAY), 'day');
};
