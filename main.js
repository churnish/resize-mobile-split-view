const { Platform, Plugin } = require('obsidian');

// Obsidian's resize handles use mouse events, which don't fire from
// touch/pen input on iOS. This bridges pointer→mouse so drags work.

class ResizeMobileSplitPlugin extends Plugin {
  _dragging = false;
  _cleanupDrag = null;
  _cancelHold = null;
  _hoveredHandle = null;
  _holdTimer = null;

  onload() {
    if (!Platform.isMobile) return;

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    document.addEventListener('pointerdown', this.handlePointerDown, {
      capture: true,
    });
    document.addEventListener('pointermove', this.handlePointerMove);
    this.app.workspace.onLayoutReady(() => this.markHandles());
    this.registerEvent(
      this.app.workspace.on('layout-change', () => this.markHandles())
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

  // Shared drag logic for touch and pen — bridges pointer events to
  // synthetic mouse events so Obsidian's resize handler responds.
  startDrag(handle, touchTarget, startEvent, pointerType, pointerId) {
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
        clientX: startEvent.clientX,
        clientY: startEvent.clientY,
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
    const HOLD_DELAY = 300;

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
        : this.findNearestHandle(e.clientX, e.clientY);
      if (!liveHandle) return;
      this.startDrag(liveHandle, touchTarget, e, 'touch', e.pointerId);
    }, HOLD_DELAY);
  }
}

module.exports = ResizeMobileSplitPlugin;
