// 把罗马数字转成整数。
function romanToInt(s) {
  const map = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    total += map[s[i]]; // 有 bug：没有处理减式记法（IV=4 而非 6）
  }
  return total;
}

module.exports = romanToInt;
