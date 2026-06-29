import { EventEmitter } from 'events';

export type DiagnosticsLockOwner = 'diagnostics' | 'perfetto';

/**
 * Singleton mutual-exclusion lock for device access.
 *
 * Only one panel (Diagnostics or Perfetto) may hold the device at a time.
 * Both panels subscribe to 'change' events so their UIs can react immediately
 * without polling.
 */
class DiagnosticsLock extends EventEmitter {
  private _owner: DiagnosticsLockOwner | null = null;

  /**
   * Attempt to acquire the lock for `owner`.
   * Returns false (without changing state) if another owner already holds it.
   */
  acquire(owner: DiagnosticsLockOwner): boolean {
    if (this._owner !== null && this._owner !== owner) return false;
    if (this._owner === owner) return true; // idempotent
    this._owner = owner;
    this.emit('change', this._owner);
    return true;
  }

  /**
   * Release the lock.  No-op if `owner` is not the current holder.
   */
  release(owner: DiagnosticsLockOwner): void {
    if (this._owner !== owner) return;
    this._owner = null;
    this.emit('change', this._owner);
  }

  get owner(): DiagnosticsLockOwner | null {
    return this._owner;
  }
}

export const diagnosticsLock = new DiagnosticsLock();
