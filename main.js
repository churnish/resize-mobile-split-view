const { Platform, Plugin } = require('obsidian');

// Obsidian's resize handles use mouse events, which don't fire from
// touch input on iOS. This bridges pointer→mouse so drags work.

const SIDEBAR_HANDLE_HALF_WIDTH = 15; // Half the handle's CSS width (30px)
const HOLD_DELAY_MS = 300;

const SIDES = {
  left: { mod: 'mod-left', positionProp: 'left', direction: 1 },
  right: { mod: 'mod-right', positionProp: 'right', direction: -1 },
};

class ResizeMobileSplitPlugin extends Plugin {
  _dragging = false;
  _cleanupDrag = null;
  _cancelHold = null;
  _hoveredHandle = null;
  _holdTimer = null;
  _workspace = null;
  _leftSidebar = {
    handle: null,
    dragging: false,
    cleanupDrag: null,
    cancelHold: null,
    holdTimer: null,
  };
  _rightSidebar = {
    handle: null,
    dragging: false,
    cleanupDrag: null,
    cancelHold: null,
    holdTimer: null,
  };

  onload() {
    if (!Platform.isMobile) return;

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this._leftSidebar.onPointerDown = (e) =>
      this.handleSidebarPointerDown('left', e);
    this._rightSidebar.onPointerDown = (e) =>
      this.handleSidebarPointerDown('right', e);
    document.addEventListener('pointerdown', this.handlePointerDown, {
      capture: true,
    });
    document.addEventListener('pointermove', this.handlePointerMove);
    this.app.workspace.onLayoutReady(() => {
      this._workspace = document.querySelector('.workspace');
      this.markHandles();
      this.updateSidebarHandle('left');
      this.updateSidebarHandle('right');
    });
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.markHandles();
        this.updateSidebarHandle('left');
        this.updateSidebarHandle('right');
      })
    );
  }

  onunload() {
    if (!Platform.isMobile) return;
    document.removeEventListener('pointerdown', this.handlePointerDown, {
      capture: true,
    });
    document.removeEventListener('pointermove', this.handlePointerMove);
    if (this._cancelHold) this._cancelHold();
    if (this._cleanupDrag) this._cleanupDrag();
    this._workspace?.classList.remove('rmsv-no-select');
    for (const side of [this._leftSidebar, this._rightSidebar]) {
      if (side.cancelHold) side.cancelHold();
      if (side.cleanupDrag) side.cleanupDrag();
      if (side.handle) {
        side.handle.remove();
        side.handle = null;
      }
    }
    this._workspace = null;
  }

  markHandles() {
    for (const handle of document.querySelectorAll(
      '.workspace-leaf-resize-handle'
    )) {
      handle.setAttr('data-ignore-swipe', true);
    }
  }

  findNearestHandle(x, y, threshold = 30) {
    // Default 30px — comfortable finger-tap radius on iOS
    let closest = null;
    let closestDist = threshold;

    for (const handle of document.querySelectorAll(
      '.workspace-leaf-resize-handle'
    )) {
      const rect = handle.getBoundingClientRect();
      const isVertical = rect.height > rect.width;

      let dist;
      if (isVertical) {
        // Vertical divider (side-by-side panes): check horizontal distance
        dist = Math.abs(x - (rect.left + rect.width / 2));
        if (y < rect.top || y > rect.bottom) continue;
      } else {
        // Horizontal divider (stacked panes): check vertical distance
        dist = Math.abs(y - (rect.top + rect.height / 2));
        if (x < rect.left || x > rect.right) continue;
      }

      if (dist < closestDist) {
        closest = handle;
        closestDist = dist;
      }
    }
    return closest;
  }

  setHandleHover(handle) {
    if (this._hoveredHandle === handle) return;
    if (this._hoveredHandle) {
      this._hoveredHandle.classList.remove('rmsv-divider-active');
    }
    this._hoveredHandle = handle;
    if (handle) {
      handle.classList.add('rmsv-divider-active');
    }
  }

  handlePointerMove(e) {
    if (e.pointerType !== 'mouse' || this._dragging || e.buttons) return;
    const handle = e.target.classList.contains('workspace-leaf-resize-handle')
      ? e.target
      : null;
    this.setHandleHover(handle);
  }

  // Bridges pointer events to synthetic mouse events so Obsidian's native
  // resize handler responds to touch input.
  startDrag(handle, touchTarget, startX, startY, pointerType, pointerId) {
    this._dragging = true;
    touchTarget.setAttr('data-ignore-swipe', true);
    this._workspace.classList.add('rmsv-no-select');

    // Block touchmove to prevent browser scroll gesture from firing
    // pointercancel mid-drag (especially for proximity-hit touches).
    const blockTouchMove = (ev) => ev.preventDefault();
    document.addEventListener('touchmove', blockTouchMove, {
      passive: false,
      capture: true,
    });

    handle.classList.add('rmsv-divider-active');

    handle.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX: startX,
        clientY: startY,
        button: 0,
      })
    );

    const onMove = (ev) => {
      if (ev.pointerType !== pointerType || ev.pointerId !== pointerId) return;
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          clientX: ev.clientX,
          clientY: ev.clientY,
        })
      );
    };

    const cleanup = (ev) => {
      if (ev && (ev.pointerType !== pointerType || ev.pointerId !== pointerId))
        return;
      handle.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
          clientX: ev ? ev.clientX : 0,
          clientY: ev ? ev.clientY : 0,
        })
      );
      handle.classList.remove('rmsv-divider-active');
      document.removeEventListener('touchmove', blockTouchMove, {
        capture: true,
      });
      this._workspace?.classList.remove('rmsv-no-select');
      touchTarget.classList.remove('rmsv-no-touch-action');
      if (touchTarget !== handle)
        touchTarget.removeAttribute('data-ignore-swipe');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', cleanup);
      document.removeEventListener('pointercancel', cleanup);
      this._dragging = false;
      this._cleanupDrag = null;
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', cleanup);
    document.addEventListener('pointercancel', cleanup);
    this._cleanupDrag = cleanup;
  }

  updateSidebarHandle(sideName) {
    const side = this[`_${sideName}Sidebar`];
    const config = SIDES[sideName];
    if (side.dragging) return;

    const drawer = document.querySelector(
      `.workspace-drawer.${config.mod}.is-pinned`
    );

    if (drawer && this._workspace) {
      if (!side.handle) {
        const handle = document.createElement('div');
        handle.className = `rmsv-sidebar-handle rmsv-sidebar-handle-${sideName}`;
        handle.setAttr('data-ignore-swipe', true);
        handle.style[config.positionProp] =
          drawer.offsetWidth - SIDEBAR_HANDLE_HALF_WIDTH + 'px';
        handle.addEventListener('pointerdown', side.onPointerDown);
        // Appended to .workspace (not .workspace-drawer) because the
        // drawer has overflow: hidden, which would clip the handle.
        this._workspace.appendChild(handle);
        side.handle = handle;
      } else {
        side.handle.style[config.positionProp] =
          drawer.offsetWidth - SIDEBAR_HANDLE_HALF_WIDTH + 'px';
      }
    } else {
      // Not pinned or no workspace — remove handle and clear inline styles
      const unpinnedDrawer = document.querySelector(
        `.workspace-drawer.${config.mod}`
      );
      if (unpinnedDrawer) {
        unpinnedDrawer.style.removeProperty('width');
        unpinnedDrawer.style.removeProperty('min-width');
        unpinnedDrawer.style.removeProperty('max-width');
      }
      if (side.handle) {
        if (side.cancelHold) side.cancelHold();
        if (side.cleanupDrag) side.cleanupDrag();
        side.handle.remove();
        side.handle = null;
      }
    }
  }

  handleSidebarPointerDown(sideName, e) {
    const side = this[`_${sideName}Sidebar`];
    if (this._dragging || side.dragging) return;
    if (side.holdTimer !== null) return;

    const handle = side.handle;
    if (!handle) return;

    if (e.pointerType === 'mouse') {
      // Mouse: immediate drag
      this.startSidebarDrag(sideName, e.clientX, 'mouse', e.pointerId);
      return;
    }

    if (e.pointerType !== 'touch') return;

    // Touch: hold-to-resize after delay
    const startX = e.clientX;
    let lastX = startX;

    e.preventDefault();
    e.stopPropagation();
    handle.classList.add('rmsv-no-touch-action');

    const teardownHold = () => {
      clearTimeout(side.holdTimer);
      side.holdTimer = null;
      side.cancelHold = null;
      handle.classList.remove('rmsv-no-touch-action');
      document.removeEventListener('pointermove', onHoldMove);
      document.removeEventListener('pointerup', cancelHold);
      document.removeEventListener('pointercancel', cancelHold);
    };

    const cancelHold = (ev) => {
      if (ev && (ev.pointerType !== 'touch' || ev.pointerId !== e.pointerId))
        return;
      teardownHold();
    };

    const onHoldMove = (ev) => {
      if (ev.pointerType !== 'touch' || ev.pointerId !== e.pointerId) return;
      lastX = ev.clientX;
      if (Math.abs(ev.clientX - startX) > 30) {
        teardownHold();
      }
    };

    document.addEventListener('pointermove', onHoldMove);
    document.addEventListener('pointerup', cancelHold);
    document.addEventListener('pointercancel', cancelHold);
    side.cancelHold = teardownHold;

    side.holdTimer = setTimeout(() => {
      teardownHold();
      this.startSidebarDrag(sideName, lastX, 'touch', e.pointerId);
    }, HOLD_DELAY_MS);
  }

  startSidebarDrag(sideName, startX, pointerType, pointerId) {
    const side = this[`_${sideName}Sidebar`];
    const config = SIDES[sideName];
    const drawer = document.querySelector(
      `.workspace-drawer.${config.mod}.is-pinned`
    );
    const handle = side.handle;
    if (!drawer || !handle) return;

    side.dragging = true;
    this._dragging = true;
    this._workspace.classList.add('rmsv-no-select');

    const startWidth = drawer.offsetWidth;
    // Strip inline min-width (set by previous drag) to read the CSS value,
    // then restore immediately to prevent visual reflow
    drawer.style.removeProperty('min-width');
    const minWidth =
      parseInt(window.getComputedStyle(drawer).minWidth) || startWidth;
    drawer.style.minWidth = startWidth + 'px';

    const blockTouchMove = (ev) => ev.preventDefault();
    document.addEventListener('touchmove', blockTouchMove, {
      passive: false,
      capture: true,
    });

    try {
      handle.setPointerCapture(pointerId);
    } catch {
      // Pointer capture may fail if pointer was already released
    }

    const onMove = (ev) => {
      if (ev.pointerType !== pointerType || ev.pointerId !== pointerId) return;
      const delta = ev.clientX - startX;
      const maxWidth = window.innerWidth * 0.5;
      const newWidth = Math.max(
        minWidth,
        Math.min(startWidth + config.direction * delta, maxWidth)
      );
      drawer.style.width = newWidth + 'px';
      drawer.style.minWidth = newWidth + 'px';
      drawer.style.maxWidth = newWidth + 'px';
      handle.style[config.positionProp] =
        newWidth - SIDEBAR_HANDLE_HALF_WIDTH + 'px';
    };

    const cleanup = (ev) => {
      if (ev && (ev.pointerType !== pointerType || ev.pointerId !== pointerId))
        return;
      document.removeEventListener('touchmove', blockTouchMove, {
        capture: true,
      });
      this._workspace?.classList.remove('rmsv-no-select');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', cleanup);
      document.removeEventListener('pointercancel', cleanup);
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        // May already be released
      }
      side.dragging = false;
      this._dragging = false;
      side.cleanupDrag = null;
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', cleanup);
    document.addEventListener('pointercancel', cleanup);
    side.cleanupDrag = cleanup;
  }

  handlePointerDown(e) {
    if (this._dragging || this._holdTimer !== null) return;

    // Only touch drags — mouse uses native handler, pen is ignored (matches iOS convention)
    if (e.pointerType !== 'touch') {
      if (
        e.pointerType === 'mouse' &&
        !e.target.classList.contains('workspace-leaf-resize-handle')
      ) {
        this.setHandleHover(null);
      }
      return;
    }

    // Clear any leftover pointer hover state
    this.setHandleHover(null);

    // Only handle inside root workspace (not sidebars/modals/overlays)
    if (!e.target.closest('.mod-root')) return;

    const directHit = e.target.classList.contains(
      'workspace-leaf-resize-handle'
    );
    const handle = directHit
      ? e.target
      : this.findNearestHandle(e.clientX, e.clientY);
    if (!handle) return;

    // Touch: hold-to-resize after delay
    const touchTarget = e.target;
    let lastX = e.clientX;
    let lastY = e.clientY;

    // Direct hit: take full control. Proximity hit: let browser handle
    // naturally — if iOS grabs the gesture (scroll/swipe), pointercancel
    // fires and cancelHold cleans up before the timer completes.
    if (directHit) {
      e.preventDefault();
      e.stopPropagation();
      touchTarget.classList.add('rmsv-no-touch-action');
    }

    // Teardown hold-phase listeners and timer — called from cancelHold,
    // timer callback, and onunload (via _cancelHold).
    const teardownHold = () => {
      clearTimeout(this._holdTimer);
      this._holdTimer = null;
      this._cancelHold = null;
      touchTarget.classList.remove('rmsv-no-touch-action');
      if (touchTarget !== handle)
        touchTarget.removeAttribute('data-ignore-swipe');
      document.removeEventListener('pointermove', onHoldMove);
      document.removeEventListener('pointerup', cancelHold);
      document.removeEventListener('pointercancel', cancelHold);
    };

    const cancelHold = (ev) => {
      if (ev && (ev.pointerType !== 'touch' || ev.pointerId !== e.pointerId))
        return;
      teardownHold();
    };

    // Cancel hold if finger leaves the proximity zone around the handle
    const onHoldMove = (ev) => {
      if (ev.pointerType !== 'touch' || ev.pointerId !== e.pointerId) return;
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (!this.findNearestHandle(ev.clientX, ev.clientY)) {
        teardownHold();
      }
    };

    document.addEventListener('pointermove', onHoldMove);
    document.addEventListener('pointerup', cancelHold);
    document.addEventListener('pointercancel', cancelHold);
    this._cancelHold = teardownHold;

    this._holdTimer = setTimeout(() => {
      teardownHold();
      // Re-validate handle is still in the DOM (layout may have changed)
      const liveHandle = document.contains(handle)
        ? handle
        : this.findNearestHandle(lastX, lastY);
      if (!liveHandle) return;
      this.startDrag(
        liveHandle,
        touchTarget,
        lastX,
        lastY,
        'touch',
        e.pointerId
      );
    }, HOLD_DELAY_MS);
  }
}

module.exports = ResizeMobileSplitPlugin;
