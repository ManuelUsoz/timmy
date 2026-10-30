import type { TitleBarOverlayOptions } from 'electron';

/**
 * The system-drawn window controls (ADR 0005). Colors mirror the Ascua tokens `--background` and
 * `--text-primary` (src/styles.css), which the main process cannot read. Keep in sync.
 */
const OVERLAY_HEIGHT = 40;

/** Shown only in Expanded; Pill and Panel get a zero-height overlay so no controls appear. */
export const titleBarOverlayFor = (visible: boolean): TitleBarOverlayOptions => ({
  color: '#161616',
  symbolColor: '#f4f4f4',
  height: visible ? OVERLAY_HEIGHT : 0,
});
