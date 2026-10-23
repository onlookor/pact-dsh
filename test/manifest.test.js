import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8');

test('bundle patch names resolve to the published package', () => {
  assert.match(patch, new RegExp(`name: '${pkg.name}/loop'`));
  assert.match(patch, new RegExp(`name: '${pkg.name}'`));
  assert.doesNotMatch(patch, /@pact\/dsh-plugin/);
});

test('package metadata points at the bundle patch', () => {
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml');
  assert.ok(pkg.files.includes('cordis.patch.yml'));
});
