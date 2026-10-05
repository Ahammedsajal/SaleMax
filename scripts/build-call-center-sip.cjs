'use strict';

const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'client/public/call-center/sip-runtime.js');
const licenseOutput = path.join(root, 'client/public/call-center/SIPJS-LICENSE.md');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules/sip.js/LICENSE.md'), licenseOutput);
esbuild.buildSync({
  entryPoints: [path.join(root, 'client/src/call-center-sip.js')],
  outfile: output,
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'SaleMaXSip',
  target: ['es2020'],
  legalComments: 'none',
});
console.log(JSON.stringify({ output: path.relative(root, output), license: path.relative(root, licenseOutput), library: 'sip.js@0.21.2' }));
