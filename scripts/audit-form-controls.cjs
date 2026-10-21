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

function buttonLabel(markup, control, tag) {
  const start = control.index + tag.length;
  const end = markup.indexOf('</button>', start);
  if (end < 0) return '';
  const body = markup.slice(start, end);
  const translated = body.match(/(?:t|tr|text)\('([^']+)'/);
  if (translated) return translated[1];
  if (body.includes('${')) return '';
  return body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function humanAttribute(tag, name) {
  const value = attr(tag, name);
  if (!value) return '';
  return value.match(/\$\{(?:t|tr|text)\('([^']+)'/)?.[1] || value;
}

function fieldLabel(tag, kind) {
  const marker = tag.match(/\b(data-[a-z0-9_-]+)(?:\s*=|\s|\/|>)/i)?.[1];
  const identity = attr(tag, 'name') || attr(tag, 'id') || attr(tag, 'data-field') || marker || humanAttribute(tag, 'aria-label') || humanAttribute(tag, 'placeholder') || 'unlabelled';
  const readonly = /\sreadonly(?:\s|=|\/|>)/i.test(tag) ? ', readonly' : '';
  return `${kind}:${identity}${kind === 'input' ? ` [${attr(tag, 'type') || 'text'}${readonly}]` : readonly ? ' [readonly]' : ''}`;
}

const files = roots.flatMap(relative => [...walk(path.join(root, relative))]);
const records = [];
let totalForms = 0;
let totalControls = 0;
let totalStandaloneFields = 0;
let totalUnlabelledFields = 0;
for (const absolute of files.sort()) {
  const source = fs.readFileSync(absolute, 'utf8');
  const relative = path.relative(root, absolute).replaceAll(path.sep, '/');
  const forms = [...source.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form\s*>/gi)];
  if (!forms.length && !/(?:createElement|el|add)\(\s*['"](?:form|input|select|textarea)['"]\)/.test(source) && !/<(?:input|select|textarea)\b/i.test(source)) continue;
  const lineOf = offset => source.slice(0, offset).split('\n').length;
  const lines = [];
  const unlabelled = [];
  for (const match of forms) {
    const opening = `<form ${match[1]}>`;
    const name = attr(opening, 'id') || attr(opening, 'data-form') || attr(opening, 'class') || 'unnamed form';
    const controls = [...match[2].matchAll(/<(input|select|textarea|output|button)\b[^>]*>/gi)].map(control => {
      const tag = control[0];
      const kind = control[1].toLowerCase();
      if (kind === 'button') return `button:${humanAttribute(tag, 'aria-label') || buttonLabel(match[2], control, tag) || attr(tag, 'data-testid') || 'unlabelled'}`;
      if (['input', 'select', 'textarea'].includes(kind) && (kind !== 'input' || !['hidden', 'submit', 'reset', 'button', 'image'].includes((attr(tag, 'type') || 'text').toLowerCase()))) {
        const id = attr(tag, 'id');
        const openingLabel = match[2].lastIndexOf('<label', control.index);
        const previousClosingLabel = match[2].lastIndexOf('</label', control.index);
        const closingLabel = match[2].slice(control.index + tag.length).search(/<\/label\s*>/i);
        const wrapped = openingLabel > previousClosingLabel && closingLabel >= 0;
        const explicit = id && new RegExp(`<label\\b[^>]*\\bfor\\s*=\\s*(?:"${id.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}"|'${id.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}'|${id.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}(?=[\\s>]))`, 'i').test(match[2]);
        const hiddenFromAccessibilityTree = attr(tag, 'aria-hidden') === 'true';
        const named = ['aria-label', 'aria-labelledby', 'title'].some(name => Boolean(attr(tag, name)));
        if (!hiddenFromAccessibilityTree && !wrapped && !explicit && !named) unlabelled.push({ line: lineOf(match.index + control.index), field: fieldLabel(tag, kind) });
      }
      return fieldLabel(tag, kind);
    });
    totalForms += 1;
    totalControls += controls.length;
    lines.push(`  - Line ${lineOf(match.index)} · **${esc(name)}** · ${controls.length} control(s): ${controls.length ? controls.map(esc).join(', ') : 'none detected in static markup'}`);
  }
  const standalone = [...source.matchAll(/<(input|select|textarea)\b[^>]*>/gi)]
    .filter(control => !forms.some(form => control.index > form.index && control.index < form.index + form[0].length))
    .map(control => ({ line: lineOf(control.index), label: fieldLabel(control[0], control[1].toLowerCase()) }));
  totalStandaloneFields += standalone.length;
  const standaloneLines = standalone.length
    ? [`  Control fragments outside literal <form> markup (${standalone.length}; some are interpolated into generated forms): ${standalone.map(item => `line ${item.line} ${esc(item.label)}`).join('; ')}`]
    : [];
  totalUnlabelledFields += unlabelled.length;
  const unlabelledLines = unlabelled.length
    ? [`  Controls missing an explicit accessible label (${unlabelled.length}): ${unlabelled.map(item => `line ${item.line} ${esc(item.field)}`).join('; ')}`]
    : [];
  const dynamic = [...source.matchAll(/(?:createElement|el|add)\(\s*['"](form|input|select|textarea)['"]\)|\.name\s*=\s*['"]([^'"]+)['"]|\bfield\(\s*form\s*,\s*([^,)]+)/g)].map(match => ({ line: lineOf(match.index), text: match[1] ? `form/control helper creates ${match[1]}` : match[2] ? `field name ${match[2]}` : `field(form, ${esc(match[3].trim())})` }));
  if (forms.length || dynamic.length || standalone.length) {
    records.push({ relative, lines, standaloneLines, unlabelledLines, dynamic });
  }
}

const output = [
  '# Source-maintained form and control audit',
  '',
  `Generated ${new Date().toISOString().slice(0, 10)} by \`node scripts/audit-form-controls.cjs\`.`,
  '',
  `The scan covers maintained HTML/JavaScript/TypeScript under \`client/public\` and \`client/workspace-src\`, excluding the hash-bundled React assets. It found **${totalForms} static form templates**, **${totalControls} controls inside those templates**, and **${totalStandaloneFields} input/select/textarea template fragments** outside literal form blocks. It also flagged **${totalUnlabelledFields} static fields without an explicit accessible label** (wrapping/for labels, ARIA names and title attributes are recognized; generated fragments and runtime DOM associations still require browser review). Some fragments are interpolated into generated forms, so the third count is an inventory aid rather than an additive total of rendered controls. Runtime form builders are listed by source line. Dynamic loops and generated catalogue options still need browser checks because static scans cannot count their rendered instances.`,
  '',
  '## File-by-file inventory',
  '',
  ...records.flatMap(record => [
    `### \`${record.relative}\``,
    '',
    ...(record.lines.length ? record.lines : ['  - No literal form template; controls are created at runtime.']),
    ...record.standaloneLines,
    ...record.unlabelledLines,
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
