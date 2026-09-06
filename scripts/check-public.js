const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const required = [
  'README.md', 'README.zh-CN.md', 'LICENSE', 'NOTICE.md', 'PRIVACY.md',
  'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md', '.github/workflows/ci.yml'
];

for (const name of required) {
  assert.ok(fs.statSync(path.join(root, name)).isFile(), `missing public file: ${name}`);
}

const gitState = cp.spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
  cwd: root, encoding: 'utf8'
});
const files = gitState.status === 0
  ? cp.execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  : required;

const sensitive = [
  /\/Users\/[^/\s]+/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:sk|sd)_[A-Za-z0-9_-]{16,}/,
  /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/,
  /\bAKLT[A-Z0-9]{16,}/
];

for (const name of files) {
  const full = path.join(root, name);
  if (!fs.statSync(full).isFile() || fs.statSync(full).size > 2_000_000) continue;
  const source = fs.readFileSync(full, 'utf8');
  for (const pattern of sensitive) assert.ok(!pattern.test(source), `possible private data: ${name}`);
}

const license = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
assert.match(license, /Copyright \(c\) 2026 Zara Zhang/);
assert.match(fs.readFileSync(path.join(root, 'NOTICE.md'), 'utf8'), /youtube-digest/);
process.stdout.write(`Public-source check passed: ${files.length} tracked files.\n`);
