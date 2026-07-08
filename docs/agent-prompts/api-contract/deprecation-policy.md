# deprecation-policy

Public API should be **deprecated before it is removed**, never deleted silently.
Flag removals of public surface that skip a deprecation step, and require a
`@deprecated` marker + migration note for at least one release before deletion.
Cite `file:line`.

## Rule
- CRITICAL when a public symbol/route/field is **deleted in the same change that
  first signals it is going away** (no prior `@deprecated` period).
- WARNING when something is being deprecated but the marker is missing a
  **replacement pointer** ("use X instead") or a removal timeline.
- Prefer: keep the old surface, mark `@deprecated`, forward to the new one, and
  remove it in a later major release.

## Good
```ts
/**
 * @deprecated Use `getAccount(id)` instead. Removed in v4.
 */
export function getUser(id: string) {
  return getAccount(id); // forwards to the replacement
}
```

## Bad
```ts
// Public function deleted outright — no @deprecated release, no alias.
- export function getUser(id: string) { … }
```
