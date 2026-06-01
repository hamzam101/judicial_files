import sys, re
sys.stdout.reconfigure(encoding='utf-8')

with open(r'C:\Users\hamza\Desktop\New folder\judicial_files\judicial_files\judicial_files\page\dispute_batch_editor_v2\dispute_batch_editor_v2.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix header comment
content = content.replace(
    'محرر دفعات ملفات التنفيذ المطور',
    'محرر دفعات ملفات المنازعات المطور'
)

# Fix EBE.init reference
content = content.replace('EBE.init', 'DBE.init')

# Fix COL_WIDTHS: exec_assistant -> secretary
content = content.replace('exec_assistant', 'secretary')

# Remove current_assistant from COL_WIDTHS
content = content.replace("    current_assistant: 130,\n", "")

# Remove all _current_exec_removed_ references (these were current_execution_assistant)
# In the row template - remove the entire column
# Find and remove the td for current_assistant in row template
content = content.replace(
    "data-fieldname=\"_current_exec_removed_\"",
    "ZZZ_REMOVE_CURRENT_ASST"
)

# Remove lines containing ZZZ_REMOVE_CURRENT_ASST
lines = content.split('\n')
filtered_lines = []
for i, line in enumerate(lines):
    if 'ZZZ_REMOVE_CURRENT_ASST' in line:
        continue
    # Remove empty lines that might result
    filtered_lines.append(line)
content = '\n'.join(filtered_lines)

# Fix references to file._current_exec_removed_
content = content.replace('file._current_exec_removed_', 'file.secretary')

# Fix references to ._current_exec_removed_ in various contexts
content = content.replace('._current_exec_removed_', '')

# Fix any remaining _current_exec_removed_ 
content = content.replace('_current_exec_removed_', '')

# Fix labels - print titles
content = content.replace(
    'القضايا التنفيذية المرحلة للأرشيف',
    'قضايا المنازعات التنفيذية المرحلة للأرشيف'
)

# Fix filter labels in search dialog
content = content.replace(
    "'طالب التنفيذ'",
    "'المدعي'"
)
content = content.replace(
    "'المنفذ ضده'",
    "'المدعى عليه'"
)

# Fix print table headers in _do_print  
content = content.replace(
    'طالب التنفيذ',
    'المدعي'
)
content = content.replace(
    'المنفذ ضده',
    'المدعى عليه'
)

# Fix main table headers in template
content = content.replace(
    'طالب التنفيذ',
    'المدعي'
)
content = content.replace(
    'المنفذ ضده',
    'المدعى عليه'
)
# Note: after replacing طالب التنفيذ and المنفذ ضده, the table header should show المدعي/المدعى عليه

# Fix معاون التنفيذ المختص -> أمين السر (in labels for print headers and table)
content = content.replace(
    'معاون التنفيذ المختص',
    'أمين السر'
)
content = content.replace(
    'معاون التنفيذ الحالي',
    'أمين السر'
)

# Fix batch title dialog  
content = content.replace(
    'ارشيف ملفات التنفيذ شهر',
    'ارشيف ملفات المنازعات شهر'
)

# Fix reference input placeholder
content = content.replace(
    'رقم مرجع ملف التنفيذ',
    'رقم مرجع ملف المنازعات'
)

# Fix reference input label
content = content.replace(
    'ملف التنفيذ',
    'ملف المنازعات'
)

# Fix colspan values
content = content.replace('colspan="17"', 'colspan="16"')
content = content.replace("colspan='17'", "colspan='16'")
content = content.replace('colspan="15"', 'colspan="14"')
content = content.replace("colspan='15'", "colspan='14'")

# Fix data-col indices - shift all data-col values >= 7 down by 1 (since col 7 removed)
# In the row template, the cols were:
# 1=file_number, 2=year, 3=petitioner, 4=respondent, 5=judge, 6=secretary, 
# 7=_current_exec_removed_ (REMOVED), 8=status, 9=new_status, 10=posting_type, 
# 11=archive_date, 12=archive_year, 13=archive_month
# After removal: 1=file_num, 2=year, 3=petitioner, 4=respondent, 5=judge, 
# 6=secretary, 7=status, 8=new_status, 9=posting_type, 10=archive_date, 
# 11=archive_year, 12=archive_month
# So old data-col values 8-13 should become 7-12

# But actually the text replacement already shifted some things. Let me think...
# After replacement, current_execution_assistant was removed from the template.
# The data-col values would be: 1,2,3,4,5,6,8,9,10,11,12,13 
# We need to shift 8->7, 9->8, 10->9, 11->10, 12->11, 13->12
# Since these are strings like data-col="8", we can use regex

# Fix data-col values: shift down by 1 for cols 8-13
for old in range(8, 14):
    new = old - 1
    content = content.replace(f'data-col="{old}"', f'data-col="{new}"')

# Fix CSS nth-child rules for thead th
# Old: th:nth-child(4)=file,5=year,6=pet,7=resp,8=judge,9=sec,10=curr_asst,11=status,12=new_st,13=post,14=arch_d,15=arch_y,16=arch_m
# Remove th:nth-child(10) which was current_assistant
# Shift 11-16 to 10-15

# Let me fix the CSS selectors more carefully
# The CSS has:
# #editor-table thead th:nth-child(4){...file_number}
# #editor-table thead th:nth-child(5){...year}
# #editor-table thead th:nth-child(6){...petitioner}
# #editor-table thead th:nth-child(7){...respondent}
# #editor-table thead th:nth-child(8){...judge}
# #editor-table thead th:nth-child(9){...secretary}
# #editor-table thead th:nth-child(10){...current_assistant}  <- REMOVE
# #editor-table thead th:nth-child(11){...status} -> becomes 10
# #editor-table thead th:nth-child(12){...new_status} -> becomes 11
# #editor-table thead th:nth-child(13){...posting_type} -> becomes 12
# #editor-table thead th:nth-child(14){...archive_date} -> becomes 13
# #editor-table thead th:nth-child(15){...archive_year} -> becomes 14
# #editor-table thead th:nth-child(16){...archive_month} -> becomes 15

# Remove the nth-child(10) line for current_assistant
lines = content.split('\n')
filtered = []
for line in lines:
    if 'nth-child(10)' in line and 'secretary' not in line:
        # Check if this is the current_assistant width line
        if 'secretary' not in line and 'archive' not in line and 'status' not in line and 'new_status' not in line and 'posting' not in line:
            continue
    filtered.append(line)
content = '\n'.join(filtered)

# Shift nth-child values 11-16 to 10-15
for old in range(11, 17):
    new = old - 1
    content = content.replace(f'nth-child({old})', f'nth-child({new})')

# Fix tbody td[data-col="N"] CSS selectors
# Old: td[data-col="7"]=current_asst (removed), 8=status...13=archive_month
# After data-col shift, this should be fine since we already fixed data-col values
# Now data-col values are 1-12 instead of 1-13, so remove the 13 reference
# Remove td[data-col="13"] CSS line since we only have 12 data columns now
content = content.replace(
    "#editor-table tbody td[data-col=\"13\"]",
    "ZZZ_REMOVE_TD13"
)
lines = content.split('\n')
filtered = [l for l in lines if 'ZZZ_REMOVE_TD13' not in l]
content = '\n'.join(filtered)

# Fix the secretary column header label in the table template
# Look for "معاون التنفيذ المختص" and "معاون التنفيذ الحالي" in headers
content = content.replace(
    'معاون التنفيذ الحالي',
    'أمين السر'
)

# In the row template, fix the file object for the add_row_to_grid function
# Remove the original_secretary setting that came from current_execution_assistant
content = content.replace(
    "file.original_secretary = file.original_secretary !== undefined\n            ? file.original_secretary : (file.secretary || '');",
    "file.original_secretary = file.secretary || '';"
)

# Fix the auto-assignment for secretary in add_row_to_grid
# Original was: if (selected_assistant && file.status === 'منظور') { file.current_execution_assistant = selected_assistant; }
# Should be: if (selected_secretary && file.status === 'منظور') { file.secretary = selected_secretary; }
content = content.replace(
    "file.secretary = selected_secretary;",
    "file.secretary = selected_secretary;"
)

# The save_all_changes function references validate_secretary which doesn't exist
# The Python backend uses validate_assistant directly, so change it back
content = content.replace('validate_secretary', 'validate_assistant')

with open(r'C:\Users\hamza\Desktop\New folder\judicial_files\judicial_files\judicial_files\page\dispute_batch_editor_v2\dispute_batch_editor_v2.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed JS file')
