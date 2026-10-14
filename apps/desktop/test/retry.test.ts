import type { InboxState } from '@factory/orchestrator';
import { describe, expect, it, vi } from 'vitest';
import { registerIpc } from '../src/main/ipc';
import { createRuntime } from '../src/main/runtime';
import { channel } from '../src/shared/api';
import { BLOCKED_STATE, fakeIpcMain, fakeOrchestrator, inboxState } from './fakes';

describe('retry (H8, C7)', () => {
  it('rappelle bootstrap(), arrête l’ancien, remplace et publie le nouvel état au renderer', async () => {
    const blocked = fakeOrchestrator(BLOCKED_STATE);
    const ready = fakeOrchestrator(inboxState());
    const bootstrap = vi
      .fn<() => Promise<typeof blocked>>()
      .mockResolvedValueOnce(blocked)
      .mockResolvedValueOnce(ready);
    const runtime = await createRuntime({ bootstrap, home: '/tmp/maison', repo: 'acme/widget' });
    const ipcMain = fakeIpcMain();
    const send = vi.fn<(state: InboxState) => void>();
    registerIpc({ ipcMain, runtime, send });
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'blocked' }));

    const retry = ipcMain.handlers.get(channel('retry'));
    if (!retry) throw new Error('aucun handler retry');
    await retry({});

    expect(bootstrap).toHaveBeenCalledTimes(2);
    expect(bootstrap).toHaveBeenLastCalledWith({ userData: '/tmp/maison', repo: 'acme/widget' });
    expect(blocked.stop).toHaveBeenCalledTimes(1);
    expect(runtime.current()).toBe(ready);
    expect(ready.start).toHaveBeenCalledTimes(1);
    const last = send.mock.calls.at(-1)?.[0];
    expect(last?.status).not.toBe('blocked');
    expect(last?.status).toBe('ready');
  });

  it('après retry, seules les publications du nouvel orchestrateur atteignent le renderer', async () => {
    const first = fakeOrchestrator(BLOCKED_STATE);
    const second = fakeOrchestrator(inboxState());
    const bootstrap = vi
      .fn<() => Promise<typeof first>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const runtime = await createRuntime({ bootstrap, home: '/tmp/maison' });
    const states: InboxState[] = [];
    runtime.subscribe((s) => states.push(s));
    await runtime.retry();
    const before = states.length;
    first.publish(inboxState({ errors: ['fantôme'] }));
    expect(states.length).toBe(before);
    second.publish(inboxState({ errors: ['réel'] }));
    expect(states.at(-1)?.errors).toEqual(['réel']);
    expect(first.listeners.size).toBe(0);
  });

  it('stop() arrête l’orchestrateur courant et se désabonne', async () => {
    const orchestrator = fakeOrchestrator();
    const runtime = await createRuntime({
      bootstrap: () => Promise.resolve(orchestrator),
      home: '/tmp/maison',
    });
    const listener = vi.fn();
    const unsubscribe = runtime.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    orchestrator.publish(inboxState({ errors: ['après désabonnement'] }));
    expect(listener).toHaveBeenCalledTimes(1);
    await runtime.stop();
    expect(orchestrator.stop).toHaveBeenCalledTimes(1);
  });
});
