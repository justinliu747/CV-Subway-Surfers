export class HandCursorOverlay {
  private readonly el: HTMLElement;
  private readonly ring: HTMLElement;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hand-cursor';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="hand-cursor-dot"></div>
      <div class="hand-cursor-ring" data-role="ring"></div>
    `;
    this.ring = this.el.querySelector('[data-role="ring"]') as HTMLElement;
    root.appendChild(this.el);
  }

  setVisible(visible: boolean): void {
    this.el.hidden = !visible;
    if (!visible) {
      this.el.classList.remove('pinching', 'held');
    }
  }

  update(opts: {
    x: number;
    y: number;
    visible: boolean;
    pinching: boolean;
    pinchHeld: boolean;
    pinchProgress: number;
  }): void {
    if (!opts.visible) {
      this.setVisible(false);
      return;
    }
    this.setVisible(true);
    this.el.style.transform = `translate(${opts.x}px, ${opts.y}px)`;
    this.el.classList.toggle('pinching', opts.pinching);
    this.el.classList.toggle('held', opts.pinchHeld);
    const p = Math.max(0, Math.min(1, opts.pinchProgress));
    this.ring.style.setProperty('--pinch', String(p));
  }
}
