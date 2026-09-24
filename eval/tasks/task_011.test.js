const assert = require('assert')
const mod = require('./json-parser.js')
const parse = typeof mod === 'function' ? mod : mod.parse

const cases = [
  ['{"a":1}', { a: 1 }],
  ['[1,2,3]', [1, 2, 3]],
  ['{"s":"hi"}', { s: 'hi' }],
  ['{"s":"a\\nb"}', { s: 'a\nb' }],
  ['{"s":"a\\tb"}', { s: 'a\tb' }],
  ['{"s":"a\\"b"}', { s: 'a"b' }],
  ['{"s":"a\\\\b"}', { s: 'a\\b' }],
  ['{"u":"\\u00e9"}', { u: 'é' }],
  ['{"n":null,"b":true,"f":false}', { n: null, b: true, f: false }],
  ['{"i":-12}', { i: -12 }],
  ['{"f":3.14}', { f: 3.14 }],
  ['{"e":1e3}', { e: 1000 }],
  ['{"deep":{"a":[1,{"b":[2,3]}]}}', { deep: { a: [1, { b: [2, 3] }] } }],
  ['{"arr":[{"x":1},{"x":2}]}', { arr: [{ x: 1 }, { x: 2 }] }],
  ['{"eo":{},"ea":[]}', { eo: {}, ea: [] }],
]

for (const [input, expected] of cases) {
  assert.deepStrictEqual(parse(input), expected, `failed on: ${input}`)
}
console.log(`OK: ${cases.length} cases`)
