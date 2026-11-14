/**
 * Eingabe: Tastatur (WASD / Pfeiltasten) und Gamepad (Standard-Belegung).
 */
import type { CarInput } from './Car.ts';

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  enabled = true;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'SELECT' || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (this.enabled && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Taste in diesem Frame neu gedrückt (einmalig) */
  wasPressed(code: string): boolean {
    if (this.pressed.has(code)) {
      this.pressed.delete(code);
      return true;
    }
    return false;
  }

  clearPressed(): void {
    this.pressed.clear();
  }

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  read(): CarInput {
    if (!this.enabled) return { throttle: 0, brake: 0, steer: 0, handbrake: false };
    let throttle = this.down('KeyW', 'ArrowUp') ? 1 : 0;
    let brake = this.down('KeyS', 'ArrowDown') ? 1 : 0;
    let steer = (this.down('KeyA', 'ArrowLeft') ? 1 : 0) - (this.down('KeyD', 'ArrowRight') ? 1 : 0);
    let handbrake = this.down('Space');

    const pad = navigator.getGamepads?.().find((p) => p && p.connected);
    if (pad) {
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      const sx = pad.axes[0] ?? 0;
      throttle = Math.max(throttle, rt);
      brake = Math.max(brake, lt);
      if (Math.abs(sx) > 0.12) steer = -Math.sign(sx) * ((Math.abs(sx) - 0.12) / 0.88);
      handbrake = handbrake || !!pad.buttons[0]?.pressed;
    }
    return { throttle, brake, steer, handbrake };
  }
}
