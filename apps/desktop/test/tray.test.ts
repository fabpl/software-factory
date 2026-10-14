import { describe, expect, it, vi } from 'vitest';
import { BLOCKED } from '../src/renderer/fixtures/blocked';
import { EMPTY } from '../src/renderer/fixtures/empty';
import { LOADED } from '../src/renderer/fixtures/loaded';
import { createRuntime } from '../src/main/runtime';
import {
  badgeCount,
  badgeText,
  startBadge,
  TRAY_ICON,
  trayIcon,
  type IconImage,
} from '../src/main/tray';
import { fakeOrchestrator } from './fakes';

describe('badge (H8, C1)', () => {
  it('fixture empty : 0, titre vide', () => {
    expect(badgeCount(EMPTY)).toBe(0);
    expect(badgeText(EMPTY)).toBe('');
  });

  it('fixture loaded : arbitrate + validate + act', () => {
    const n = LOADED.arbitrate.length + LOADED.validate.length + LOADED.act.length;
    expect(n).toBe(6);
    expect(badgeCount(LOADED)).toBe(n);
    expect(badgeText(LOADED)).toBe('6');
  });

  it('fixture blocked : titre vide, même avec des cartes', () => {
    expect(badgeText(BLOCKED)).toBe('');
    expect(badgeText({ ...BLOCKED, act: LOADED.act })).toBe('');
  });

  it('startBadge pose le titre à chaque état publié, y compris après retry()', async () => {
    const first = fakeOrchestrator(EMPTY);
    const second = fakeOrchestrator(LOADED);
    const boot = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const runtime = await createRuntime({ bootstrap: boot, home: '/tmp/maison' });
    const setBadge = vi.fn<(text: string) => void>();
    startBadge({ runtime, setBadge });
    expect(setBadge).toHaveBeenLastCalledWith('');
    first.publish(LOADED);
    expect(setBadge).toHaveBeenLastCalledWith('6');
    await runtime.retry();
    second.publish(BLOCKED);
    expect(setBadge).toHaveBeenLastCalledWith('');
  });
});

describe('icône (H8)', () => {
  it('image template, 16 px et @2x embarquées en data URL PNG', () => {
    expect(TRAY_ICON.x1).toMatch(/^data:image\/png;base64,/);
    expect(TRAY_ICON.x2).toMatch(/^data:image\/png;base64,/);
    const size = (url: string): [number, number] => {
      const png = Buffer.from(url.split(',')[1] ?? '', 'base64');
      return [png.readUInt32BE(16), png.readUInt32BE(20)];
    };
    expect(size(TRAY_ICON.x1)).toEqual([16, 16]);
    expect(size(TRAY_ICON.x2)).toEqual([32, 32]);
    const addRepresentation = vi.fn<IconImage['addRepresentation']>();
    const setTemplateImage = vi.fn<IconImage['setTemplateImage']>();
    const image: IconImage = { addRepresentation, setTemplateImage };
    const createFromDataURL = vi.fn(() => image);
    expect(trayIcon({ createFromDataURL })).toBe(image);
    expect(createFromDataURL).toHaveBeenCalledWith(TRAY_ICON.x1);
    expect(addRepresentation).toHaveBeenCalledWith({ scaleFactor: 2, dataURL: TRAY_ICON.x2 });
    expect(setTemplateImage).toHaveBeenCalledWith(true);
  });
});
