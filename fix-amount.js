import fs from 'fs';

let file = 'test/expense-hardening.e2e-spec.ts';
let code = fs.readFileSync(file, 'utf8');

// fix createExpense signature
code = code.replace(
  /\.send\(payload\);/g,
  '.send({ idempotencyKey: `idem-${nanoid(8)}`, ...payload });'
);

// fix amount types from numbers to strings
code = code.replace(/amount: (\d+)(?=[,}])/g, "amount: '$1'");
code = code.replace(/amount: (\d+\.\d+)(?=[,}])/g, "amount: '$1'");

// fix decimal assertion
code = code.replace(/expect\(debit\?\.debit\)\.toBe\('9999\.9999'\);/g, "expect(debit?.debit.toString()).toBe('9999.9999');");
code = code.replace(/expect\(credit\?\.credit\)\.toBe\('9999\.9999'\);/g, "expect(credit?.credit.toString()).toBe('9999.9999');");

fs.writeFileSync(file, code);
