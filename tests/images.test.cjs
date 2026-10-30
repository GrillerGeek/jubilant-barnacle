const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { crc32 } = require('node:zlib');
const sharp = require('sharp');
const { repo, withFixture, publicHashes } = require('./helpers.cjs');
const exec = promisify(execFile);
sharp.concurrency(2);

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
}
function pngChunks(bytes) {
  const result = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    result.push({ type: bytes.toString('ascii', offset + 4, offset + 8), data: bytes.subarray(offset + 8, offset + 8 + size) });
    offset += size + 12;
  }
  return result;
}
async function animatedPng(width, height) {
  const frames = await Promise.all(['red', 'blue'].map(background => sharp({ create: { width, height, channels: 4, background } }).png().toBuffer()));
  const control = Buffer.alloc(8);
  control.writeUInt32BE(2, 0);
  control.writeUInt32BE(3, 4);
  const frameControl = sequence => {
    const data = Buffer.alloc(26);
    data.writeUInt32BE(sequence, 0);
    data.writeUInt32BE(width, 4);
    data.writeUInt32BE(height, 8);
    data.writeUInt16BE(1, 20);
    data.writeUInt16BE(10, 22);
    return pngChunk('fcTL', data);
  };
  const first = pngChunks(frames[0]);
  const sequence = Buffer.alloc(4);
  sequence.writeUInt32BE(2);
  return Buffer.concat([
    frames[0].subarray(0, 8), pngChunk('IHDR', first.find(chunk => chunk.type === 'IHDR').data),
    pngChunk('acTL', control), frameControl(0),
    ...first.filter(chunk => chunk.type === 'IDAT').map(chunk => pngChunk('IDAT', chunk.data)),
    frameControl(1), pngChunk('fdAT', Buffer.concat([sequence, ...pngChunks(frames[1]).filter(chunk => chunk.type === 'IDAT').map(chunk => chunk.data)])),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

test('real task preserves fidelity, alpha, orientation, animation, geometry and existing assets', async () => {
  const publishedBefore = await publicHashes();
  await withFixture(async dir => {
    const input = path.join(dir, 'raw_images');
    const output = path.join(dir, 'public', 'images');
    await fs.mkdir(input);
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, 'existing.txt'), 'Existing published fixture');
    const width = 128;
    const height = 96;
    const rgba = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      rgba[offset] = x * 2; rgba[offset + 1] = y * 2;
      rgba[offset + 2] = (x + y) % 256; rgba[offset + 3] = (x + y) % 256;
    }
    const jpeg = await sharp(rgba, { raw: { width, height, channels: 4 } }).removeAlpha().jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).withMetadata({ orientation: 6 }).toBuffer();
    const png = await sharp(rgba, { raw: { width, height, channels: 4 } }).png({ palette: false, compressionLevel: 0 }).toBuffer();
    const frameWidth = 8;
    const frameHeight = 6;
    const frames = Buffer.concat([Buffer.alloc(frameWidth * frameHeight * 4, 255), Buffer.from(Array.from({ length: frameWidth * frameHeight * 4 }, (_, index) => index % 4 === 3 ? 128 : index % 256))]);
    const sequence = () => sharp(frames, { raw: { width: frameWidth, height: frameHeight * 2, channels: 4, pageHeight: frameHeight } });
    const gif = await sequence().gif({ loop: 3, delay: [80, 150], keepDuplicateFrames: true, dither: 0 }).toBuffer();
    const webp = await sequence().webp({ lossless: true, loop: 2, delay: [90, 160], effort: 2 }).toBuffer();
    const tiff = await sequence().tiff({ compression: 'lzw' }).toBuffer();
    const apng = await animatedPng(frameWidth, frameHeight);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12" viewBox="0.125 0.25 16.125 12.25"><metadata>' + 'Synthetic metadata '.repeat(30) + '</metadata><rect x="0.125" y="0.25" width="16" height="12" fill="#bc285e"/></svg>');
    const originals = {
      'oriented.JPEG': jpeg, 'alpha.PNG': png, 'geometry.SVG': svg,
      'animation.GIF': gif, 'animation.WEBP': webp, 'multipage.TIFF': tiff, 'animation.PNG': apng,
      'still.gif': await sharp(png).gif().toBuffer(),
      'unknown.bin': Buffer.from([0, 255, 192, 128, 10, 77]),
      'small.svg': Buffer.from('<svg width="1" height="1"/>'),
      'animated.svg': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><rect width="4" height="4"><animate attributeName="x" values="0;8" dur="1s" repeatCount="indefinite"/></rect></svg>'),
      'event.svg': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12" onload="this.setAttribute(\'fill\',\'red\')"><rect width="4" height="4"/></svg>'),
      'mpf-marker.jpg': Buffer.concat([jpeg.subarray(0, 2), Buffer.from([255, 226, 0, 6, 77, 80, 70, 0]), jpeg.subarray(2)]),
      'namespaced.svg': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" xmlns:motion-guide="http://www.w3.org/2000/svg" width="16" height="12"><!-- removable guard regression --><metadata>Synthetic namespace fixture</metadata><rect width="4" height="4"><motion-guide:animate attributeName="x" values="0;8" dur="1s"/></rect></svg>'),
      'doctype.svg': Buffer.from('<!DOCTYPE svg><!-- removable guard regression --><svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><rect width="4" height="4"/></svg>'),
    };
    for (const [name, bytes] of Object.entries(originals)) await fs.writeFile(path.join(input, name), bytes);
    const gifBefore = await sharp(gif, { animated: true }).metadata();
    assert.equal(gifBefore.pages, 2);
    assert.deepEqual(gifBefore.delay, [80, 150]);
    assert.equal(gifBefore.loop, 3);
    assert.equal((await sharp(webp, { animated: true }).metadata()).pages, 2);
    assert.equal((await sharp(tiff, { animated: true }).metadata()).pages, 2);
    assert.equal(pngChunks(apng).find(chunk => chunk.type === 'acTL').data.readUInt32BE(0), 2);
    const { stdout, stderr } = await exec(process.execPath, [require.resolve('gulp-cli/bin/gulp.js'), '--gulpfile', path.join(repo, 'gulpfile.mjs'), '--cwd', dir], { cwd: dir, timeout: 30000, env: { ...process.env, UV_THREADPOOL_SIZE: '2' } });
    assert.doesNotMatch(stdout + stderr, /error/i);
    for (const [name, original] of Object.entries(originals)) {
      assert.deepEqual(await fs.readFile(path.join(input, name)), original, name + ' input changed');
      assert((await fs.stat(path.join(output, name))).size <= original.length, name + ' became larger');
    }
    const jpegAfter = await fs.readFile(path.join(output, 'oriented.JPEG'));
    assert(jpegAfter.length < jpeg.length, 'JPEG fixture must exercise re-encoding');
    assert.equal((await sharp(jpegAfter).metadata()).orientation, 6);
    const display = bytes => sharp(bytes).autoOrient().raw().toBuffer({ resolveWithObject: true });
    const beforeDisplay = await display(jpeg);
    const afterDisplay = await display(jpegAfter);
    assert.equal(afterDisplay.info.width, beforeDisplay.info.width);
    assert.equal(afterDisplay.info.height, beforeDisplay.info.height);
    assert.equal(afterDisplay.info.width, height);
    assert.equal(afterDisplay.info.height, width);
    let absolute = 0;
    let squared = 0;
    for (let index = 0; index < beforeDisplay.data.length; index++) {
      const error = beforeDisplay.data[index] - afterDisplay.data[index];
      absolute += Math.abs(error); squared += error * error;
    }
    const meanError = absolute / beforeDisplay.data.length;
    const psnr = 10 * Math.log10(255 * 255 / (squared / beforeDisplay.data.length));
    assert(meanError < 2.5, 'JPEG mean absolute display error');
    assert(psnr >= 36, 'JPEG displayed PSNR');
    const pngAfter = await fs.readFile(path.join(output, 'alpha.PNG'));
    assert(pngAfter.length < png.length, 'PNG fixture must exercise lossless encoding');
    const pngMeta = await sharp(pngAfter).metadata();
    assert.equal(pngMeta.hasAlpha, true);
    assert.equal(pngMeta.isPalette, false);
    assert.deepEqual(await sharp(pngAfter).raw().toBuffer(), await sharp(png).raw().toBuffer(), 'RGBA pixels/alpha changed');
    const svgAfter = await fs.readFile(path.join(output, 'geometry.SVG'));
    assert(svgAfter.length < svg.length);
    assert.match(svgAfter.toString(), /width="16"/);
    assert.match(svgAfter.toString(), /height="12"/);
    assert.match(svgAfter.toString(), /viewBox="0.125 0.25 16.125 12.25"/);
    assert.deepEqual(await sharp(svgAfter).raw().toBuffer(), await sharp(svg).raw().toBuffer(), 'SVG geometry/pixels changed');
    for (const name of ['animation.GIF', 'animation.WEBP', 'multipage.TIFF', 'animation.PNG', 'still.gif', 'unknown.bin', 'small.svg', 'animated.svg', 'event.svg', 'mpf-marker.jpg', 'namespaced.svg', 'doctype.svg']) {
      assert.deepEqual(await fs.readFile(path.join(output, name)), originals[name], name + ' passthrough changed');
    }
    const gifAfter = await sharp(await fs.readFile(path.join(output, 'animation.GIF')), { animated: true }).metadata();
    assert.deepEqual({ pages: gifAfter.pages, delay: gifAfter.delay, loop: gifAfter.loop }, { pages: 2, delay: [80, 150], loop: 3 });
    assert.equal(await fs.readFile(path.join(output, 'existing.txt'), 'utf8'), 'Existing published fixture');
    console.log(JSON.stringify({ imageFixtures: Object.keys(originals).length, jpeg: { originalBytes: jpeg.length, outputBytes: jpegAfter.length, displayedWidth: afterDisplay.info.width, displayedHeight: afterDisplay.info.height, orientation: 6, meanError, psnr }, png: { originalBytes: png.length, outputBytes: pngAfter.length, exactRgba: true }, gif: { pages: gifAfter.pages, delay: gifAfter.delay, loop: gifAfter.loop }, svgPixelsUnchanged: true, inputsUnchanged: true }));
  });
  assert.deepEqual(await publicHashes(), publishedBefore, 'Repository published assets changed');
});
