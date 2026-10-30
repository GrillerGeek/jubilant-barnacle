import gulp from 'gulp';
import path from 'node:path';
import { Transform } from 'node:stream';
import sharp from 'sharp';
import { optimize } from 'svgo';

sharp.concurrency(2);

function animatedPng(bytes) {
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (offset + length + 12 > bytes.length) break;
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'acTL') return true;
    offset += length + 12;
  }
  return false;
}

async function optimizeImage(file) {
  const original = file.contents;
  const extension = path.extname(file.path).toLowerCase();
  let candidate;
  if (extension === '.svg') {
    const source = original.toString('utf8');
    // Preserve dynamic/animated SVGs without interpreting their behavior.
    if (/<\?xml-stylesheet\b|<(?:\w+:)?(?:animate\w*|set|script|style|foreignObject)\b|\bon[\w-]+\s*=|(?:animation|transition)\s*:|(?:xlink:)?href\s*=\s*["'](?!#)/i.test(source)) return original;
    candidate = Buffer.from(optimize(source, { plugins: ['removeComments', 'removeMetadata'] }).data);
  } else if (['.jpg', '.jpeg', '.png'].includes(extension)) {
    // Sharp does not expose every APNG frame through metadata; detect its control chunk first.
    if (extension === '.png' && animatedPng(original)) return original;
    if (extension !== '.png' && original.includes(Buffer.from('MPF\0'))) return original;
    const metadata = await sharp(original, { animated: true }).metadata();
    const expected = extension === '.png' ? 'png' : 'jpeg';
    if (metadata.format !== expected || (metadata.pages || 1) > 1 || metadata.depth !== 'uchar' || metadata.space !== 'srgb') return original;
    const image = sharp(original).keepMetadata();
    candidate = extension === '.png'
      ? await image.png({ palette: false, compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
      : await image.jpeg({ quality: 95, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer();
    if (candidate.length >= original.length) return original;
    const after = await sharp(candidate).metadata();
    if (after.width !== metadata.width || after.height !== metadata.height || (after.orientation || 1) !== (metadata.orientation || 1)) return original;
    if (extension === '.png') {
      const beforePixels = await sharp(original).raw().toBuffer({ resolveWithObject: true });
      const afterPixels = await sharp(candidate).raw().toBuffer({ resolveWithObject: true });
      if (beforePixels.info.channels !== afterPixels.info.channels || !beforePixels.data.equals(afterPixels.data)) return original;
    }
  } else {
    // GIF, WebP, multipage formats and unknown files are byte-preserving passthroughs.
    return original;
  }
  return candidate.length < original.length ? candidate : original;
}

export default () => gulp.src('./raw_images/*', { encoding: false })
  .pipe(new Transform({
    objectMode: true,
    transform(file, encoding, callback) {
      if (file.isNull()) return callback(null, file);
      if (!file.isBuffer()) return callback(new Error('Image task requires buffered input'));
      optimizeImage(file).then(contents => { file.contents = contents; callback(null, file); }, callback);
    },
  }))
  .pipe(gulp.dest('./public/images'));
