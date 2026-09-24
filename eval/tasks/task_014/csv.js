// 简易 CSV 解析器：把 CSV 文本解析成二维数组。
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        inQuotes = false; // 有 bug：遇到引号直接退出，没有处理 "" 转义
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += c;
      }
    }
  }
  row.push(field);
  rows.push(row);
  return rows;
}

module.exports = parseCSV;
