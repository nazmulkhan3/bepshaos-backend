with open('test/expense-hardening.e2e-spec.ts', 'r', encoding='utf-8') as f:
  code = f.read()

code = code.replace("`/v1/organizations/${orgId}/expenses/categories'", "`/v1/organizations/${orgId}/expenses/categories`")
code = code.replace("`/v1/organizations/${orgId}/expenses'", "`/v1/organizations/${orgId}/expenses`")
code = code.replace("`/v1/organizations/${orgIdB}/expenses'", "`/v1/organizations/${orgIdB}/expenses`")

with open('test/expense-hardening.e2e-spec.ts', 'w', encoding='utf-8') as f:
  f.write(code)
