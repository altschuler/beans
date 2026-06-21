# Design

This document is the source of truth for UI and UX consistency. Read it before changing layout, styling, or shared components.

## Goals

- Keep the app calm, dense, and readable for financial review workflows.
- Use semantic design tokens instead of one-off colors and measurements.
- Prefer shadcn components and patterns so the UI stays easy to extend.
- Support light and dark themes without route- or component-specific overrides.

## shadcn-first rule

Use shadcn primitives from `src/components/ui/` for common UI building blocks: buttons, cards, dialogs, dropdown menus, inputs, labels, popovers, separators, sheets, sidebars, skeletons, toasts, and tooltips.

- Add missing primitives through shadcn-style components rather than inventing unrelated APIs.
- Keep generic primitives in `src/components/ui/`.
- Keep app-specific composition outside `src/components/ui/`, for example in `src/components/layout/`, `src/components/ledger/`, or feature folders.
- Do not hard-code styles inside shadcn primitives unless the token system cannot express the need.

## Design tokens

Tokens live in `src/styles/app.css`. Use Tailwind utilities backed by these tokens rather than raw color values.

### Color tokens

Use semantic tokens by intent:

| Token utility | Use |
| --- | --- |
| `bg-background`, `text-foreground` | Page and main app surfaces. |
| `bg-card`, `text-card-foreground` | Card-like grouped content. |
| `bg-popover`, `text-popover-foreground` | Floating menus, popovers, dialogs. |
| `bg-primary`, `text-primary-foreground` | Primary actions and strong selected states. |
| `bg-secondary`, `text-secondary-foreground` | Lower-emphasis filled controls. |
| `bg-muted`, `text-muted-foreground` | Table headers, hints, secondary text, subtle fills. |
| `bg-accent`, `text-accent-foreground` | Hover/focus/active menu states. |
| `text-destructive`, `bg-destructive` | Errors and destructive actions. |
| `bg-status-confirmed` | Confirmed/successful categorization status dots. |
| `bg-status-suggested` | High-confidence AI suggestion status dots. |
| `bg-status-review` | Needs-review / medium-confidence status dots. |
| `border`, `border-border`, `border-input` | Borders and form controls. |
| `ring-ring` | Focus rings. |
| `bg-sidebar`, `text-sidebar-foreground` | Sidebar surfaces and text. |
| `bg-sidebar-accent`, `text-sidebar-accent-foreground` | Sidebar hover/active/user-chip states. |

Avoid raw color utilities such as `bg-white`, `text-black`, `border-neutral-200`, or `dark:bg-*` in app code. Prefer semantic tokens so light and dark themes work automatically.

Small opacity modifiers are fine when they preserve semantics, for example `bg-muted/40`, `border-destructive/30`, or `hover:ring-ring/70`.

### Dark theme

Dark mode is class-based through `.dark` on `<html>`. The app supports `light`, `dark`, and `system`; the user choice is persisted in `localStorage`.

Rules:

- Add both light and dark token values for any new semantic token.
- Do not style dark mode with component-level `dark:` classes unless a token cannot represent the behavior.
- Prefer neutral shadcn dark surfaces: near-black page background, slightly lighter cards/popovers/sidebar, restrained borders.
- Test new components in both themes when they introduce custom visual states.

### Spacing and sizing

Use Tailwind's spacing scale consistently:

- Page/document padding: `p-4 md:p-6 lg:p-8`.
- Dense table/list page content: `p-0` at page level with spacing owned by the table/list component.
- Cards and list rows: usually `p-3` or `px-3 py-2`.
- Form stacks: `space-y-4`; label/control groups: `space-y-2`.
- Inline groups: `gap-2` for tight controls, `gap-3` for row content, `gap-4` for larger separation.

Avoid arbitrary spacing unless the component has a real layout constraint, such as a table column width or viewport calculation.

### Borders, radius, and shadow

- Use `rounded-md` for most controls, rows, and cards.
- Use `rounded-lg` for larger containers or prominent brand marks.
- Use token-backed borders: `border`, `border-input`, or `border-sidebar-border`.
- Keep shadows subtle and mostly reserved for floating UI (`shadow-md`, `shadow-lg`) via shadcn primitives.

## Layout patterns

Authenticated app pages use the sidebar shell and page-owned layout.

- `Shell` owns the sidebar and route-agnostic app frame.
- `PageLayout` owns fixed page headers, breadcrumbs, optional actions, and scrollable content.
- Pages choose content padding through `contentClassName`.
- Table-first pages should keep the page content full-height and scroll the table body/header area intentionally.

## Typography

- Keep the default sans font from `--font-sans`.
- Use concise headings; app pages should rely on `PageLayout` breadcrumbs/header context when possible.
- Use `text-muted-foreground` for helper copy, metadata, and secondary values.
- Use `font-mono` for financial amounts, identifiers, and ledger-style tabular data.
- Avoid oversized marketing-style typography inside the authenticated app.

## Tables and lists

Financial review views should be dense and scannable.

- Use sticky table headers with `bg-muted`, uppercase `text-xs`, and `text-muted-foreground`.
- Use `border-t` row dividers rather than heavy card borders for every row in dense tables.
- Keep amounts right-aligned and monospaced.
- Keep row actions close to the field they affect.
- Prefer empty states that say what is missing and what the user can do next.

## Forms and inputs

- Use shadcn `Input`, `Label`, `Button`, `Dialog`, `Popover`, and `DropdownMenu` where applicable.
- Inputs should use `bg-background`, `border-input`, and `focus-visible:ring-ring`.
- Destructive or validation text should use `text-destructive`.
- Avoid exposing internal accounting terms in form copy; follow `docs/VOCABULARY.md`.

## Sidebar and menus

- Sidebar navigation uses shadcn sidebar primitives and sidebar tokens.
- The footer user control should be a dropdown menu for account-level actions.
- Theme selection belongs in the user menu as `Light`, `Dark`, and `System`.
- Sign out belongs in the user menu, separated from theme settings.

## Icons

Use `lucide-react` for all UI icons.

- Do not introduce another icon library without updating this document and getting explicit approval.
- Prefer accessible icon-only buttons with `aria-label` and/or `title` text.
- Keep icon sizing and stroke weight consistent with nearby text and controls.
- Icons should support the label; they should not be the only visible affordance except in compact/icon-only controls.

## Loading, empty, and error states

- Loading states should keep layout stable; use skeletons for structured areas and concise text for simple gaps.
- Empty states should be calm and actionable.
- Errors should use `text-destructive` and avoid raw red classes.
- Toasts should be used for completion/failure feedback after user actions, not as the only place important state appears.

## Before adding new styles

1. Check whether an existing shadcn primitive already solves the problem.
2. Check whether an existing semantic token expresses the visual intent.
3. If a new token is needed, add light and dark values in `src/styles/app.css` and document it here.
4. Keep one-off arbitrary values local, rare, and justified by layout constraints.
