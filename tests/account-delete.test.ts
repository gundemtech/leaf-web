import { describe, it, expect, vi } from 'vitest';
import { isDeleteConfirmed, wireDeleteAccount } from '../src/scripts/account-delete';

// ── isDeleteConfirmed: the gate predicate ───────────────────────────────────
describe('isDeleteConfirmed', () => {
  const cases: Array<[string, boolean]> = [
    ['DELETE', true],
    ['  DELETE  ', true], // trimmed
    ['delete', false],
    ['', false],
    ['DELET', false],
    ['DELETED', false],
    ['xDELETEx', false],
    ['DE LETE', false],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} -> ${expected}`, () => {
      expect(isDeleteConfirmed(input)).toBe(expected);
    });
  }
});

// ── Fake DOM elements (no jsdom — pure event dispatch) ───────────────────────
function makeFakeEl() {
  const handlers: Record<string, Array<() => unknown>> = {};
  return {
    value: '',
    disabled: false,
    addEventListener(type: string, cb: () => unknown) {
      (handlers[type] ??= []).push(cb);
    },
    async dispatch(type: string) {
      for (const cb of handlers[type] ?? []) await cb();
    },
  };
}

function setup(opts?: { confirm?: boolean; rpcError?: string | null; initialValue?: string }) {
  const input = makeFakeEl();
  input.value = opts?.initialValue ?? '';
  const button = makeFakeEl();
  const rpc = vi.fn(async () => ({ error: opts?.rpcError ? { message: opts.rpcError } : null }));
  const signOut = vi.fn(async () => {});
  const redirect = vi.fn((_: string) => {});
  const confirmFn = vi.fn(() => opts?.confirm ?? true);
  const onError = vi.fn((_: string) => {});
  wireDeleteAccount({ input, button, confirmFn, rpc, signOut, redirect, onError });
  return { input, button, rpc, signOut, redirect, confirmFn, onError };
}

describe('wireDeleteAccount', () => {
  it('disables the button on init when input is empty', () => {
    const { button } = setup();
    expect(button.disabled).toBe(true);
  });

  it('enables the button on init when input already equals DELETE', () => {
    const { button } = setup({ initialValue: 'DELETE' });
    expect(button.disabled).toBe(false);
  });

  it('toggles disabled as the user types', async () => {
    const { input, button } = setup();
    input.value = 'DELETE';
    await input.dispatch('input');
    expect(button.disabled).toBe(false);
    input.value = 'DELE';
    await input.dispatch('input');
    expect(button.disabled).toBe(true);
  });

  it('does NOT call the RPC when the typed token is wrong', async () => {
    const { input, button, rpc, signOut, redirect } = setup();
    input.value = 'delete';
    await input.dispatch('input');
    await button.dispatch('click');
    expect(rpc).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('deletes then signs out + redirects when DELETE typed and confirm accepted', async () => {
    const { input, button, rpc, signOut, redirect } = setup({ confirm: true });
    input.value = 'DELETE';
    await input.dispatch('input');
    await button.dispatch('click');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith('/');
  });

  it('does NOT call the RPC when the confirm dialog is dismissed', async () => {
    const { input, button, rpc, signOut } = setup({ confirm: false });
    input.value = 'DELETE';
    await input.dispatch('input');
    await button.dispatch('click');
    expect(rpc).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('surfaces an RPC error without signing out or redirecting', async () => {
    const { input, button, rpc, signOut, redirect, onError } = setup({ rpcError: 'boom' });
    input.value = 'DELETE';
    await input.dispatch('input');
    await button.dispatch('click');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('boom');
    expect(signOut).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  // Honest residual (OT-SEC-7b): the gate stops accidental deletion, NOT a
  // same-origin XSS, which can set input.value + monkey-patch confirm + click.
  // This test documents — not endorses — that capability.
  it('documents confirm-bypass: scripted input+confirm still deletes (XSS residual)', async () => {
    const { input, button, rpc } = setup({ confirm: true });
    input.value = 'DELETE'; // an attacker script could do exactly this
    await button.dispatch('click'); // without ever dispatching a real user 'input'
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
