// condition_parser.js
// Simple safe condition evaluator for enemy AI triggers.
// Supports comparison operators (< > <= >= == != === !==), logical && || !, and parentheses.
// Whitelisted identifiers are mapped to properties of the enemy object.
// UMD: works as a browser global (window.ConditionParser), in classic <script> tags,
// and via CommonJS require() in Node (server-side validation / tests).

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ConditionParser = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const WHITELIST = new Set([
    'hp', 'maxHp', 'state', 'type', 'attackStyle', 'facing', 'x', 'z', 'jumpY', 'speedX', 'speedZ',
  ]);
  const LITERALS = new Set(['true', 'false', 'null', 'undefined']);
  // Only these characters may appear outside of string literals.
  const ALLOWED_CHARS = /^[\w\s.<>=!&|()+\-*/%]*$/;

  /**
   * Transform a condition string into a safe JavaScript expression.
   * Replaces each whitelisted identifier with `enemy.<id>`.
   * Throws if an unknown identifier or disallowed character is found.
   */
  function transformCondition(cond) {
    if (typeof cond !== 'string') throw new Error('Condition must be a string');
    if (cond.length > 200) throw new Error('Condition too long (max 200 chars)');
    // Split out simple quoted string literals so their contents are not treated as identifiers.
    const parts = cond.split(/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/);
    return parts.map((part, i) => {
      if (i % 2 === 1) return part; // string literal
      if (!ALLOWED_CHARS.test(part)) throw new Error('Unsupported character in condition');
      if (/[`;{}[\]]/.test(part)) throw new Error('Unsupported character in condition');
      return part.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g, (match, _id, offset, str) => {
        if (str[offset - 1] === '.') throw new Error(`Property access not allowed: .${match}`);
        if (WHITELIST.has(match)) return `enemy.${match}`;
        if (LITERALS.has(match)) return match;
        throw new Error(`Unsupported identifier in condition: ${match}`);
      });
    }).join('');
  }

  /**
   * Validate a condition without evaluating it.
   * @returns {{ok: boolean, error?: string}}
   */
  function validateCondition(condition) {
    if (!condition || !condition.trim()) return { ok: true };
    try {
      const expr = transformCondition(condition);
      // eslint-disable-next-line no-new-func
      new Function('enemy', `return (${expr});`);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /**
   * Evaluate a condition string against an enemy instance.
   * Empty conditions evaluate to true (always fire).
   * @param {string} condition - e.g. "hp < 30 && state === 'hurt'"
   * @param {object} enemy - the enemy object containing relevant properties
   * @returns {boolean} result of evaluation (false on error)
   */
  function evalCondition(condition, enemy) {
    if (!condition || !condition.trim()) return true;
    try {
      const expr = transformCondition(condition);
      // eslint-disable-next-line no-new-func
      const fn = new Function('enemy', `return (${expr});`);
      return !!fn(enemy);
    } catch (e) {
      console.error('Condition evaluation error:', e);
      return false;
    }
  }

  return { evalCondition, validateCondition, WHITELIST: Array.from(WHITELIST) };
});
