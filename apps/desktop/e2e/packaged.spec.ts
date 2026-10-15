import { accessSync, constants, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

/**
 * App empaquetée par `build:dir` (C2, C3) : même entrée que l'app installée, lancée sans `gh` dans
 * le `PATH` (H6) ; l'écran `blocked` prouve que main, preload et renderer se chargent depuis l'asar.
 */

const APP = join(import.meta.dirname, '..', 'dist', 'mac-arm64', 'Software Factory.app');
const LOAD_ERRORS = /Cannot find module|skills\/ introuvable|ERR_FILE_NOT_FOUND|Failed to load/;

test('le binaire claude du SDK est hors de l’asar et exécutable (C3)', () => {
  const claude = join(
    APP,
    'Contents/Resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude',
  );
  expect(() => {
    accessSync(claude, constants.X_OK);
  }).not.toThrow();
});

test('skills/ est là où defaultSkillsDir() le trouve en remontant depuis app.asar/out/main (H4)', () => {
  expect(existsSync(join(APP, 'Contents/Resources/skills/framing/SKILL.md'))).toBe(true);
  expect(existsSync(join(APP, 'Contents/Resources/skills/implementation/SKILL.md'))).toBe(true);
});

test('l’app empaquetée affiche l’écran blocked sans erreur de chargement (C2)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'factory-packaged-'));
  const app = await electron.launch({
    executablePath: join(APP, 'Contents/MacOS/Software Factory'),
    env: { PATH: '/usr/bin:/bin', FACTORY_INHERIT_PATH: '1', FACTORY_HOME: home, HOME: home },
  });
  const errors: string[] = [];
  app.process().stderr?.on('data', (chunk: Buffer) => {
    errors.push(chunk.toString());
  });
  try {
    const page = await app.firstWindow();
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });
    await expect(page.getByRole('heading', { name: 'Prérequis manquant' })).toBeVisible();
    expect(errors.join('\n')).not.toMatch(LOAD_ERRORS);
    // Même remontée que `defaultSkillsDir()`, depuis le chunk bundlé, avec le `fs` de l'asar (H4).
    const skills = await app.evaluate(() => {
      const fs = process.getBuiltinModule('node:fs');
      const path = process.getBuiltinModule('node:path');
      let dir = path.join(process.resourcesPath, 'app.asar', 'out', 'main', 'chunks');
      for (;;) {
        const candidate = path.join(dir, 'skills');
        if (fs.existsSync(path.join(candidate, 'framing', 'SKILL.md'))) return candidate;
        const parent = path.resolve(dir, '..');
        if (parent === dir) return undefined;
        dir = parent;
      }
    });
    expect(skills).toMatch(/Contents\/Resources\/skills$/);
  } finally {
    await app.close();
    rmSync(home, { recursive: true, force: true });
  }
});
