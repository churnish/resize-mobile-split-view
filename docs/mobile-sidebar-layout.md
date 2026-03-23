---
title: Mobile sidebar layout
description: CSS and DOM behavior of pinned sidebars (left and right) on mobile — selectors, flex constraints, inline style persistence, and resize gotchas.
author: 🤖 Generated with Claude Code
last updated: 2026-03-22
---
# Mobile sidebar layout

## Selectors

- **Pinned left sidebar**: `.workspace-drawer.mod-left.is-pinned` (NOT `.mod-left-split`)
- **Pinned right sidebar**: `.workspace-drawer.mod-right.is-pinned`
- **Unpinned left sidebar**: `.workspace-drawer.mod-left` (without `.is-pinned`)
- **Unpinned right sidebar**: `.workspace-drawer.mod-right` (without `.is-pinned`)
- **Width CSS vars**: `--mobile-sidebar-width-pinned` (default width, shared by both sides), `--mobile-sidebar-width` (max width)
- **Border**: Left sidebar uses `border-right`, right sidebar uses `border-left` — CSS-only via `var(--divider-width) solid var(--divider-color)`, no native resize handle element

All `.workspace-leaf-resize-handle` elements are inside `.mod-root`, not in sidebars.

## Flex constraints

**Observed**: 2026-03-11, Obsidian 1.12.x

The pinned sidebar has `flex: 0 1 auto` (`flex-shrink: 1`) and CSS `min-width` from `--mobile-sidebar-width-pinned` (~300px). When overriding width via inline styles:

- Setting `width` + `max-width` alone does NOT work — flex shrinks the element back to CSS `min-width`
- Must set all three: `width`, `min-width`, `max-width` to force the desired width
- Clear all three on unpin to restore default layout

## Inline style persistence

**Observed**: 2026-03-11, Obsidian 1.12.x

Inline `style` attributes on `.workspace-drawer` survive `layout-change` events and `requestSaveLayout` calls. Obsidian does NOT reset inline styles during layout recalculations. Styles must be explicitly cleared when state changes (e.g., sidebar unpin).

## Sidebar open/close detection

**Observed**: 2026-03-12, Obsidian 1.12.x

On mobile, sidebar open/close state is reflected on `.workspace` via class names — NOT on the drawer elements themselves:

- **Left sidebar open**: `.workspace.is-left-sidedock-open`
- **Right sidebar open**: `.workspace.is-right-sidedock-open`

Desktop uses `.workspace-drawer.mod-left.is-open` — this class does NOT exist on mobile. A `workspace-drawer-backdrop` element is added/removed from the DOM when sidebars open/close on mobile.

## Desktop emulation limitation

**Observed**: 2026-03-22, Obsidian 1.12.6

`setPinned(true)` on `workspace.leftSplit`/`workspace.rightSplit` does NOT add the `.is-pinned` class in desktop mobile emulation (`app.emulateMobile(true)`). The pinned sidebar state cannot be triggered or tested via emulation — must test on a real device.

## Swipe suppression

Obsidian's mobile swipe-to-open gesture can be suppressed per-element via the `data-ignore-swipe` attribute. Elements with this attribute (or descendants of such elements) won't trigger sidebar swipe opens. Synthetic events dispatched on elements with `data-ignore-swipe` also carry the suppression — the event target is checked, not just the touch origin.

