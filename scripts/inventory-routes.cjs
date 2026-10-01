const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const root = path.resolve(__dirname, '..');
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (node.type) visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc') continue;
    if (Array.isArray(value)) value.forEach(child => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}
function parse(file) { return acorn.parse(fs.readFileSync(path.join(root, file), 'utf8'), { ecmaVersion: 'latest', sourceType: 'script', locations: true }); }
function isMethod(node, object, method) { return node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.object.name === object && node.callee.property.name === method; }
function label(node) {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression') return label(node.object) + '.' + label(node.property);
  if (node.type === 'CallExpression' && node.callee.name === 'require' && typeof node.arguments[0]?.value === 'string') return 'require(' + node.arguments[0].value + ')';
  return node.type;
}
function inventory() {
  const mounts = [], direct = [];
  walk(parse('server.js'), node => {
    if (isMethod(node, 'app', 'use') && typeof node.arguments[0]?.value === 'string') {
      const required = node.arguments.find(arg => arg.type === 'CallExpression' && arg.callee.name === 'require');
      if (required) mounts.push({ prefix: node.arguments[0].value, source: required.arguments[0].value.replace(/^\.\//, '') + '.js', line: node.loc.start.line });
    }
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.object.name === 'app' && ['get', 'post', 'put', 'patch', 'delete'].includes(node.callee.property.name) && typeof node.arguments[0]?.value === 'string') direct.push({ method: node.callee.property.name.toUpperCase(), path: node.arguments[0].value, source: 'server.js', line: node.loc.start.line });
  });
  const routes = [];
  for (const mount of mounts) {
    walk(parse(mount.source), node => {
      if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression' || node.callee.object.name !== 'router') return;
      const method = node.callee.property.name;
      if (!['get', 'post', 'put', 'patch', 'delete', 'all', 'use'].includes(method) || typeof node.arguments[0]?.value !== 'string') return;
      const guards = node.arguments.slice(1).filter(arg => !['ArrowFunctionExpression', 'FunctionExpression'].includes(arg.type)).map(label);
      routes.push({ method: method.toUpperCase(), path: mount.prefix + node.arguments[0].value, source: mount.source, line: node.loc.start.line, declaredGuards: guards });
    });
  }
  return { source: 'server.js and mounted route files', scope: 'Static declarations only; guard names do not prove authorization or working features. Inline checks, dynamic/chained routers and global middleware require separate review.', mounts, direct, routes };
}
if (require.main === module) {
  const result = inventory();
  fs.writeFileSync(path.join(root, 'docs/LEGACY_ROUTE_INVENTORY.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ mountedFamilies: result.mounts.length, declaredRoutes: result.routes.length, directAppRoutes: result.direct.length }));
}
module.exports = { inventory };
