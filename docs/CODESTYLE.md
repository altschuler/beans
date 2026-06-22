# Code style

## General rules

These are defaults, not hard rules. Use judgment, but start here.

- Follow existing repo patterns first.
- Prefer the smallest working implementation that solves the current need.
- Keep logic in the narrowest valid layer.
- Prefer clear, declarative code.
- Reach for lodash helpers like `uniq`, `compact`, and `groupBy` when they make code easier to read.
- Use the shared `cn` helper for conditional class names instead of array `filter(Boolean).join(' ')` patterns.
- Prefer functional style first; switch to imperative code when it is meaningfully faster or the functional version gets awkward.
- Treat locality as the default: prefer feature-local code over shared abstractions.
- Avoid building infrastructure for a single feature or one-off need.
- Before extracting a helper, hook, module, util, or config object, ask:
  1. Is there immediate reuse?
  2. Does it encode meaningful domain or business behavior?
- If neither is true, keep it local or inline.
- Inline simple mapping, formatting, and glue code when that is clearer.
- At the end of each milestone, do a collapse pass.
- Remove helpers, wrappers, indirection, and feature-local abstractions that no longer justify their cost.
- Do not carry scaffolding forward just because it already works.
- Only use explicit typing if absolutely required; prefer type inference.

## Collapse pass

Before handoff, look specifically for code that was useful while building but does not need to remain:

- Prop bundles that duplicate values derivable from one domain input. Prefer passing the domain input and deriving labels, descriptions, placeholders, and flags in the owning component.
- Tiny one-off helpers or switch wrappers around simple message lookups, mappings, or formatting. Inline them or use a Paraglide matcher message when that is clearer.
- Feature-local hooks, configs, or components that are used once and do not own meaningful state or domain behavior.
- Preview/test scaffolding that repeats production logic instead of reusing the real component boundary.
