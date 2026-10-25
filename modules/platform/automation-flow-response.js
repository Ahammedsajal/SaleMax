'use strict';

function setVariables(variables, obj, { fallbackText } = {}) {
  const result = {};
  for (const variable of variables || []) {
    if (typeof variable?.varName !== 'string' || typeof variable?.responsePath !== 'string') continue;
    // Flow Builder response paths are relative to the incoming message; the
    // executor passes that message inside an envelope for response saving.
    let value = obj?.message ?? obj;
    let missing = false;
    for (const part of variable.responsePath.split('.')) {
      const match = part.match(/^(\w+)\[(\d+)\]$/);
      if (match) {
        const list = value?.[match[1]], index = Number(match[2]);
        if (!Array.isArray(list) || list[index] === undefined) { missing = true; break; }
        value = list[index];
      } else if (value && value[part] !== undefined) {
        value = value[part];
      } else {
        missing = true;
        break;
      }
    }
    if (missing) {
      // Meta button/list replies are normalized to incoming text before flow
      // execution. Preserve that answer if a legacy message shape lacks the
      // configured nested path.
      value = variable.responsePath === 'msgContext.text.body'
        && typeof fallbackText === 'string' && fallbackText.trim()
        ? fallbackText
        : 'NA';
    }
    if (typeof value === 'object' && value !== null) value = JSON.stringify(value);
    result[variable.varName] = value;
  }
  return result;
}

module.exports = { setVariables };
