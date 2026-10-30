# Expanded is a resizable, maximizable window with a native title bar overlay

Amends ADR-0004. Expanded now shows the Workspace (rail, projects, project content, chat) and is no longer "a frameless, centered, normal window of a fixed size". It is resizable and maximizable, starts at 1280×800 clamped to 90 % of the work area, has a minimum size of 800 px wide, and uses `titleBarStyle: 'hidden'` with `titleBarOverlay` so the system draws minimize, maximize/restore and close, tinted with the app's tokens. Maximized is a state of Expanded, not a fourth Window mode; Pill and Panel stay frameless with no controls. The Workspace adapts to Tailwind's default breakpoints: three columns from `xl`, the Projects list collapses to the rail between `lg` and `xl`, and project content becomes an overlay below `lg`. A manual collapse by the user wins over the automatic one. We rejected our own HTML window buttons (we would lose Windows 11 Snap Layouts and native maximize behavior and have to reimplement double-click), and a fourth "Workspace" mode (Maximized is just a size, and a mode would force the animation and request flow of ADR-0004 to handle it).

## Consequences

- The fixed Expanded bounds and the "normal window, not resizable" flags in main are replaced; switching modes remembers neither size nor maximized state yet, and Expanded always opens at its initial size.
- Only Expanded gets a drag region and an overlay; the 200 ms bounds animation of ADR-0004 still applies when entering and leaving Expanded, and a maximized Expanded animates back to Panel or Pill from its restored bounds.
- Expanded is the only place that uses the Angular router (hash location, because the renderer loads from `file://`).
