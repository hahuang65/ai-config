---
name: frontend-patterns
description: Frontend development patterns including component composition, state management, performance optimization, and accessibility. Framework-agnostic reference skill loaded by the plan phase when frontend work is detected.
argument-hint: [topic-or-question]
---

# Frontend Development Patterns

Framework-agnostic reference patterns for modern frontend development.

## Component Patterns

### Composition Over Inheritance
Use children and slot props instead of inheritance. Build compound components (Card + CardHeader + CardBody) for flexible layouts.

### Compound Components
Share state between related components via a shared context. The parent manages state, children consume it. Example: Tabs + TabList + Tab + TabPanel.

### Render Props / Children as Function
Pass a function as children for flexible data loading patterns. Useful for DataLoader, AuthGuard, and similar wrapper components.

## State Management

### When to use what
- **Local state**: Component-scoped, form inputs, UI toggles
- **Derived state**: Computed from other state — don't store what you can calculate
- **Shared state**: Lifted to nearest common ancestor or a context/store
- **Global state**: App-wide concerns (auth, theme, feature flags) — use a dedicated store

### Key principles
- Single source of truth — no duplicated state
- Immutable updates — always return new objects, never mutate
- Minimal state — only store what can't be derived
- Colocate state — keep it as close to where it's used as possible

## Data Fetching Patterns

### Loading/Error/Data states
Every async operation should track three states: loading (boolean), error (nullable), and data (nullable). Show appropriate UI for each.

### Debounced search
Debounce user input (300-500ms) before firing search requests. Cancel in-flight requests when a new one starts.

### Optimistic updates
Update the UI immediately, then reconcile with the server response. Roll back on error.

### Pagination
- Offset-based: Simple, supports "jump to page N", slow on large datasets
- Cursor-based: Consistent performance, better for infinite scroll
- Load more: Append results to existing list

## Performance

- **Lazy loading**: Load heavy components/routes only when needed
- **Code splitting**: Split bundles by route or feature
- **Virtualization**: Render only visible items in long lists (100+ items)
- **Memoization**: Cache expensive computations, avoid unnecessary re-renders
- **Image optimization**: Use responsive images, lazy loading, modern formats (WebP/AVIF)
- **Bundle analysis**: Audit bundle size regularly, tree-shake unused code

## Accessibility

- **Keyboard navigation**: Handle ArrowUp/Down/Enter/Escape in dropdowns and menus
- **Focus management**: Trap focus in modals, restore focus on close
- **ARIA attributes**: `role`, `aria-expanded`, `aria-haspopup`, `aria-modal`
- **Semantic HTML**: Use `<button>` not `<div onClick>`, `<nav>` not `<div class="nav">`
- **Color contrast**: Meet WCAG AA (4.5:1 for text, 3:1 for large text)
- **Screen reader support**: Meaningful alt text, aria-labels for icon buttons

## CSS Architecture

- **CSS variables**: Define design tokens (colors, spacing, typography) as custom properties
- **Mobile-first**: Write base styles for mobile, add complexity with `min-width` media queries
- **Logical properties**: Use `margin-inline`, `padding-block` over directional properties for RTL support
- **Container queries**: Size components based on their container, not the viewport
- **Avoid deep nesting**: Max 3 levels of selector nesting
