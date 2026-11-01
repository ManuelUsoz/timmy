import { TestBed } from '@angular/core/testing';
import { DEFAULT_DURATION_MS, ERROR_DURATION_MS, MAX_TOASTS, ToastService } from './toast';

describe('ToastService', () => {
  let toasts: ToastService;

  beforeEach(() => {
    vi.useFakeTimers();
    toasts = TestBed.inject(ToastService);
  });
  afterEach(() => vi.useRealTimers());

  const bodies = () => toasts.toasts().map((toast) => toast.body);

  it('shows a toast with the title of its tone and returns a distinct id each time', () => {
    const first = toasts.show({ tone: 'warning', body: 'sessions.busy' });
    const second = toasts.info('projects.checkFailed');
    expect(first).not.toBe(second);
    expect(toasts.toasts().map((toast) => [toast.id, toast.tone, toast.title])).toEqual([
      [first, 'warning', 'toast.title.warning'],
      [second, 'info', 'toast.title.info'],
    ]);
  });

  it('has a shorthand per tone, and a title can be replaced', () => {
    toasts.success('sessions.busy');
    toasts.error('sessions.busy', { title: 'toast.title.info' });
    expect(toasts.toasts().map((toast) => [toast.tone, toast.title])).toEqual([
      ['success', 'toast.title.success'],
      ['error', 'toast.title.info'],
    ]);
  });

  it('keeps the newest three: a fourth toast removes the one that has been there longest', () => {
    const ids = [1, 2, 3, 4].map(() => toasts.error('sessions.busy'));
    expect(MAX_TOASTS).toBe(3);
    expect(toasts.toasts().map((toast) => toast.id)).toEqual(ids.slice(1));
    const fifth = toasts.error('sessions.busy');
    expect(toasts.toasts().map((toast) => toast.id)).toEqual([ids[2], ids[3], fifth]);
  });

  it('dismisses by id and ignores an id that is gone', () => {
    const a = toasts.info('projects.loadFailed');
    const b = toasts.info('sessions.loadFailed');
    toasts.dismiss(a);
    toasts.dismiss(a);
    expect(bodies()).toEqual(['sessions.loadFailed']);
    toasts.dismiss(b);
    expect(toasts.toasts()).toEqual([]);
  });

  it('dismisses by itself after 6 s, and after 8 s when it is an error', () => {
    toasts.info('projects.loadFailed');
    toasts.error('sessions.loadFailed');
    vi.advanceTimersByTime(DEFAULT_DURATION_MS - 1);
    expect(toasts.toasts()).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(bodies()).toEqual(['sessions.loadFailed']);
    vi.advanceTimersByTime(ERROR_DURATION_MS - DEFAULT_DURATION_MS - 1);
    expect(toasts.toasts()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toasts.toasts()).toEqual([]);
  });

  it('takes the duration of the toast when given, and `null` keeps it until dismissed', () => {
    toasts.error('projects.loadFailed', { durationMs: 1000 });
    const sticky = toasts.info('sessions.loadFailed', { durationMs: null });
    vi.advanceTimersByTime(1000);
    expect(bodies()).toEqual(['sessions.loadFailed']);
    vi.advanceTimersByTime(60_000);
    expect(bodies()).toEqual(['sessions.loadFailed']);
    toasts.dismiss(sticky);
    expect(toasts.toasts()).toEqual([]);
  });

  it('does not let the timer of a dismissed toast remove a later one', () => {
    const first = toasts.info('projects.loadFailed');
    toasts.dismiss(first);
    vi.advanceTimersByTime(3000);
    toasts.info('sessions.loadFailed');
    vi.advanceTimersByTime(DEFAULT_DURATION_MS - 3000);
    expect(bodies()).toEqual(['sessions.loadFailed']);
    vi.advanceTimersByTime(3000);
    expect(toasts.toasts()).toEqual([]);
  });

  it('clears the timer of an evicted toast', () => {
    toasts.info('projects.loadFailed');
    vi.advanceTimersByTime(1000);
    toasts.info('sessions.loadFailed');
    toasts.info('sessions.busy');
    toasts.info('projects.checkFailed');
    expect(vi.getTimerCount()).toBe(MAX_TOASTS);
    vi.advanceTimersByTime(DEFAULT_DURATION_MS);
    expect(toasts.toasts()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
