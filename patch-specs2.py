import os

modules = ['sales', 'purchases', 'payments', 'expenses']

for mod in modules:
    spec_path = f"src/modules/{mod}/{mod}.service.spec.ts"
    if not os.path.exists(spec_path): continue
    
    with open(spec_path, 'r') as f:
        content = f.read()
    
    # fix the double commas
    content = content.replace('},,', '},')
    
    with open(spec_path, 'w') as f:
        f.write(content)

print("Tests double comma fixed")
