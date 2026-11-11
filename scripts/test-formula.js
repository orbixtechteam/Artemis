const assert = require('assert');
(async () => {
  const { createEvaluator, formatValue, colName, colIndex } = await import('../src/lib/formula.mjs');
  assert.strictEqual(colName(0), 'A'); assert.strictEqual(colName(26), 'AA'); assert.strictEqual(colIndex('AB'), 27);
  const sheets = [
    { name: 'Data', rows: [['Item', 'Qty', 'Price', 'Total'], ['Apple', 3, 10, '=B2*C2'], ['Pear', '2', 15, '=B3*C3'], ['', '', '', '=SUM(D2:D3)'], ['=A1&"!"', '=IF(D4>50,"big","small")', '=Other!A1*2', '=D4/0']] },
    { name: 'Other', rows: [[21]] }
  ];
  const ev = createEvaluator(sheets);
  const f = (r, c, s = 0) => formatValue(ev(s, r, c));
  assert.strictEqual(f(1, 3), '30'); assert.strictEqual(f(2, 3), '30'); assert.strictEqual(f(3, 3), '60');
  assert.strictEqual(f(4, 0), 'Item!'); assert.strictEqual(f(4, 1), 'big'); assert.strictEqual(f(4, 2), '42'); assert.strictEqual(f(4, 3), '#DIV/0!');
  const t = (rows) => createEvaluator([{ name: 'S', rows }]);
  assert.strictEqual(formatValue(t([['=1+2*3^2']])(0, 0, 0)), '19');
  assert.strictEqual(formatValue(t([['=(1+2)*3']])(0, 0, 0)), '9');
  assert.strictEqual(formatValue(t([['=50%']])(0, 0, 0)), '0.5');
  assert.strictEqual(formatValue(t([['=-A2'], [4]])(0, 0, 0)), '-4');
  assert.strictEqual(formatValue(t([['=AVERAGE(A2:A4)'], [1], [2], [6]])(0, 0, 0)), '3');
  assert.strictEqual(formatValue(t([['=MAX(1,A2:A3)'], [9], [4]])(0, 0, 0)), '9');
  assert.strictEqual(formatValue(t([['=COUNTIF(A2:A5,">2")'], [1], [3], [5], ['x']])(0, 0, 0)), '2');
  assert.strictEqual(formatValue(t([['=SUMIF(A2:A4,"a",B2:B4)'], ['a', 1], ['b', 5], ['a', 2]])(0, 0, 0)), '3');
  assert.strictEqual(formatValue(t([['=ROUND(2.567,1)']])(0, 0, 0)), '2.6');
  assert.strictEqual(formatValue(t([['=A1']])(0, 0, 0)), '#CYCLE!');
  assert.strictEqual(formatValue(t([['=NOPE(1)']])(0, 0, 0)), '#NAME?');
  assert.strictEqual(formatValue(t([['=IFERROR(1/0,"x")']])(0, 0, 0)), 'x');
  assert.strictEqual(formatValue(t([['=1+']])(0, 0, 0)), '#VALUE!');
  assert.strictEqual(formatValue(t([['=\'S\'!A2'], [7]])(0, 0, 0)), '7');
  // long dependency chains do not overflow the stack
  const chain = [[1]]; for (let i = 1; i < 20000; i++) chain.push([`=A${i}+1`]);
  assert.strictEqual(formatValue(t(chain)(0, 19999, 0)), '20000');
  const sums = [[1]]; for (let i = 1; i < 5000; i++) sums.push([`=SUM(A${i}:A${i})*1`]);
  assert.strictEqual(formatValue(t(sums)(0, 4999, 0)), '1');
  const cyc = t([['=B1', '=A1']]); assert.strictEqual(formatValue(cyc(0, 0, 0)), '#CYCLE!');
  // ROUND is half away from zero
  assert.strictEqual(formatValue(t([['=ROUND(-2.5,0)']])(0, 0, 0)), '-3');
  assert.strictEqual(formatValue(t([['=ROUND(2.5,0)']])(0, 0, 0)), '3');
  assert.strictEqual(formatValue(t([['=ROUND(-1.005,2)']])(0, 0, 0)), '-1.01');
  assert.strictEqual(formatValue(t([['=ROUND(1234,-2)']])(0, 0, 0)), '1200');
  // TODAY is the local date
  const d = new Date(); const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  assert.strictEqual(formatValue(t([['=TODAY()']])(0, 0, 0)), local);
  // MIN/MAX over a range too big to spread into arguments
  const many = [['=MAX(A2:A300001)', '=MIN(A2:A300001)']]; for (let i = 0; i < 300000; i++) many.push([i - 7]);
  const mv = t(many); assert.strictEqual(formatValue(mv(0, 0, 0)), '299992'); assert.strictEqual(formatValue(mv(0, 0, 1)), '-7');
  // whole-column and whole-row ranges, on this sheet and on another (=COUNTIF(Data!D:D,A2) from an agent-made dashboard)
  const book = createEvaluator([
    { name: 'Data', rows: [['ID', 'Dept', 'Pay'], [1, 'Eng', 10], [2, 'Ops', 20], [3, 'Eng', 30]] },
    { name: 'Dash', rows: [['Eng', '=COUNTIF(Data!B:B,A1)', '=SUMIF(Data!B:B,A1,Data!C:C)', '=SUM(Data!C:C)', "=SUM('Data'!A:C)", '=SUM(Data!2:2)', '=COUNTA(Data!1:1)'],
      ['=SUM(A3:A4)', '=SUM(C:C)', 'x'], [5], [6]] },
    { name: 'Q1', rows: [[7]] }
  ]);
  assert.strictEqual(formatValue(book(1, 0, 1)), '2');
  assert.strictEqual(formatValue(book(1, 0, 2)), '40');
  assert.strictEqual(formatValue(book(1, 0, 3)), '60');
  assert.strictEqual(formatValue(book(1, 0, 4)), '66');
  assert.strictEqual(formatValue(book(1, 1, 1)), '40'); // C:C on its own sheet, the text cell skipped
  assert.strictEqual(formatValue(book(1, 0, 5)), '11');
  assert.strictEqual(formatValue(book(1, 0, 6)), '3');
  assert.strictEqual(formatValue(book(1, 1, 0)), '11');
  assert.strictEqual(formatValue(createEvaluator([{ name: 'A', rows: [['=Q1!A1*2']] }, { name: 'Q1', rows: [[4]] }])(0, 0, 0)), '8'); // a sheet named like a cell
  console.log('formula: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
