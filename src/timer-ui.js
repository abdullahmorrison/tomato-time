// The countdown badge. Small, in one corner, gone the moment the round ends.

export class TimerUI {
  constructor(root, corner) {
    this.root = root;
    this.value = root.querySelector('.timer-value');
    root.dataset.corner = corner;
    this.shown = false;
    this.lastWhole = -1;
  }

  show() {
    this.shown = true;
    this.lastWhole = -1;
    this.root.classList.add('is-visible');
  }

  hide() {
    this.shown = false;
    this.root.classList.remove('is-visible', 'is-urgent');
  }

  update(secondsLeft) {
    const whole = Math.max(0, Math.ceil(secondsLeft));
    if (whole === this.lastWhole) return;
    this.lastWhole = whole;
    this.value.textContent = whole;
    this.root.classList.toggle('is-urgent', whole <= 5);
  }
}
