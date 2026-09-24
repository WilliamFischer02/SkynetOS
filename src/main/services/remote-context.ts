import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Is this call coming from a remote device?
 *
 * A remote call runs inside `runAsRemote`. Anything that would put a native dialog on the DESKTOP
 * (a launch confirmation, a UAC warning, a file picker) calls `refuseDialogWhenRemote` first, and a
 * remote call gets a clear "confirm on the desktop" error instead of a promise that hangs until
 * somebody at home clicks a box nobody can see from the phone. Same-process context, carried
 * across awaits by AsyncLocalStorage, so no handler signature had to change.
 */

const context = new AsyncLocalStorage<{ device: string }>();

export class DesktopConfirmationNeeded extends Error {
  constructor(what: string) {
    super(`CONFIRM ON THE DESKTOP — ${what} asks a question on the PC's screen, which cannot be answered remotely`);
    this.name = 'DesktopConfirmationNeeded';
  }
}

export function runAsRemote<T>(device: string, fn: () => T): T {
  return context.run({ device }, fn);
}

export function isRemoteCall(): boolean {
  return context.getStore() !== undefined;
}

/** Throws when the current call is remote. Put it at the top of anything that shows a dialog. */
export function refuseDialogWhenRemote(what: string): void {
  if (isRemoteCall()) throw new DesktopConfirmationNeeded(what);
}
