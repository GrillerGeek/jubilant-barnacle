const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
async function withFixture(run) {
  const parent = path.resolve(os.tmpdir());
  const dir = await fs.mkdtemp(path.join(parent, 'jubilant-security-'));
  try { return await run(dir); } finally {
    assert.equal(path.dirname(path.resolve(dir)), parent);
    assert(path.basename(dir).startsWith('jubilant-security-'));
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}
async function until(check, message, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(message);
}
async function boot(dir, source) {
  const file = path.join(dir, 'bootstrap.cjs');
  await fs.writeFile(file, source);
  const env = { NODE_PATH: path.join(repo, 'node_modules'), PORT: '0', UV_THREADPOOL_SIZE: '2', CI: '1', NO_UPDATE_NOTIFIER: '1' };
  for (const key of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  const child = fork(file, [], { cwd: dir, env, silent: true });
  child.messages = [];
  child.errors = '';
  child.on('message', value => child.messages.push(value));
  child.stderr.on('data', value => { child.errors += value; });
  return child;
}
async function stop(child) {
  if (child.exitCode !== null) return;
  child.send({ type: 'stop' });
  await until(() => child.exitCode !== null, 'Owned fixture process did not stop');
  assert.equal(child.exitCode, 0, child.errors);
}
async function publicHashes(dir = path.join(repo, 'public'), prefix = '') {
  const result = {};
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const name = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(result, await publicHashes(path.join(dir, entry.name), name));
    else result[name] = crypto.createHash('sha256').update(await fs.readFile(path.join(dir, entry.name))).digest('hex');
  }
  return result;
}
module.exports = { repo, withFixture, until, boot, stop, publicHashes };
