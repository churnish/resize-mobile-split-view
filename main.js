const { Platform, Plugin } = require('obsidian');

// Obsidian's resize handles use mouse events, which don't fire from
// touch input on iOS. This bridges pointer→mouse so drags work.

const SIDEBAR_HANDLE_HALF_WIDTH = 15; // Half the handle's CSS width (30px)
const HOLD_DELAY_MS = 300;

class ResizeMobileSplitPlugin extends Plugin {
  _dragging = false;
  _cleanupDrag = null;
  _cancelHold = null;
  _hoveredHandle = null;
  _holdTimer = null;
  _workspace = null;
  _sidebarHandle = null;
  _sidebarDragging = false;
  _cleanupSidebarDrag = null;
  _cancelSidebarHold = null;
  _sidebarHoldTimer = null;

  onload() {
    if (!Platform.isMobile) return;

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handleSidebarPointerDown = this.handleSidebarPointerDown.bind(this);
    document.addEventListener('pointerdown', this.handlePointerDown, {
      capture: true,
    });
    document.addEventListener('pointermove', this.handlePointerMove);
    this.app.workspace.onLayoutReady(() => {
      this._workspace = document.querySelector('.workspace');
      this.markHandles();
      this.updateSidebarHandle();
    });
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.markHandles();
        this.updateSidebarHandle();
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
    if (this._cancelSidebarHold) this._cancelSidebarHold();
    if (this._cleanupSidebarDrag) this._cleanupSidebarDrag();
    if (this._sidebarHandle) {
      this._sidebarHandle.remove();
      this._sidebarHandle = null;
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

  // Bridges pointer events to synthetic mouse events so Obsidian's
  // native resize handler responds to touch input.
  startDrag(handle, touchTarget, startX, startY, pointerType, pointerId) {
    this._dragging = true;
    touchTarget.setAttr('data-ignore-swipe', true);

    // Block touchmove to prevent iOS native text selection loupe.
    // iOS's UILongPressGestureRecognizer operates on touch events
    // (before pointer events) — touchmove.preventDefault() is the
    // only mechanism that reaches the native gesture layer.
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
      document.dispatchEvent(
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

  updateSidebarHandle() {
    if (this._sidebarDragging) return;
    const drawer = document.querySelector(
      '.workspace-drawer.mod-left.is-pinned'
    );

    if (drawer && this._workspace) {
      if (!this._sidebarHandle) {
        const handle = document.createElement('div');
        handle.className = 'rmsv-sidebar-handle';
        handle.setAttr('data-ignore-swipe', true);
        handle.style.left =
          drawer.offsetWidth - SIDEBAR_HANDLE_HALF_WIDTH + 'px';
        handle.addEventListener('pointerdown', this.handleSidebarPointerDown);
        // Appended to .workspace (not .workspace-drawer) because the
        // drawer has overflow: hidden, which would clip the handle.
        this._workspace.appendChild(handle);
        this._sidebarHandle = handle;
      } else {
        this._sidebarHandle.style.left =
          drawer.offsetWidth - SIDEBAR_HANDLE_HALF_WIDTH + 'px';
      }
    } else {
      // Not pinned or no workspace — remove handle and clear inline styles
      const unpinnedDrawer = document.querySelector(
        '.workspace-drawer.mod-left'
      );
      if (unpinnedDrawer) {
        unpinnedDrawer.style.removeProperty('width');
        unpinnedDrawer.style.removeProperty('min-width');
        unpinnedDrawer.style.removeProperty('max-width');
      }
      if (this._sidebarHandle) {
        if (this._cancelSidebarHold) this._cancelSidebarHold();
        if (this._cleanupSidebarDrag) this._cleanupSidebarDrag();
        this._sidebarHandle.remove();
        this._sidebarHandle = null;
      }
    }
  }

  handleSidebarPointerDown(e) {
    if (this._dragging || this._sidebarDragging) return;
    if (this._sidebarHoldTimer !== null) return;

    const handle = this._sidebarHandle;
    if (!handle) return;

    if (e.pointerType === 'mouse') {
      // Mouse: immediate drag
      this.startSidebarDrag(e.clientX, 'mouse', e.pointerId);
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
      clearTimeout(this._sidebarHoldTimer);
      this._sidebarHoldTimer = null;
      this._cancelSidebarHold = null;
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
    this._cancelSidebarHold = teardownHold;

    this._sidebarHoldTimer = setTimeout(() => {
      teardownHold();
      this.startSidebarDrag(lastX, 'touch', e.pointerId);
    }, HOLD_DELAY_MS);
  }

  startSidebarDrag(startX, pointerType, pointerId) {
    const drawer = document.querySelector(
      '.workspace-drawer.mod-left.is-pinned'
    );
    const handle = this._sidebarHandle;
    if (!drawer || !handle) return;

    this._sidebarDragging = true;
    this._dragging = true;

    const startWidth = drawer.offsetWidth;
    const minWidth =
      parseInt(
        window
          .getComputedStyle(document.body)
          .getPropertyValue('--mobile-sidebar-width-pinned')
      ) || startWidth;

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
        Math.min(startWidth + delta, maxWidth)
      );
      drawer.style.width = newWidth + 'px';
      drawer.style.minWidth = newWidth + 'px';
      drawer.style.maxWidth = newWidth + 'px';
      handle.style.left = newWidth - SIDEBAR_HANDLE_HALF_WIDTH + 'px';
    };

    const cleanup = (ev) => {
      if (ev && (ev.pointerType !== pointerType || ev.pointerId !== pointerId))
        return;
      document.removeEventListener('touchmove', blockTouchMove, {
        capture: true,
      });
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', cleanup);
      document.removeEventListener('pointercancel', cleanup);
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        // May already be released
      }
      this._sidebarDragging = false;
      this._dragging = false;
      this._cleanupSidebarDrag = null;
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', cleanup);
    document.addEventListener('pointercancel', cleanup);
    this._cleanupSidebarDrag = cleanup;
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
