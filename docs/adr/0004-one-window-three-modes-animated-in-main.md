# One window changes mode, and main animates its bounds

Timmy has a single window that moves between three Window modes (Pill, Panel, Expanded). The renderer asks for a mode over a `Window` RPC; the main process owns the window and animates its bounds to the target mode over about 200 ms while the renderer cross-fades the content. The Pill and Panel are frameless, always-on-top and hidden from the taskbar, anchored at the bottom-right of the work area. Expanded is a frameless, centered, normal window of a fixed size. Timmy always starts in the Pill. We rejected separate windows per mode (state and focus would have to be handed between them, and there would be no continuity to animate), and one large transparent window animated with CSS only (the transparent area blocks clicks on the desktop).

## Consequences

- Electron animates bounds natively only on macOS; on Windows and Linux main interpolates `setBounds` itself. Frameless windows with the Mica backdrop may flicker while resizing; this is spiked first, and where it flickers that platform falls back to an instant resize with a content fade.
- Reduced-motion preferences make every switch instant.
- The window stays on the display it is on when switching; at startup it uses the primary display. Dragging between displays is not handled yet.
- Neither Esc nor clicking elsewhere changes the mode; only the switcher or a double-click does.
