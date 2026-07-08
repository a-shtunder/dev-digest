# breaking-change

Flag any change that removes or alters a **public contract** other code depends
on: an exported function/route signature, a public type, an enum value, an HTTP
route path or method, or a required request field. Cite the offending `file:line`
and say what downstream callers will break.

## Rule
- CRITICAL when a public/exported symbol, route path, or HTTP method is **removed
  or renamed** with no backward-compatible alias.
- CRITICAL when a function/route **parameter is removed, reordered, or made
  required** where it was previously optional.
- WARNING when a public parameter or request field **changes type**.
- A change is NOT breaking if the symbol is internal (not exported / not part of a
  public route) — say so and move on.

## Good
```ts
// Additive: new optional param, old callers keep working.
export function getUser(id: string, opts?: { include?: string[] }) { … }
```

## Bad
```ts
// Removed a public param and reordered the rest — every caller breaks.
- export function getUser(id: string, opts?: Options) { … }
+ export function getUser(opts: Options, id: string) { … }

// Route renamed with no alias — clients calling /v1/users 404.
- app.get('/v1/users', handler)
+ app.get('/v1/accounts', handler)
```
