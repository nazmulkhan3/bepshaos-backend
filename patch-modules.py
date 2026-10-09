import os
import re

def add_import_and_inject(module_name, service_name, entity_name, notification_type, message_template):
    # Update Module
    module_path = f"src/modules/{module_name}/{module_name}.module.ts"
    with open(module_path, 'r') as f:
        module_content = f.read()
    
    if "NotificationModule" not in module_content:
        module_content = "import { NotificationModule } from '../notification/notification.module.js';\n" + module_content
        # Find imports array and add NotificationModule
        module_content = re.sub(
            r'imports:\s*\[(.*?)\]',
            lambda m: f"imports: [{m.group(1).strip()}{', ' if m.group(1).strip() and not m.group(1).strip().endswith(',') else ''}NotificationModule]",
            module_content,
            flags=re.DOTALL
        )
        with open(module_path, 'w') as f:
            f.write(module_content)

    # Update Service
    service_path = f"src/modules/{module_name}/{module_name}.service.ts"
    with open(service_path, 'r') as f:
        service_content = f.read()

    if "NotificationQueueService" not in service_content:
        service_content = "import { NotificationQueueService } from '../notification/notification.queue.service.js';\n" + service_content
        
        # Inject NotificationQueueService
        service_content = re.sub(
            r'constructor\s*\((.*?)\)\s*\{',
            lambda m: f"constructor({m.group(1).strip()}{', ' if m.group(1).strip() and not m.group(1).strip().endswith(',') else ''}private readonly notificationQueue: NotificationQueueService) {{",
            service_content,
            flags=re.DOTALL
        )

        with open(service_path, 'w') as f:
            f.write(service_content)

add_import_and_inject('sales', 'SalesService', 'Sale', 'SALE_COMPLETED', 'Sale completed')
add_import_and_inject('purchases', 'PurchasesService', 'Purchase', 'PURCHASE_CREATED', 'Purchase created')
add_import_and_inject('payments', 'PaymentsService', 'Payment', 'PAYMENT_RECEIVED', 'Payment processed')
add_import_and_inject('expenses', 'ExpensesService', 'Expense', 'EXPENSE_CREATED', 'Expense created')

