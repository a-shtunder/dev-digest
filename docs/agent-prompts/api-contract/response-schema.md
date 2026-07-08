# response-schema

Flag changes to the **shape of a response** an API returns: renamed or removed
fields, a field's type changing, or a previously-optional field becoming required
(or vice-versa). Consumers parse these responses — a silent shape change breaks
them. Cite `file:line`.

## Rule
- CRITICAL when a response field is **removed or renamed** (e.g. `userName` →
  `name`) without keeping the old field.
- WARNING when a field's **type changes** (e.g. `id: number` → `id: string`, or
  scalar → object).
- WARNING when a field flips **required ↔ optional/nullable**, because clients may
  assume it is always present.
- Applies to REST JSON bodies, GraphQL types, and shared DTO/response schemas
  (e.g. Zod `z.object`, TypeScript response interfaces).

## Good
```ts
// Additive + backward compatible: new optional field, old ones untouched.
const UserResponse = z.object({
  id: z.string(),
  name: z.string(),
  avatarUrl: z.string().optional(), // added
});
```

## Bad
```ts
// Renamed a field and changed a type — every consumer that reads
// `userName`/`id: number` now breaks.
- const UserResponse = z.object({ userName: z.string(), id: z.number() });
+ const UserResponse = z.object({ name: z.string(),     id: z.string() });
```
