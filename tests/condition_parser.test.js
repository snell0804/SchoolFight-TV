const test = require('node:test');
const assert = require('node:assert/strict');
const { evalCondition, validateCondition } = require('../src/condition_parser.js');

test('empty condition is valid and evaluates to true', () => {
  assert.equal(validateCondition('').ok, true);
  assert.equal(evalCondition('', { hp: 100 }), true);
});

test('evaluates whitelisted comparisons and logical operators', () => {
  const enemy = { hp: 25, maxHp: 100, state: 'hurt', facing: -1, jumpY: 12 };
  assert.equal(evalCondition("hp < 30 && state === 'hurt'", enemy), true);
  assert.equal(evalCondition("hp < maxHp * 0.3 && facing === -1", enemy), true);
  assert.equal(evalCondition("hp > 50 || state === 'attack'", enemy), false);
  assert.equal(evalCondition('jumpY > 0', enemy), true);
});

test('rejects disallowed identifiers and code injection attempts', () => {
  for (const bad of [
    'alert(1)',
    'process.exit(1)',
    'window.location',
    'hp.toString()',
    'constructor',
    'eval("1+1")',
    'hp < 10; globalThis',
    'hp < `10`',
    'a'.repeat(205),
  ]) {
    assert.equal(validateCondition(bad).ok, false, `Expected rejection for: ${bad}`);
    assert.equal(evalCondition(bad, { hp: 5 }), false);
  }
});
