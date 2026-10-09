import fs from 'fs';
import path from 'path';

function fixImports(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      fixImports(fullPath);
    } else if (fullPath.endsWith('.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      
      // regex to match import { ... } from './...'; or '../...';
      content = content.replace(/from\s+['"](\.[^'"]+)['"]/g, (match, p1) => {
        // if it already has .js, don't change
        if (p1.endsWith('.js')) return match;
        return `from '${p1}.js'`;
      });
      
      fs.writeFileSync(fullPath, content);
    }
  }
}

fixImports('./src/modules/auth');
