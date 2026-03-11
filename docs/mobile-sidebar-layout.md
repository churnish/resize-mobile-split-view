---
title: Mobile sidebar layout
description: CSS and DOM behavior of the pinned left sidebar on mobile — selectors, flex constraints, inline style persistence, and resize gotchas.
author: 🤖 Generated with Claude Code
last updated: 2026-03-11
---
# Mobile sidebar layout

## Selectors

- **Pinned sidebar**: `.workspace-drawer.mod-left.is-pinned` (NOT `.mod-left-split`)
- **Unpinned sidebar**: `.workspace-drawer.mod-left` (without `.is-pinned`)
- **Width CSS vars**: `--mobile-sidebar-width-pinned` (default width), `--mobile-sidebar-width` (max width)
- **Border**: CSS-only via `border-right: var(--divider-width) solid var(--divider-color)` — no native resize handle element

All `.workspace-leaf-resize-handle` elements are inside `.mod-root`, not in sidebars.

## Flex constraints

**Observed**: 2026-03-11, Obsidian 1.8.10

The pinned sidebar has `flex: 0 1 auto` (`flex-shrink: 1`) and CSS `min-width` from `--mobile-sidebar-width-pinned` (~300px). When overriding width via inline styles:

- Setting `width` + `max-width` alone does NOT work — flex shrinks the element back to CSS `min-width`
- Must set all three: `width`, `min-width`, `max-width` to force the desired width
- Clear all three on unpin to restore default layout

## Inline style persistence

**Observed**: 2026-03-11, Obsidian 1.8.10

Inline `style` attributes on `.workspace-drawer` survive `layout-change` events and `requestSaveLayout` calls. Obsidian does NOT reset inline styles during layout recalculations. Styles must be explicitly cleared when state changes (e.g., sidebar unpin).

