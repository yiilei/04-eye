import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const appRoot = process.env.CAIGUANG_PACKAGE_APP;
test('extracted package starts with fresh and existing user data', { skip: !appRoot }, async () => {
  const { startDesktopServer } = await import(pathToFileURL(path.join(appRoot, 'desktop/server.mjs')));
  const version = JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8')).version;
  assert.equal(version, JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version);
  const root = await mkdtemp(path.join(os.tmpdir(), 'caiguang-package-smoke-'));
  try {
    for (const mode of ['fresh', 'upgrade']) {
      const dataRoot = path.join(root, mode);
      if (mode === 'upgrade') {
        await mkdir(path.join(dataRoot, 'data'), { recursive: true });
        await mkdir(path.join(dataRoot, 'review', 'existing'), { recursive: true });
        const localPath = path.join(dataRoot, 'review', 'existing', 'a.jpg');
        await writeFile(localPath, 'existing-media');
        await writeFile(path.join(dataRoot, 'data', 'generated-review-items.json'), JSON.stringify([{ id: 'existing', localPath }]));
        await writeFile(path.join(dataRoot, 'data', '.starter-data-v1.json'), '{}');
        await writeFile(path.join(dataRoot, 'data', 'review-ui-state.json'), JSON.stringify({ initialized: true,
          savedSingles: { 'existing:a.jpg': 'eagle-existing' }, removedSingles: { existing: ['b.jpg'] }, dismissedIds: ['hidden'] }));
      }
      const server = await startDesktopServer(appRoot, dataRoot);
      try {
        const response = await fetch(new URL('/api/desktop/review-items', server.url));
        assert.equal(response.status, 200);
        const library = await response.json();
        assert.equal(library.reviewState.status, 'ready');
        if (mode === 'fresh') assert.equal(library.items.length, 1);
        else {
          assert.deepEqual(library.items.map(item => item.id), ['existing']);
          const state = await fetch(new URL('/api/desktop/review-ui-state', server.url)).then(r => r.json());
          assert.equal(state.state.savedSingles['existing:a.jpg'], 'eagle-existing');
          assert.deepEqual(state.state.removedSingles.existing, ['b.jpg']);
          assert.deepEqual(state.state.dismissedIds, ['hidden']);
          assert.equal(await readFile(path.join(dataRoot, 'review/existing/a.jpg'), 'utf8'), 'existing-media');
        }
      } finally { server.close(); }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
