import os
import re

modules = ['sales', 'purchases', 'payments', 'expenses']

for mod in modules:
    spec_path = f"src/modules/{mod}/{mod}.service.spec.ts"
    if not os.path.exists(spec_path): continue
    
    with open(spec_path, 'r') as f:
        content = f.read()
    
    if "NotificationQueueService" not in content:
        content = "import { NotificationQueueService } from '../notification/notification.queue.service.js';\n" + content
        
        # Add mock
        mock_str = """
        {
          provide: NotificationQueueService,
          useValue: { enqueue: vi.fn() },
        },
        """
        
        # Find providers array and insert
        content = re.sub(
            r'providers:\s*\[(.*?)\]',
            lambda m: f"providers: [{m.group(1).strip()}{',' if m.group(1).strip() else ''}{mock_str}]",
            content,
            flags=re.DOTALL
        )
        
        with open(spec_path, 'w') as f:
            f.write(content)

print("Tests patched")
