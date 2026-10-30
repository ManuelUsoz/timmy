import { timeAgo } from './time-ago';

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
const minutes = (n: number) => n * 60_000;

describe('timeAgo', () => {
  it('says "now" for the last minute, in either language', () => {
    expect(timeAgo(NOW - 5_000, NOW, 'es')).toBe('ahora');
    expect(timeAgo(NOW, NOW, 'en')).toBe('now');
  });

  it('counts minutes, hours and days', () => {
    expect(timeAgo(NOW - minutes(2), NOW, 'es')).toMatch(/^hace 2 min/);
    expect(timeAgo(NOW - minutes(3 * 60), NOW, 'en')).toBe('3 hr. ago');
    expect(timeAgo(NOW - minutes(3 * 24 * 60), NOW, 'es')).toMatch(/^hace 3 d/);
  });

  it('says yesterday for one day', () => {
    expect(timeAgo(NOW - minutes(24 * 60), NOW, 'es')).toBe('ayer');
  });

  it('treats a time in the future as now', () => {
    expect(timeAgo(NOW + minutes(5), NOW, 'en')).toBe('now');
  });
});
