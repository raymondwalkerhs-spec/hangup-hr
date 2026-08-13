---
kind: frontend_style
name: CSS Variables + Multi-Theme Design Tokens
category: frontend_style
scope:
    - '**'
source_files:
    - public/css/app.css
    - public/js/theme.js
    - public/index.html
---

The Hang-Up HR Desktop app uses a vanilla CSS design-token system driven by data-theme attributes on the html element, with no build step, preprocessors, or component library.

System overview
- Single stylesheet: public/css/app.css (~2180 lines) is the only source of UI style.
- Theme switching is handled client-side by public/js/theme.js, which persists the chosen theme in localStorage under key hr_ui_theme and sets document.documentElement.setAttribute('data-theme', id).
- The HTML entry (public/index.html) loads /js/theme.js before /css/app.css so the correct token set is applied immediately on load.

Design tokens
- Each theme block (light, dark, grey, dark-wine, dark-grey, alabaster, girly-pink) redefines a consistent palette of custom properties: --bg, --card, --text, --muted, --primary, --border, --sidebar, --ok, --warn, --err, plus semantic variants for alerts, version blocks, inputs, shadows, gradients, and skeleton states.
- A shared :root block defines derived tokens that automatically adapt to every theme via color-mix(in srgb, ...): spacing scale (--space-*), radius scale (--radius*), surface layers (--surface, --surface-2, --surface-3), tinted backgrounds (--tint-ok-bg, --tint-warn-bg, --tint-err-bg, --tint-muted-bg, --tint-primary-bg), focus ring, and motion constants (--ease-out, --dur-fast, --dur-med).

Component conventions
- Global base styles cover typography (Segoe UI/system-ui), scrollbars, accessible :focus-visible rings, and layout shells (.app-shell, .sidebar, .main-content, .toolbar-card).
- Reusable primitives are defined as classes rather than components: buttons (.btn, .btn-primary, .btn-secondary, .btn-outline, .btn-success, .btn-danger, .btn-sm, .btn-lg, .btn-icon, .btn-ghost), badges (.badge-online, .badge-offline, .badge-active, .badge-paused, .badge-warn, .badge-err), cards (.card, .card-flat, .card-stat), grids (.grid-2, .grid-3, .grid-4), forms (.field, .form-grid, .form-actions), and utility helpers (.hidden, .stack, .flex-between, .inline-input, .muted, .brand-tag).
- Login/registration pages share the same token system through dedicated layouts (.login-page, .login-card, .reg-stepper, .reg-step-dot, .reg-pipeline-item, etc.).

Responsive strategy
- No media-query breakpoints are used; the layout relies on flexbox/grid auto-fit and percentage widths to adapt across screen sizes.
- Sidebar collapses behind a backdrop on small screens via the .nav-toggle button and .sidebar-backdrop class toggled by JS.

Rules developers should follow
- Always use the provided CSS variables (var(--*)) instead of hard-coded colors, spacing, or radii.
- Add new themes by creating a [data-theme="<id>"] block that mirrors the full variable set from an existing theme, then register it in public/js/theme.js THEMES list.
- Prefer the built-in primitive classes (.btn, .card, .badge-*, .field, .form-grid) over writing ad-hoc styles.
- Keep all visual changes in public/css/app.css; there is no SCSS, Tailwind, or CSS-in-JS pipeline.
- For new interactive surfaces, reuse the established focus-ring, shadow, and transition tokens (--focus-ring, --shadow-soft, --dur-fast, --ease-out) to maintain consistency.