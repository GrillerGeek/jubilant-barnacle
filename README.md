
# Haikus for Codespaces

This is a quick node project template for demoing Codespaces. It is based off of the [Azure node sample](https://github.com/Azure-Samples/nodejs-docs-hello-world). It's great!!!

Use patched Node 22.23.4 or Node 24.22.1 and install with `npm ci`.
The application remains CommonJS: `npm start` and `npm run dev` retain their
existing behavior. `npm run images` runs the ESM Gulp task from `raw_images/*`
to `public/images`; there are no tracked raw source images.

`npm test` checks the actual Express/EJS app with synthetic content on a
loopback-only fixture listener, Nodemon start/edit/restart/stop, and the actual
Gulp task with disposable JPEG/PNG/GIF/SVG files. It does not start the real
application with repository data or regenerate published images.
See [the security report](docs/dependency-security.md) for the conservative
image policy and the complete dependency/workflow validation requirements.
