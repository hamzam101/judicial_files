import sys
sys.stdout.reconfigure(encoding='utf-8')

with open(r'C:\Users\hamza\Desktop\New folder\judicial_files\judicial_files\judicial_files\page\execution_batch_editor_v2\execution_batch_editor_v2.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Namespace replacement
content = content.replace('var EBE = {};', 'var DBE = {};', 1)
content = content.replace('var EBE = EBE || {};', 'var DBE = DBE || {};')
content = content.replace('EBE.State', 'DBE.State')
content = content.replace('EBE.UI', 'DBE.UI')
content = content.replace('EBE.Grid', 'DBE.Grid')
content = content.replace('EBE.Batch', 'DBE.Batch')
content = content.replace('EBE.Print', 'DBE.Print')
content = content.replace('EBE.Events', 'DBE.Events')
content = content.replace('EBE.CSS', 'DBE.CSS')
content = content.replace('EBE.UI_TEMPLATE', 'DBE.UI_TEMPLATE')

# API paths
content = content.replace(
    'judicial_files.judicial_files.page.execution_batch_editor_v2.execution_batch_editor_v2.',
    'judicial_files.judicial_files.page.dispute_batch_editor_v2.dispute_batch_editor_v2.'
)

# Method names (function names called as strings)
content = content.replace('get_execution_file', 'get_dispute_file')
content = content.replace('search_execution_files', 'search_dispute_files')
content = content.replace('get_execution_files_for_print', 'get_dispute_files_for_print')

# Assistant -> Secretary (order matters: do current first, then regular)
content = content.replace('current_execution_assistant', '_CURRENT_EXEC_TEMP_')
content = content.replace('execution_assistant', 'secretary')
content = content.replace('_CURRENT_EXEC_TEMP_', '_current_exec_removed_')

content = content.replace('original_execution_assistant', 'original_secretary')
content = content.replace('assistant_control', 'secretary_control')
content = content.replace('apply_auto_assistant_assignment', 'apply_auto_secretary_assignment')
content = content.replace('scanner-assistant-container', 'scanner-secretary-container')

# Fix specific fieldnames in quotes
content = content.replace("'secretary_assistant'", "'secretary'")
content = content.replace("\"secretary_assistant\"", "\"secretary\"")

content = content.replace('execution_batch_editor_v2', 'dispute_batch_editor_v2')

with open(r'C:\Users\hamza\Desktop\New folder\judicial_files\judicial_files\judicial_files\page\dispute_batch_editor_v2\dispute_batch_editor_v2.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('Wrote base file')
print('Size:', len(content), 'bytes')
