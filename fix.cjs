const fs = require('fs');
let content = fs.readFileSync('test/expense.e2e-spec.ts', 'utf8');
content = content.replace(/'\/v1\/expenses/g, '`/v1/organizations/${orgIdA}/expenses');
content = content.replace(/`\/v1\/expenses/g, '`/v1/organizations/${orgIdA}/expenses');
content = content.replace(/`\/v1\/organizations\/\$\{orgIdA\}\/expenses\/categories\/\$\{categoryIdA\}\`/g, '`/v1/organizations/${orgIdB}/expenses/categories/${categoryIdA}`');
content = content.replace(/`\/v1\/organizations\/\$\{orgIdA\}\/expenses\/\$\{expenseIdA\}\`/g, '`/v1/organizations/${orgIdB}/expenses/${expenseIdA}`');
fs.writeFileSync('test/expense.e2e-spec.ts', content);

let contentHard = fs.readFileSync('test/expense-hardening.e2e-spec.ts', 'utf8');
contentHard = contentHard.replace(/'\/v1\/expenses/g, '`/v1/organizations/${orgId}/expenses');
contentHard = contentHard.replace(/`\/v1\/expenses/g, '`/v1/organizations/${orgId}/expenses');
contentHard = contentHard.replace(/`\/v1\/organizations\/\$\{orgId\}\/expenses`\)\.set\(auth\(ownerTokenB, orgIdB\)\)/g, '`/v1/organizations/${orgIdB}/expenses`).set(auth(ownerTokenB, orgIdB))');
fs.writeFileSync('test/expense-hardening.e2e-spec.ts', contentHard);
