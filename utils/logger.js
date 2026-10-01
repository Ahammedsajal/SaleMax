function format(level, args) {
  const ts = new Date().toISOString();
  return [`[${ts}]`, `[${level}]`, ...args];
}

module.exports = {
  log: (...args) => console.log(...format('INFO', args)),
  warn: (...args) => console.warn(...format('WARN', args)),
  error: (...args) => console.error(...format('ERROR', args)),
};
