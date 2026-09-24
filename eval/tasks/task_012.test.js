const assert = require('assert')
const mod = require('./regex.js')
const match = typeof mod === 'function' ? mod : mod.match

const cases = [
  ['abc', 'abc', true],
  ['abc', 'ab', false],
  ['abc', 'xabc', false],
  ['.', 'a', true],
  ['.', 'ab', false],
  ['a.c', 'abc', true],
  ['a.c', 'ac', false],
  ['a*', '', true],
  ['a*', 'aaa', true],
  ['a*', 'b', false],
  ['a+', 'aaa', true],
  ['a+', '', false],
  ['a*b', 'b', true],
  ['a*b', 'aaab', true],
  ['a*b', 'a', false],
  ['a+b', 'b', false],
  ['a+b', 'aaab', true],
  ['ab?', 'a', true],
  ['ab?', 'ab', true],
  ['ab?', 'abb', false],
  ['[abc]', 'b', true],
  ['[abc]', 'd', false],
  ['[^abc]', 'd', true],
  ['[^abc]', 'a', false],
  ['colou?r', 'color', true],
  ['colou?r', 'colour', true],
  ['colou?r', 'colouur', false],
  ['a.*c', 'abbbc', true],
  ['a.*c', 'abc', true],
  ['a.*c', 'ac', true],
]

for (const [pattern, str, expected] of cases) {
  assert.strictEqual(match(pattern, str), expected, `match(${JSON.stringify(pattern)}, ${JSON.stringify(str)}) 应为 ${expected}`)
}
console.log(`OK: ${cases.length} cases`)
