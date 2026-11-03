# Tool calling test readme

This file exists to exercise the agent's tool-calling loop: directory listing,
file reads, and file creation. It intentionally does **not** replace
[`README.md`](./README.md), which documents the actual project.

Delete this file whenever it has served its purpose.

## What the tool calls found

The repo is `timmy`, a desktop app with an Electron main process and an Angular
renderer, wired together with [Effect](https://effect.website).

Version: `0.1.0` · package manager: `npm@11.19.1` · Node: `>=20`

## Commands (from `package.json`)

| Command             | What it does                                                |
| ------------------- | ----------------------------------------------------------- |
| `npm run dev`       | Angular dev server on `:4200` plus Electron with HMR        |
| `npm run preview`   | Production build, then run the app locally                  |
| `npm run build`     | Build renderer (`dist/renderer`) and Electron (`dist-electron`) |
| `npm run package`   | Build and create an installer in `release/`                 |
| `npm test`          | Angular unit tests (Vitest)                                 |
| `npm run e2e`       | Build, then run Playwright end-to-end tests                 |
| `npm run typecheck` | Type-check Electron main/preload                            |

## Orientation

- Start with [`README.md`](./README.md) for architecture, layout and security notes.
- [`AGENTS.md`](./AGENTS.md) holds the mandatory coding rules for this repo.
- [`GLOSSARY.md`](./GLOSSARY.md) covers domain vocabulary.
- `electron/` is main-process only; `src/app` is renderer only; `src/shared`
  holds the wire contracts both sides import.
