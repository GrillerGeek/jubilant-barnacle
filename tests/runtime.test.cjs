const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { repo, withFixture, until, boot, stop, publicHashes } = require('./helpers.cjs');

test('actual CommonJS Express/EJS app renders synthetic data and serves static files on loopback', async () => {
  const before = await publicHashes();
  await withFixture(async dir => {
    await fs.copyFile(path.join(repo, 'index.js'), path.join(dir, 'index.js'));
    await fs.cp(path.join(repo, 'views'), path.join(dir, 'views'), { recursive: true });
    await fs.mkdir(path.join(dir, 'public'));
    await fs.writeFile(path.join(dir, 'public', 'fixture.txt'), 'Synthetic static content');
    await fs.writeFile(path.join(dir, 'haikus.json'), JSON.stringify([{ image: 'fixture.svg', text: 'Synthetic <strong>haiku</strong>' }]));
    const child = await boot(dir, `
      const http = require('node:http');
      const listen = http.Server.prototype.listen;
      let ownedServer;
      http.Server.prototype.listen = function () {
        ownedServer = this;
        this.once('listening', () => process.send({ type: 'listening', address: this.address() }));
        return listen.call(this, { port: 0, host: '127.0.0.1' });
      };
      process.on('message', message => {
        if (message.type === 'stop') ownedServer.close(() => process.exit(0));
      });
      require('./index.js');
    `);
    try {
      const ready = await until(() => child.messages.find(item => item.type === 'listening'), 'Fixture app did not listen');
      assert.equal(ready.address.address, '127.0.0.1');
      const base = 'http://127.0.0.1:' + ready.address.port;
      const home = await fetch(base);
      assert.equal(home.status, 200);
      assert.match(home.headers.get('content-type'), /text\/html/);
      const html = await home.text();
      assert.match(html, /<title>Haikus for Mona<\/title>/);
      assert.match(html, /Synthetic <strong>haiku<\/strong>/);
      assert.match(html, /images\/fixture.svg/);
      const asset = await fetch(base + '/fixture.txt');
      assert.equal(asset.status, 200);
      assert.equal(await asset.text(), 'Synthetic static content');
      assert.equal((await fetch(base + '/missing-fixture')).status, 404);
    } finally { await stop(child); }
  });
  assert.deepEqual(await publicHashes(), before, 'Published assets changed');
});

test('actual Nodemon starts, restarts after a fixture edit, and stops its owned child', async () => {
  await withFixture(async dir => {
    const script = path.join(dir, 'fixture.cjs');
    const content = marker => `console.log(JSON.stringify({ marker: '${marker}', pid: process.pid })); setInterval(() => {}, 1000);`;
    await fs.writeFile(script, content('first'));
    const child = await boot(dir, `
      const nodemon = require(${JSON.stringify(require.resolve('nodemon'))});
      nodemon({ script: ${JSON.stringify(script)}, watch: [${JSON.stringify(script)}], ext: 'cjs', delay: 0.1, stdout: false, exec: process.execPath })
        .on('stdout', value => process.send({ type: 'output', text: String(value) }));
      process.on('message', message => {
        if (message.type === 'stop') {
          // Required-module mode emits exit after the monitored child has stopped.
          nodemon.once('exit', () => process.exit(0));
          nodemon.emit('quit');
        }
      });
    `);
    const marker = name => {
      const lines = child.messages.filter(item => item.type === 'output').map(item => item.text).join('').split(/\r?\n/);
      for (const line of lines) {
        try { const value = JSON.parse(line); if (value.marker === name) return value; } catch { /* nodemon text */ }
      }
      return null;
    };
    const isGone = pid => { try { process.kill(pid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; } };
    let second;
    try {
      const first = await until(() => marker('first'), 'Nodemon did not start fixture');
      await fs.writeFile(script, content('second'));
      second = await until(() => marker('second'), 'Nodemon did not restart after edit');
      assert.notEqual(first.pid, second.pid);
      await until(() => isGone(first.pid), 'Old owned fixture child survived restart');
    } finally { await stop(child); }
    await until(() => isGone(second.pid), 'Owned fixture child survived Nodemon stop');
  });
});
