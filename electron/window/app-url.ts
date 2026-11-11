/**
 * Whether `target` is the app's own page, which is the only URL the window may navigate to (a reload, or a change of the
 * `#` fragment). Any other address, even one on the same origin or another `file:` page, is refused.
 */
export const isAppUrl = (target: string, appUrl: string): boolean => {
  try {
    const wanted = new URL(target);
    const own = new URL(appUrl);
    return wanted.origin === own.origin && wanted.pathname === own.pathname && wanted.search === own.search;
  } catch {
    return false;
  }
};
