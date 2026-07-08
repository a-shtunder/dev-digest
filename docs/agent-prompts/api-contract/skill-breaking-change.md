# breaking-change

Directive skill for the **API Contract Reviewer**. Flag any change that removes or
alters a **public contract** other code depends on: an exported function or route
signature, a public type, an enum value, an HTTP route path or method, or a
required request field. Always cite the offending `file:line` and state what
downstream callers will break.

## Rule
- **CRITICAL** — a public/exported symbol, route path, or HTTP method is **removed
  or renamed** with no backward-compatible alias.
- **CRITICAL** — a function/route **parameter is removed, reordered, or made
  required** where it was previously optional.
- **CRITICAL** — a response field is **removed or renamed** (breaks every consumer
  that reads it).
- **WARNING** — a public parameter, request field, or response field **changes type**
  (e.g. `number` → `string`) or flips **required ↔ optional**.
- **No finding** — the symbol is internal (not exported, not part of a public
  route), or the change is purely additive (new optional field/param, new export).
  Say so briefly and move on.

## Good — additive, backward compatible
```ts
// New optional parameter — existing callers keep working.
export function getUser(id: string, opts?: { include?: string[] }) { … }

// New optional response field — existing consumers unaffected.
const UserResponse = z.object({
  id: z.string(),
  name: z.string(),
  avatarUrl: z.string().optional(), // added
});
```

## Bad — breaking, must be flagged
```ts
// Public param removed and the rest reordered — every caller breaks.
- export function getUser(id: string, opts?: Options) { … }
+ export function getUser(opts: Options, id: string) { … }

// Route renamed with no alias — clients calling /v1/users now 404.
- app.get('/v1/users', handler)
+ app.get('/v1/accounts', handler)

// Response field renamed — consumers reading `userName` get undefined.
- const UserResponse = z.object({ userName: z.string() });
+ const UserResponse = z.object({ name: z.string() });
```

## How to report
For each violation, output one finding: the severity above, the exact `file:line`,
and the concrete downstream breakage (e.g. "clients calling `/v1/users` will 404",
"consumers reading `userName` receive undefined").
