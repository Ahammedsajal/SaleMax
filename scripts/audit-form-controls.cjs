'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const roots = ['client/public', 'client/workspace-src'];
const ignored = new Set(['static', 'node_modules', 'build']);
const sourceExt = new Set(['.html', '.js', '.jsx', '.ts', '.tsx']);

function* walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.isDirectory() && ignored.has(item.name)) continue;
    const absolute = path.join(dir, item.name);
    if (item.isDirectory()) yield* walk(absolute);
    else if (sourceExt.has(path.extname(item.name).toLowerCase())) yield absolute;
  }
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match && (match[1] ?? match[2] ?? match[3]);
}

function esc(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ').replaceAll('`', '\\`');
}

const files = roots.flatMap(relative => [...walk(path.join(root, relative))]);
const records = [];
let totalForms = 0;
let totalControls = 0;
for (const absolute of files.sort()) {
  const source = fs.readFileSync(absolute, 'utf8');
  const relative = path.relative(root, absolute).replaceAll(path.sep, '/');
  const forms = [...source.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form\s*>/gi)];
  if (!forms.length && !/createElement\(['"](?:form|input|select|textarea)['"]\)/.test(source)) continue;
  const lineOf = offset => source.slice(0, offset).split('\n').length;
  const lines = [];
  for (const match of forms) {
    const opening = `<form ${match[1]}>`;
    const name = attr(opening, 'id') || attr(opening, 'data-form') || attr(opening, 'class') || 'unnamed form';
    const controls = [...match[2].matchAll(/<(input|select|textarea|button)\b[^>]*>/gi)].map(control => {
      const tag = control[0];
      const kind = control[1].toLowerCase();
      const identity = attr(tag, 'name') || attr(tag, 'id') || attr(tag, 'data-field') || attr(tag, 'aria-label') || attr(tag, 'placeholder') || 'unlabelled';
      return `${kind}:${identity}${kind === 'input' ? ` [${attr(tag, 'type') || 'text'}]` : ''}`;
    });
    totalForms += 1;
    totalControls += controls.length;
    lines.push(`  - Line ${lineOf(match.index)} · **${esc(name)}** · ${controls.length} control(s): ${controls.length ? controls.map(esc).join(', ') : 'none detected in static markup'}`);
  }
  const dynamic = [...source.matchAll(/createElement\(['"](form|input|select|textarea)['"]\)|\.name\s*=\s*['"]([^'"]+)['"]/g)].map(match => ({ line: lineOf(match.index), text: match[1] ? `createElement(${match[1]})` : `field name ${match[2]}` }));
  if (forms.length || dynamic.length) {
    records.push({ relative, lines, dynamic });
  }
}

const output = [
  '# Source-maintained form and control audit',
  '',
  `Generated ${new Date().toISOString().slice(0, 10)} by \`node scripts/audit-form-controls.cjs\`.`,
  '',
  `The scan covers maintained HTML/JavaScript/TypeScript under \`client/public\` and \`client/workspace-src\`, excluding the hash-bundled React assets. It found **${totalForms} static form templates** and **${totalControls} static controls**. Each listed field is identified by its \`name\`, \`id\`, data-field, accessible label or placeholder; controls created at runtime are listed separately by source line. Dynamic loops and generated catalogue options need runtime checks because static scans cannot count their rendered instances.`,
  '',
  '## File-by-file inventory',
  '',
  ...records.flatMap(record => [
    `### \`${record.relative}\``,
    '',
    ...(record.lines.length ? record.lines : ['  - No literal form template; controls are created at runtime.']),
    ...(record.dynamic.length ? ['', `  Runtime field builders: ${record.dynamic.map(item => `line ${item.line} ${item.text}`).join('; ')}.`] : []),
    '',
  ]),
  '## Review rules for dropdown conversion',
  '',
  '- Use dropdowns or searchable selects for finite, validated catalogues already owned by the business: course, batch, payment plan, lifecycle status, role, channel, and fixed decision/outcome values.',
  '- Keep names, phone numbers, email, addresses, references, free-form explanations and bilingual course copy editable. Offer input hints or safe saved values where useful; do not force an incomplete list.',
  '- Use date, time, number, checkbox and radio controls for their real data types. Replace comma-delimited list entry with individual controls only when the backend accepts an explicit bounded set.',
  '- For very long catalogues, use a searchable select backed by tenant-scoped APIs and preserve current form validation, permission checks, RTL labels and keyboard access.',
  '',
  '## Visual evidence and limits',
  '',
  'The supplied current-run screenshot documents the Finance invoice builder before its modal and alignment update. The source inventory is broad but does not prove the rendered appearance of every screen, role, viewport or language. The hash-bundled primary React application is intentionally excluded from source edits; shared styling can improve it, while field-by-field changes there require recoverable source or a supported build input.',
  '',
  '## Work completed in this audit increment',
  '',
  '- Finance invoice creation is presented as a centered, constrained modal with a dimmed backdrop, keyboard Escape close, initial focus, focus trapping, and focus return to the opener.',
  '- The lead/contact details stay hidden until a valid contact is selected; changing the search clears the previous contact identity so an old selection cannot silently be invoiced.',
  '- Manual customer entry stays available, and shared native form controls receive consistent sizing and visible keyboard focus.',
  '- Installment reminders use a guided offset picker spanning the server-approved range (-30 through +90 days), with removable selected-date chips and the server limit of eight dates; staff no longer type comma-separated values.',
  '- Scheduled report time zones are chosen from the complete browser IANA list, with Qatar and nearby Gulf locations at the top; the selected value is styled to match adjacent form controls.',
  '',
  'Remaining source forms should be reviewed page by page using this inventory; deploy and visual acceptance must follow release evidence in \`DEPLOYMENT.md\`.',
];

process.stdout.write(`${output.join('\n')}\n`);
