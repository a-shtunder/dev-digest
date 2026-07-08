# semver-discipline

When a diff contains a breaking change to a published contract, the package
**version bump must be major** (or the change must be made backward-compatible
instead). Flag breaking changes that ship under a minor/patch bump. Cite
`file:line` for both the breaking change and the `package.json` version.

## Rule
- CRITICAL when the diff has a breaking change (see `breaking-change` /
  `response-schema`) but `package.json` `version` is bumped only **minor or
  patch** — or not bumped at all.
- WARNING when a new public API is added (a feature) but the bump is **patch**
  (should be minor).
- No finding when the version bump matches the change class (major↔breaking,
  minor↔feature, patch↔fix), or when the package is private/unpublished.

## Good
```diff
# Removed a public export → major bump. Correct.
- "version": "2.4.1",
+ "version": "3.0.0",
```

## Bad
```diff
# Removed a public export (breaking) but only bumped patch — consumers on
# ^2.4 auto-upgrade and break.
- "version": "2.4.1",
+ "version": "2.4.2",
```
