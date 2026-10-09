import re

with open('test/expense-hardening.e2e-spec.ts', 'r', encoding='utf-8') as f:
  code = f.read()

# 1. URL paths
code = code.replace("'/v1/expenses", "`/v1/organizations/${orgId}/expenses")
code = code.replace("`/v1/expenses", "`/v1/organizations/${orgId}/expenses")
code = code.replace("`/v1/organizations/${orgId}/expenses`).set(auth(ownerTokenB, orgIdB))", "`/v1/organizations/${orgIdB}/expenses`).set(auth(ownerTokenB, orgIdB))")

# 2. Add idempotencyKey to helper
code = code.replace(".send(payload)", ".send({ idempotencyKey: `idem-${nanoid(8)}`, ...payload })")

# 3. amount: 90 -> amount: '90'
code = re.sub(r"amount:\s*(\d+(?:\.\d+)?)(?=[\,}])", r"amount: '\1'", code)

# 4. debit?.debit -> debit?.debit.toString()
code = code.replace('debit?.debit', 'debit?.debit.toString()')
code = code.replace('credit?.credit', 'credit?.credit.toString()')

with open('test/expense-hardening.e2e-spec.ts', 'w', encoding='utf-8') as f:
  f.write(code)
