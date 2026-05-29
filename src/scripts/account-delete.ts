// Account-deletion gating for the dashboard danger zone.
//
// Pure, side-effect-free seam (no top-level DOM / Supabase access) so the gate
// can be unit-tested without a browser. dashboard.ts wires it to the real
// elements + the `delete_self_account` RPC.
//
// Threat note (OT-SEC-7b): the typed-"DELETE" gate raises the bar against an
// ACCIDENTAL click — it does NOT stop a same-origin XSS, which can set the input
// value, monkey-patch confirm, and click. The true control would be a
// server-side step-up reauth on delete_self_account (out of scope here).

export function isDeleteConfirmed(value: string): boolean {
  return value.trim() === 'DELETE';
}

interface ConfirmInput {
  value: string;
  addEventListener(type: 'input', listener: () => unknown): void;
}

interface DeleteButton {
  disabled: boolean;
  addEventListener(type: 'click', listener: () => unknown): void;
}

export interface DeleteAccountDeps {
  input: ConfirmInput;
  button: DeleteButton;
  /** Native confirm() (or any boolean gate). */
  confirmFn: () => boolean;
  /** Performs the deletion; resolves with a Supabase-style { error } shape. */
  rpc: () => Promise<{ error: { message: string } | null }>;
  signOut: () => Promise<void>;
  redirect: (url: string) => void;
  /** Surfaces a deletion error to the user (e.g. alert). */
  onError?: (message: string) => void;
}

export function wireDeleteAccount(deps: DeleteAccountDeps): void {
  const { input, button, confirmFn, rpc, signOut, redirect, onError } = deps;

  const sync = () => {
    button.disabled = !isDeleteConfirmed(input.value);
  };
  sync(); // button starts disabled until the exact token is typed
  input.addEventListener('input', sync);

  button.addEventListener('click', async () => {
    // Re-guard the predicate on click — a disabled <button> won't fire, but this
    // keeps the RPC unreachable even if `disabled` is bypassed.
    if (!isDeleteConfirmed(input.value)) return;
    if (!confirmFn()) return;
    const { error } = await rpc();
    if (error) {
      onError?.(error.message);
      return;
    }
    await signOut();
    redirect('/');
  });
}
