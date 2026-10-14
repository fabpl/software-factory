import { describe, expect, it, vi } from 'vitest';
import { createLifecycle } from '../src/main/lifecycle';

function setup(stop: () => Promise<void> = () => Promise.resolve()) {
  const calls: string[] = [];
  const ports = {
    stop: vi.fn(async () => {
      calls.push('stop');
      await stop();
    }),
    app: {
      quit: vi.fn(() => {
        calls.push('quit');
      }),
    },
  };
  const lifecycle = createLifecycle(ports);
  const closeEvent = () => ({ preventDefault: vi.fn() });
  const window = { hide: vi.fn() };
  return { ports, calls, lifecycle, closeEvent, window };
}

describe('quit (H9, C3)', () => {
  it('appelle stop() puis app.quit()', async () => {
    const { lifecycle, calls } = setup();
    await lifecycle.quit();
    expect(calls).toEqual(['stop', 'quit']);
  });

  it('appelle app.quit() même quand stop() rejette', async () => {
    const failure = new Error('annulation impossible');
    const { lifecycle, calls } = setup(() => Promise.reject(failure));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await lifecycle.quit();
    expect(calls).toEqual(['stop', 'quit']);
    expect(error).toHaveBeenCalledWith(failure);
    error.mockRestore();
  });

  it('un second appel pendant l’arrêt n’arrête pas deux fois', async () => {
    const { lifecycle, ports } = setup();
    await Promise.all([lifecycle.quit(), lifecycle.quit()]);
    expect(ports.stop).toHaveBeenCalledTimes(1);
    expect(ports.app.quit).toHaveBeenCalledTimes(1);
  });
});

describe('fermeture de la fenêtre (H9, C3)', () => {
  it('masque la fenêtre tant que l’app ne quitte pas', () => {
    const { lifecycle, closeEvent, window } = setup();
    const event = closeEvent();
    lifecycle.onClose(event, window);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(window.hide).toHaveBeenCalled();
  });

  it('laisse fermer une fois quitting levé', () => {
    const { lifecycle, closeEvent, window } = setup();
    void lifecycle.quit();
    expect(lifecycle.quitting()).toBe(true);
    const event = closeEvent();
    lifecycle.onClose(event, window);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(window.hide).not.toHaveBeenCalled();
  });
});

describe('before-quit (H9)', () => {
  it('retient la sortie et passe par quit() tant que l’arrêt n’est pas fait', async () => {
    const { lifecycle, calls, closeEvent } = setup();
    const first = closeEvent();
    lifecycle.onBeforeQuit(first);
    expect(first.preventDefault).toHaveBeenCalled();
    await lifecycle.quit();
    expect(calls).toEqual(['stop', 'quit']);
    const second = closeEvent();
    lifecycle.onBeforeQuit(second);
    expect(second.preventDefault).not.toHaveBeenCalled();
  });
});
