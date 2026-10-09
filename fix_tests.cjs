const fs = require('fs');
const path = require('path');

const testDir = path.join(__dirname, 'test');
const files = fs.readdirSync(testDir).filter(f => f.endsWith('.ts'));

for (const file of files) {
  const filePath = path.join(testDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Make sure testId is unique
  content = content.replace(/const testId = nanoid\(5\);/g, 'const testId = Date.now().toString() + nanoid(5);');
  
  // Replace randomSuffix in supplier
  content = content.replace(/const randomSuffix = Date\.now\(\)\.toString\(\);/g, 'const randomSuffix = Date.now().toString() + nanoid(5);');
  
  // Also roles.e2e-spec.ts doesn't define testId properly, let's fix
  if (file === 'roles.e2e-spec.ts') {
    if (!content.includes('const testId =')) {
      content = content.replace(/beforeAll\(async \(\) => \{/, "beforeAll(async () => {\n    const testId = Date.now().toString() + nanoid(5);");
    }
  }

  // Add missing headers in payment.e2e-spec.ts and payment-hardening.e2e-spec.ts
  if (file.includes('payment')) {
    content = content.replace(/\.set\('Authorization', `Bearer \$\{user1Token\}`\)/g, ".set('Authorization', `Bearer ${user1Token}`).set('x-organization-id', org1Id)");
  }
  
  fs.writeFileSync(filePath, content);
}
console.log('Fixed test files');
