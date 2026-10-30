# Dependency security refresh — 2026-10-30

The original lockfile reports 82 full and **29 production** affected-package
entries, including three critical production entries. An earlier triage count
of 38 production entries was incorrect. The supported refresh uses Express
4.22.3, EJS 3.1.10 and Nodemon 3.1.14. Nodemon remains a production dependency.
The application remains CommonJS and retains its existing rendering/routes.

The baseline locks gulp-imagemin 7.1.0 and imagemin-mozjpeg 8.0.0. Its default
JPEG plugin was MozJPEG with no explicit quality argument, so the original
task already re-encoded JPEGs. The replacement documents an explicit quality
policy rather than claiming lossless jpegtran behavior or identical encoding.

## Image build policy

The Gulp 5 task retains `raw_images/*` and `public/images`, with binary input
explicitly selected using `encoding: false`. Sharp 0.35.5 and SVGO 4.1.0 replace
the legacy imagemin transform and its vulnerable optional optimizer/download
chain. There are no package overrides or omitted optional dependencies.

- Static 8-bit sRGB JPEG uses quality 95, 4:4:4 chroma and MozJPEG coding.
  This is conservative **lossy re-encoding**, not lossless equivalence. Metadata
  and EXIF orientation are retained, preserving displayed orientation.
- PNG uses lossless compression with palette reduction disabled. Dimensions,
  orientation, channel count and decoded pixel/alpha bytes must match before
  accepting a smaller candidate. Other colour/depth representations pass through.
- Static SVG optimization only removes comments and metadata. Dimensions,
  viewBox and numeric geometry are preserved. Dynamic/animated SVG passes through.
- GIF, WebP, APNG, multipage formats, JPEG multi-picture markers and unsupported
  inputs preserve their original bytes. Static GIF also passes through; no
  palette/transparency conversion is attempted.
- The original bytes are retained whenever a candidate is equal or larger.

This is a conservative build policy. It does not regenerate any existing
published image during installation, testing or application startup.

## Validation

Normal original npm 10 clean installation and ordinary serial refresh are
followed by the complete installed graph and canonical-identity full/production
advisory checks. The removed downloader/extractor packages must be absent.

The actual CommonJS Express/EJS app runs against copied code, synthetic haikus
and an ephemeral loopback listener. The Nodemon fixture must start, restart
after a file edit, stop its old child and leave no child after shutdown.
Child environments disable update notifications and carry no provider secrets.

The real Gulp task runs in a disposable image tree. The fixtures verify:

- JPEG encoding is exercised, EXIF orientation and displayed dimensions remain,
  representative displayed PSNR is at least 36 dB and mean absolute error is
  below 2.5 on the 0–255 channel scale. These measurements are fixture acceptance
  criteria, not a universal fidelity guarantee for every possible image.
- PNG encoding is exercised with exact decoded RGBA/alpha and no palette.
- SVG retains exact dimensions/viewBox and identical rendered pixels.
- Two-frame GIF retains frames, delays and loop count; animated WebP/APNG,
  multipage TIFF, static GIF, animated SVG and unsupported bytes pass unchanged.
- Uppercase extensions work, output never grows, inputs and existing destination
  files remain unchanged, and all repository published asset hashes match.

Tests use one worker and at most two Sharp threads. Cleanup validates the exact
generated temporary directory before recursive removal. Read-only Linux CI runs
clean installation, these fixtures and both full and production audits.

The repository's current deployment target and live source commit remain
unverified. Source validation does not establish a production rollout.

Sources: [Gulp 5 changes](https://github.com/gulpjs/gulp/blob/master/CHANGELOG.md),
[Sharp constructor](https://sharp.pixelplumbing.com/api-constructor/),
[Sharp output/metadata](https://sharp.pixelplumbing.com/api-output/),
[SVGO usage](https://svgo.dev/docs/usage/).
Original defaults: [gulp-imagemin 7.1.0 source](https://github.com/sindresorhus/gulp-imagemin/blob/v7.1.0/index.js)
and exact official npm source for imagemin-mozjpeg 8.0.0.
