const { Notice, Plugin } = require('obsidian');

// Obsidian's resize handles use mouse events, which don't fire from
// touch input on iOS. This bridges touch→mouse so finger drags work.

class ResizeMobileSplitPlugin extends Plugin {
  onload() {
    this.handlePointerDown = this.handlePointerDown.bind(this);
    document.addEventListener('pointerdown', this.handlePointerDown, { capture: true });
    this.markHandles();
    this.registerEvent(this.app.workspace.on('layout-change', () => this.markHandles()));
    new Notice('Resize Mobile Split loaded #7');
  }

  onunload() {
    document.removeEventListener('pointerdown', this.handlePointerDown, { capture: true });
  }

  markHandles() {
    for (const handle of document.querySelectorAll('.workspace-leaf-resize-handle')) {
      handle.setAttr('data-ignore-swipe', true);
    }
  }

  findNearestHandle(x, y) {
    const threshold = 30;
    let closest = null;
    let closestDist = threshold;

    for (const handle of document.querySelectorAll('.workspace-leaf-resize-handle')) {
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

  handlePointerDown(e) {
    if (e.pointerType !== 'touch') return;

    const handle = e.target.classList.contains('workspace-leaf-resize-handle')
      ? e.target
      : this.findNearestHandle(e.clientX, e.clientY);
    if (!handle) return;

    // Temporarily suppress sidebar swipe on the actual touch target
    const touchTarget = e.target;
    touchTarget.setAttr('data-ignore-swipe', true);

    handle.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      clientX: e.clientX,
      clientY: e.clientY,
      button: 0,
    }));
    e.preventDefault();
    e.stopPropagation();

    const onMove = (ev) => {
      if (ev.pointerType !== 'touch') return;
      document.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        clientX: ev.clientX,
        clientY: ev.clientY,
      }));
    };

    const onUp = (ev) => {
      if (ev.pointerType !== 'touch') return;
      document.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        clientX: ev.clientX,
        clientY: ev.clientY,
      }));
      touchTarget.removeAttribute('data-ignore-swipe');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }
}

module.exports = ResizeMobileSplitPlugin;
