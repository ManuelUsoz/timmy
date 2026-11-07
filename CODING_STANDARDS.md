# Coding standards

Judgement-call rules, applied at review time. Mechanical rules are enforced by
`npm run lint` (`eslint.config.js`); implementation rules live in `AGENTS.md`.

## Writing effects

- `Effect.gen` for multi-step flows, combinators for single steps.
- Pipeable values use `.pipe(...)`; others use `pipe()` / `flow()`. Avoid nested
  calls like `f(g(x))`.
- A function whose body is a single `return yield* effect` returns the effect
  directly instead of wrapping it in `Effect.fnUntraced`.
- `async`/`await` only at real Promise boundaries (DOM, third-party SDKs),
  wrapped in `Effect.tryPromise`; domain logic stays in Effect.
- Every effect is returned, yielded, forked into a managed scope, or run at the
  edge. No floating effects.
- Default to immutable values: `readonly` properties and `ReadonlyArray`.

## Error design

- Typed errors only for failures a caller can act on. Catch non-actionable
  failures at the service boundary and turn them into defects (`Effect.die`,
  `toWireDefect`); keep the error channel typed, never `unknown`.
- Reuse an existing tagged error when it fits. No generic `XFailed`,
  `InternalError` or `UnknownError`.
- User-visible failure text comes from `Cause.pretty` or
  `src/app/core/describe-cause.ts`, not new error-to-message helpers.

## Services and layers

- Consumers get services from the context; pass no service instances as
  function arguments.
- Compose with `Layer.provide` / `Layer.merge` and expose only what downstream
  needs. Keep the production constructor reusable so tests can swap dependencies.
- Type final live layers as `Layer.Layer<ProvidedServices>`; let intermediate
  layers infer.
- Layers are memoized per runtime: build them once, not per call. Use
  `Layer.fresh` only when a second instance is genuinely required.

## Structure and boundaries

- Colocate by domain, keep directories flat. Feature code lives with its feature,
  not in global `shared` modules.
- Wire contracts in `src/shared`, main-only code in `electron/`, renderer-only
  code in `src/app`.
- An RPC handler is a controller: validate input, delegate to a service, return
  serializable data. No business logic in handlers or the preload.
- Public contract schemas are named and annotated with
  `.annotate({ identifier: "Name" })`.

## Angular

- Run effects at UI boundaries through `EffectRuntime.run(...)` and write the
  result into signals; templates never see effects.
- Domain services return effects and never inject `EffectRuntime`.
- Angular DI services own UI state; Effect services own domain logic.
- Loading, failure, empty and success are distinct states. Never show a failure
  or a load as empty data.
- Tie long-lived streams and subscriptions to `DestroyRef`.

## Testing

- Tests use production composition. Mock only true external boundaries by
  swapping a layer (`Layer.mock`, `makeXTestLayer`), never by mocking modules.
- Prefer `@effect/vitest` (`it.effect`, `it.layer`); small unit tests may use
  `Effect.runPromise` with `Effect.flip` for failures.
- Time-dependent code uses `TestClock.adjust` / `TestClock.setTime`. No
  arbitrary sleeps, timing races or uncontrolled external state.
- Test behavior and contracts, not implementation details. Every bug fix gets a
  regression test.
- Coverage is a floor: aim for 80%+ on domain code; skip low-value tests.

## Observability

- Trace with `Effect.withSpan` or a named `Effect.fn`; spans already capture
  failures, so error paths need no manual logging.
- Log only domain-level events (startup, sync progress).

## Review checklist

- `npm run lint` passes; every `eslint-disable` names a real native edge.
- New domain code has a test through its layer, failures included.
- The change respects the security and IPC constraints in `AGENTS.md`; RPC
  inputs are validated by their schemas.
