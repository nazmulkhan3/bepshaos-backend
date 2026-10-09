import fs from 'fs';

let content = fs.readFileSync('test/expense.e2e-spec.ts', 'utf8');
content = content.replace(/get\(\`(\/v1[^']+)'\)/g, 'get(`$1`)');
content = content.replace(/post\(\`(\/v1[^']+)'\)/g, 'post(`$1`)');
content = content.replace(/patch\(\`(\/v1[^']+)'\)/g, 'patch(`$1`)');
content = content.replace(/get\(\`(\/v1[^']+)'\./g, 'get(`$1`).');
content = content.replace(/post\(\`(\/v1[^']+)'\./g, 'post(`$1`).');
content = content.replace(/patch\(\`(\/v1[^']+)'\./g, 'patch(`$1`).');
fs.writeFileSync('test/expense.e2e-spec.ts', content);

let contentHard = fs.readFileSync('test/expense-hardening.e2e-spec.ts', 'utf8');
contentHard = contentHard.replace(/get\(\`(\/v1[^']+)'\)/g, 'get(`$1`)');
contentHard = contentHard.replace(/post\(\`(\/v1[^']+)'\)/g, 'post(`$1`)');
contentHard = contentHard.replace(/patch\(\`(\/v1[^']+)'\)/g, 'patch(`$1`)');
contentHard = contentHard.replace(/get\(\`(\/v1[^']+)'\./g, 'get(`$1`).');
contentHard = contentHard.replace(/post\(\`(\/v1[^']+)'\./g, 'post(`$1`).');
contentHard = contentHard.replace(/patch\(\`(\/v1[^']+)'\./g, 'patch(`$1`).');
fs.writeFileSync('test/expense-hardening.e2e-spec.ts', contentHard);
