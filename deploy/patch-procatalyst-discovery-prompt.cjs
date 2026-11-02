'use strict';

const fs = require('node:fs');

const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath) {
  console.error('Usage: node patch-procatalyst-discovery-prompt.cjs <live-source> <output>');
  process.exit(2);
}

const source = fs.readFileSync(sourcePath, 'utf8');
const lines = source.split(/\r?\n/);
const matches = lines
  .map((line, index) => ({ line, index }))
  .filter(({ line }) => line.includes('const legacyNumericPrompt ='));

if (matches.length !== 1) throw new Error('EXPECTED_ONE_DISCOVERY_PROMPT_GUARD');
const { line, index } = matches[0];
if (line.endsWith("/u.test(configured || '');")) {
  lines[index] = line.replace(/\/u\.test\(configured \|\| ''\);$/, "/iu.test(configured || '');");
} else if (!line.endsWith("/iu.test(configured || '');")) {
  throw new Error('UNEXPECTED_DISCOVERY_PROMPT_GUARD');
}

fs.writeFileSync(outputPath, lines.join('\n'), { mode: 0o644 });
