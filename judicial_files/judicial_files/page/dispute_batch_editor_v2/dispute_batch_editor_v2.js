// =============================================================================
// dispute_batch_editor_v2.js — محرر دفعات ملفات المنازعات المطور
// =============================================================================
// منظمة في Namespaces:
//   DBE.State    → الحالة العامة
//   DBE.UI       → دوال الواجهة المساعدة (عدادات، تصفح، ترتيب)
//   DBE.Grid     → إدارة الجدول (إضافة، بحث، تعديل، حذف)
//   DBE.Batch    → إدارة الأرشفة (حفظ، تحميل، ترحيل)
//   DBE.Print    → الطباعة
//   DBE.Events   → ربط الأحداث
//   DBE.init     → نقطة البداية
// =============================================================================

// =============================================================================
// قيم عرض الأعمدة (قابلة للتعديل يدوياً)
// =============================================================================

var COL_WIDTHS = {
    checkbox: 40,
    index: 40,
    ref: 60,
    file_number: 60,
    year: 40,
    petitioner: 180,
    respondent: 180,
    judge: 130,
    secretary: 130,
    current_secretary: 130,
    status: 60,
    new_status: 60,
    posting_type: 70,
    execution_file_no: 130,
    archive_date: 100,
    archive_year: 80,
    archive_month: 80,
    actions: 70,
};

// =============================================================================
// DBE.State — الحالة العامة لمحرر الدفعات
// =============================================================================

var DBE = {};

DBE.State = {
    posting_types: [],
    scan_index: 0,
    scanned_references: new Set(),
    secretary_control: null,
    current_page: 1,
    records_per_page: 25,

    // بيانات المحفظة النشطة
    active_batch_name: null,
    active_batch_title: '',
    active_batch_description: '',
    active_logo_emblem: '/files/a_archive.png',
    active_header_text_image: '/files/a_archive.png',
    active_judge_name: '',
    active_archive_date: '',
    active_archive_date_hijri: '',
    active_archive_year_hijri: '',
    active_archive_month_hijri: '',

    is_readonly_mode: false,
};

// =============================================================================
// DBE.UI — دوال الواجهة المساعدة (عدادات، تصفح، ترتيب)
// =============================================================================

var DBE = DBE || {};

DBE.UI = {
    // --- العدادات ---
    update_counter: function () {
        var total = 0, active = 0, archived = 0, missing = 0;
        $('#scanner-results-body tr').each(function () {
            var tr = $(this);
            if (tr.attr('id') === 'empty-row') return;
            total++;
            if (tr.hasClass('row-missing')) missing++;
            else if (tr.hasClass('row-archived')) archived++;
            else active++;
        });
        $('#counter-total').text(__('الإجمالي') + ': ' + total);
        $('#counter-active').text(__('المنظور') + ': ' + active);
        $('#counter-archived').text(__('المرحل') + ': ' + archived);
        $('#counter-missing').text(__('الغير موجود') + ': ' + missing);
    },

    // --- التصفح (Pagination) ---
    apply_pagination: function () {
        var rows = $('#scanner-results-body tr').not('#empty-row');
        var total_records = rows.length;

        if (total_records === 0) {
            $('#table-pagination-bar').hide();
            return;
        }
        $('#table-pagination-bar').css('display', 'flex');

        var is_all = (DBE.State.records_per_page === Infinity || isNaN(DBE.State.records_per_page));
        var total_pages = is_all ? 1 : Math.ceil(total_records / DBE.State.records_per_page);

        if (DBE.State.current_page > total_pages) DBE.State.current_page = total_pages || 1;
        if (DBE.State.current_page < 1) DBE.State.current_page = 1;

        var start_idx = is_all ? 1 : (DBE.State.current_page - 1) * DBE.State.records_per_page + 1;
        var end_idx = is_all ? total_records : Math.min(DBE.State.current_page * DBE.State.records_per_page, total_records);

        var idx = 1;
        rows.each(function () {
            var tr = $(this);
            tr.toggle(is_all || (idx >= start_idx && idx <= end_idx));
            idx++;
        });

        var page_info = is_all
            ? __('إجمالي') + ': <strong>' + total_records + '</strong> ' + __('سجل')
            : __('إجمالي') + ': <strong>' + total_records + '</strong> ' + __('سجل') + ' | ' + __('صفحة') + ' <strong>' + DBE.State.current_page + '</strong> ' + __('من') + ' <strong>' + total_pages + '</strong>';
        $('#pagination-info').html(page_info);

        $('#pagination-btn-prev').prop('disabled', is_all || DBE.State.current_page <= 1)
            .css({ opacity: (is_all || DBE.State.current_page <= 1) ? '0.5' : '1', cursor: (is_all || DBE.State.current_page <= 1) ? 'not-allowed' : 'pointer' });
        $('#pagination-btn-next').prop('disabled', is_all || DBE.State.current_page >= total_pages)
            .css({ opacity: (is_all || DBE.State.current_page >= total_pages) ? '0.5' : '1', cursor: (is_all || DBE.State.current_page >= total_pages) ? 'not-allowed' : 'pointer' });

        this.update_select_all_state();
    },

    update_select_all_state: function () {
        var visible = $('#scanner-results-body tr:visible .row-selector-checkbox');
        var checked = $('#scanner-results-body tr:visible .row-selector-checkbox:checked');
        $('#select-all-rows').prop('checked', visible.length > 0 && visible.length === checked.length);
    },

    // --- إعادة الفهرسة ---
    reindex_rows: function () {
        var current_row = 1;
        $('#scanner-results-body tr').each(function () {
            var tr = $(this);
            if (tr.attr('id') === 'empty-row') return;
            tr.find('td:nth-child(2)').text(current_row);
            tr.attr('id', 'scan-row-' + current_row);
            tr.find('.cell-input, .ref-edit-input').attr('data-row', current_row);
            current_row++;
        });
        DBE.State.scan_index = current_row - 1;
        this.apply_pagination();
    },

    // --- فحص الجدول الفارغ ---
    check_empty_table: function () {
        var rows = $('#scanner-results-body tr');
        if (rows.length === 0 || (rows.length === 1 && rows.attr('id') === 'empty-row')) {
            DBE.State.scan_index = 0;
            $('#scanner-results-body').html(
                '<tr id="empty-row"><td colspan="18" class="text-center text-muted" style="padding: 50px; font-size: 14px; text-align: center;">'
                + __('لا توجد ملفات حالياً. ابدأ بإدخال المرجع للبدء في التعديل السريع.')
                + '</td></tr>'
            );
        }
    },

    // --- تلوين خلية الحالة الجديدة ---
    update_new_status_cell_style: function (tr) {
        var new_status_cell = tr.find('.cell-input[data-fieldname="new_status"]');
        var posting_type_cell = tr.find('.cell-input[data-fieldname="posting_type"]');
        var current_sec_cell = tr.find('.cell-input[data-fieldname="current_secretary"]');
        var toggle_btn = tr.find('.btn-toggle-posting');
        if (!new_status_cell.length || !posting_type_cell.length) return;

        var new_status_val = new_status_cell.val().trim();
        var archived_style = { 'background-color': '#fff3e0', 'color': '#e65100', 'font-weight': 'bold' };
        var normal_style_dirty = { 'background-color': '#fffdeb', 'color': 'inherit', 'font-weight': 'normal' };
        var normal_style_clean = { 'background-color': 'transparent', 'color': 'inherit', 'font-weight': 'normal' };
        if (new_status_val === 'مرحل') {
            new_status_cell.css(archived_style);
            var current_post_val = posting_type_cell.val() ? posting_type_cell.val().trim() : '';
            if (!current_post_val || !DBE.State.posting_types.includes(current_post_val)) {
                var default_val = DBE.State.posting_types.includes('حفظ') ? 'حفظ' : (DBE.State.posting_types.length > 0 ? DBE.State.posting_types[0] : 'حفظ');
                posting_type_cell.val(default_val).addClass('is-dirty');
            }
            posting_type_cell.css(archived_style);
            if (current_sec_cell.length) current_sec_cell.css(archived_style);
            if (toggle_btn.length) {
                toggle_btn.prop('disabled', false).css({ opacity: '1', cursor: 'pointer', color: '#e67e22', 'border-color': '#e67e22', 'pointer-events': 'auto' });
            }
        } else {
            if (new_status_cell.hasClass('is-dirty')) new_status_cell.css(normal_style_dirty);
            else new_status_cell.css(normal_style_clean);

            var original_posting = posting_type_cell.data('original') || '';
            var current_post_val = posting_type_cell.val() ? posting_type_cell.val().trim() : '';
            if (DBE.State.posting_types.includes(current_post_val) && !DBE.State.posting_types.includes(original_posting)) {
                posting_type_cell.val(original_posting);
                if (original_posting === '') posting_type_cell.removeClass('is-dirty');
            }
            if (posting_type_cell.hasClass('is-dirty')) posting_type_cell.css(normal_style_dirty);
            else posting_type_cell.css(normal_style_clean);

            if (current_sec_cell.length) {
                if (current_sec_cell.hasClass('is-dirty')) current_sec_cell.css(normal_style_dirty);
                else current_sec_cell.css(normal_style_clean);
            }

            if (toggle_btn.length) {
                toggle_btn.prop('disabled', true).css({ opacity: '0.4', cursor: 'not-allowed', color: '#95a5a6', 'border-color': '#ccc', 'pointer-events': 'none' });
            }
        }
    },

    // --- تنسيق التركيز ---
    add_focus_styling: function () {
        $('.cell-input').off('focus blur').on('focus', function () {
            var input = $(this);
            if (input.hasClass('is-dirty')) input.css({ 'background-color': '#fffbeb', 'box-shadow': 'inset 0 0 0 1.5px #f59e0b' });
            else input.css({ 'background-color': '#fff', 'box-shadow': 'inset 0 0 0 1.5px #2980b9' });
        }).on('blur', function () {
            var input = $(this);
            if (input.hasClass('is-dirty')) input.css({ 'background-color': '#fffbeb', 'box-shadow': 'none' });
            else input.css({ 'background-color': 'transparent', 'box-shadow': 'none' });
        });
    },

    // --- جلب اسم رئيس المحكمة ---
    get_chief_justice_name: function (callback) {
        frappe.call({
            method: 'frappe.client.get_list',
            args: { doctype: 'Judicial Employee', filters: { chief_justice: 1 }, fields: ['name'], limit_page_length: 1 },
            callback: function (r) {
                callback(r.message && r.message.length ? r.message[0].name : '');
            },
            error: function () { callback(''); }
        });
    },

    // --- منتقي التاريخ (air-datepicker) ---
    init_date_pickers: function () {
        $('.date-picker-wrapper').each(function () {
            var $wrapper = $(this);
            var $input = $wrapper.find('.date-input');

            if ($input.hasClass('date-picker-initialized')) return;
            $input.addClass('date-picker-initialized');

            var userFormat = (frappe.boot.sysdefaults && frappe.boot.sysdefaults.date_format) || 'yyyy-mm-dd';

            $input.datepicker({
                language: frappe.boot.lang || 'en',
                dateFormat: userFormat,
                autoClose: true,
                todayButton: true,
                changeMonth: true,
                changeYear: true,
                onSelect: function (formattedDate, date, inst) {
                    if (date) {
                        var sysDate = moment(date).format('YYYY-MM-DD');
                        var userDate = frappe.datetime.str_to_user(sysDate);
                        $input.val(userDate);
                        $input.data('sys-date', sysDate);
                        $input.trigger('change');
                    } else if (formattedDate === '') {
                        $input.val('');
                        $input.data('sys-date', '');
                        $input.trigger('change');
                    }
                }
            });

            $input.on('input', function () {
                if ($(this).val().trim() === '') {
                    $(this).data('sys-date', '');
                }
            });
        });
    },
};

// =============================================================================
// DBE.Grid — إدارة الجدول (إضافة، بحث، تعديل، حذف)
// =============================================================================

var DBE = DBE || {};

DBE.Grid = {
    // --- تعليم المسودة على أنها غير محفوظة ---
    mark_batch_as_dirty: function () {
        if (DBE.State.is_readonly_mode) return;
        $('#scanner-btn-post').hide();
        $('#action-save-draft').css('display', 'flex');
        $('#li-print, #li-print-all, #separator-print').hide();
        $('#li-edit-batch, #separator-edit-batch').hide();
        $('#btn-delete-archive').hide();
    },

    // --- البحث عن ملف وإضافته ---
    perform_search: function () {
        var reference = $('#scanner-reference-input').val();
        if (!reference) {
            frappe.show_alert({ message: __('الرجاء كتابة رقم المرجع للبحث.'), indicator: 'orange' });
            $('#scanner-reference-input').focus();
            return;
        }
        reference = reference.trim();

        if (DBE.State.scanned_references.has(reference)) {
            frappe.show_alert({ message: __('هذا الملف مضاف بالفعل في الجدول!'), indicator: 'red' });
            $('#scanner-reference-input').val('').focus();
            return;
        }

        frappe.call({
            method: 'judicial_files.judicial_files.page.dispute_batch_editor_v2.dispute_batch_editor_v2.get_dispute_file',
            args: { reference: reference },
            callback: function (r) {
                if (r.message) {
                    DBE.Grid.add_row_to_grid(r.message, true);
                    DBE.State.scanned_references.add(reference);
                    frappe.show_alert({ message: __('تم العثور على الملف وجلب بياناته بنجاح.'), indicator: 'green' });
                } else {
                    DBE.Grid.add_row_to_grid({
                        name: '', reference: reference, file_number: '', year: '',
                        petitioner: '', respondent: '', judge: '',
                        secretary: '', current_secretary: '',
                        execution_file_no: '',
                        status: '', posting_type: '', archive_month_hijri: ''
                    }, false);
                    DBE.State.scanned_references.add(reference);
                    frappe.show_alert({ message: __('الملف غير موجود! تم إضافته كصف فارغ بلون أحمر لإنشائه وتعبئته.'), indicator: 'red' });
                }
                $('#scanner-reference-input').val('').focus();
            }
        });
    },

    // --- إضافة صف للجدول ---
    add_row_to_grid: function (file, exists) {
        $('#empty-row').remove();
        DBE.State.scan_index++;

        file.original_current_secretary = file.original_current_secretary !== undefined
            ? file.original_current_secretary : (file.current_secretary || '');

        var selected_assistant = DBE.State.secretary_control ? DBE.State.secretary_control.get_value() : '';
        if (selected_assistant && file.status === 'منظور') {
            file.current_secretary = selected_assistant;
        }

        var file_link_html = exists
            ? '<span class="ref-text">' + frappe.utils.escape_html(file.reference) + '</span>'
            : '<div class="ref-edit-wrap"><input type="text" class="ref-edit-input" value="'
                + frappe.utils.escape_html(file.reference || '')
                + '" data-row="' + DBE.State.scan_index
                + '" data-original-ref="' + frappe.utils.escape_html(file.reference || '')
                + '" placeholder="' + __('اكتب وصحح المرجع واضغط Enter...') + '"></div>';

        var new_status_val = (file.status === 'منظور') ? 'مرحل' : '';

        var row_class = !exists ? 'row-missing' : (file.status === 'مرحل' ? 'row-archived' : '');
        var readonly_attr = exists ? 'readonly' : '';
        var input_style = 'cell-input';

        var posting_type_options = '';
        DBE.State.posting_types.forEach(function (pt) {
            posting_type_options += '<option value="' + pt + '" ' + (file.posting_type === pt ? 'selected' : '') + '>' + pt + '</option>';
        });

        var current_sec_val = file.current_secretary || '';
        var current_sec_dirty = (current_sec_val !== file.original_current_secretary) ? 'is-dirty' : '';
        var current_sec_style = (current_sec_val !== file.original_current_secretary) ? 'background-color: #fffbeb; font-weight: bold;' : '';

        var row_html = '<tr id="scan-row-' + DBE.State.scan_index + '" class="' + row_class + '">'
            + '<td class="sticky-col-right-1 td-center">'
            + '<input type="checkbox" class="row-selector-checkbox" title="' + __('تحديد هذا الصف') + '"></td>'
            + '<td class="sticky-col-right-2 td-center td-index">' + DBE.State.scan_index + '</td>'
            + '<td class="sticky-col-right-3 td-ref">' + file_link_html + '</td>'
            + '<td class="td-cell"><input type="text" class="' + input_style + '" value="' + (file.file_number || '') + '" data-original="' + (file.file_number || '') + '" data-row="' + DBE.State.scan_index + '" data-col="1" data-docname="' + (file.name || '') + '" data-fieldname="file_number" ' + readonly_attr + '></td>'
            + '<td class="td-cell"><input type="text" class="' + input_style + '" value="' + (file.year || '') + '" data-original="' + (file.year || '') + '" data-row="' + DBE.State.scan_index + '" data-col="2" data-docname="' + (file.name || '') + '" data-fieldname="year" ' + readonly_attr + '></td>'
            + '<td class="td-cell"><input type="text" class="' + input_style + '" value="' + (file.petitioner || '') + '" data-original="' + (file.petitioner || '') + '" data-row="' + DBE.State.scan_index + '" data-col="3" data-docname="' + (file.name || '') + '" data-fieldname="petitioner" ' + readonly_attr + '></td>'
            + '<td class="td-cell"><input type="text" class="' + input_style + '" value="' + (file.respondent || '') + '" data-original="' + (file.respondent || '') + '" data-row="' + DBE.State.scan_index + '" data-col="4" data-docname="' + (file.name || '') + '" data-fieldname="respondent" ' + readonly_attr + '></td>'
            + '<td class="td-cell"><input type="text" class="' + input_style + '" value="' + (file.judge || '') + '" data-original="' + (file.judge || '') + '" data-row="' + DBE.State.scan_index + '" data-col="5" data-docname="' + (file.name || '') + '" data-fieldname="judge" ' + readonly_attr + '></td>'
            + '<td class="td-cell"><input type="text" class="' + input_style + '" value="' + (file.secretary || '') + '" data-original="' + (file.secretary || '') + '" data-row="' + DBE.State.scan_index + '" data-col="6" data-docname="' + (file.name || '') + '" data-fieldname="secretary" ' + readonly_attr + '></td>'
            + '<td class="td-cell"><input type="text" class="' + input_style + ' ' + current_sec_dirty + '" value="' + current_sec_val + '" data-original="' + (file.original_current_secretary || '') + '" data-row="' + DBE.State.scan_index + '" data-col="7" data-docname="' + (file.name || '') + '" data-fieldname="current_secretary" style="' + current_sec_style + '" ' + readonly_attr + '></td>'
            + '<td class="td-cell"><input type="text" class="' + input_style + '" value="' + (file.status || '') + '" data-original="' + (file.status || '') + '" data-row="' + DBE.State.scan_index + '" data-col="8" data-docname="' + (file.name || '') + '" data-fieldname="status" ' + readonly_attr + '></td>'
            + '<td class="td-cell"><input type="text" class="' + input_style + '" value="' + new_status_val + '" data-original="' + new_status_val + '" data-row="' + DBE.State.scan_index + '" data-col="9" data-docname="' + (file.name || '') + '" data-fieldname="new_status" ' + readonly_attr + '></td>'
            + '<td class="td-cell"><select class="' + input_style + '" data-original="' + (file.posting_type || '') + '" data-row="' + DBE.State.scan_index + '" data-col="10" data-docname="' + (file.name || '') + '" data-fieldname="posting_type" ' + readonly_attr + '><option value=""></option>' + posting_type_options + '</select></td>'
            + '<td class="td-cell"><input type="text" class="' + input_style + '" value="' + (file.execution_file_no || '') + '" data-original="' + (file.execution_file_no || '') + '" data-row="' + DBE.State.scan_index + '" data-col="11" data-docname="' + (file.name || '') + '" data-fieldname="execution_file_no" readonly style="cursor:default;"></td>'
            + '<td class="td-cell date-picker-wrapper"><input type="text" data-fieldtype="Date" class="' + input_style + ' date-input" value="' + frappe.datetime.str_to_user(file.archive_date || '') + '" data-sys-date="' + (file.archive_date || '') + '" data-original="' + (file.archive_date || '') + '" data-row="' + DBE.State.scan_index + '" data-col="12" data-docname="' + (file.name || '') + '" data-fieldname="archive_date" ' + readonly_attr + '></td>'
            + '<td class="td-cell"><input type="text" class="' + input_style + '" value="' + (file.archive_year_hijri || '') + '" data-original="' + (file.archive_year_hijri || '') + '" data-row="' + DBE.State.scan_index + '" data-col="13" data-docname="' + (file.name || '') + '" data-fieldname="archive_year_hijri" ' + readonly_attr + '></td>'
            + '<td class="td-cell"><input type="text" class="' + input_style + '" value="' + (file.archive_month_hijri || '') + '" data-original="' + (file.archive_month_hijri || '') + '" data-row="' + DBE.State.scan_index + '" data-col="14" data-docname="' + (file.name || '') + '" data-fieldname="archive_month_hijri" ' + readonly_attr + '></td>'
            + '<td class="sticky-col-left" style="vertical-align:middle;text-align:center;white-space:nowrap;padding:2px 4px;width:75px;min-width:75px;max-width:75px;">'
            + '<button class="btn-toggle-posting" ' + (DBE.State.is_readonly_mode ? 'disabled' : '') + ' title="' + __('تحويل نوع الترحيل') + '" style="padding:1px 4px;border-radius:3px;border:1px solid #ccc;color:#95a5a6;background:transparent;cursor:' + (DBE.State.is_readonly_mode ? 'not-allowed' : 'pointer') + ';opacity:' + (DBE.State.is_readonly_mode ? '0.4' : '1') + ';margin-left:2px;font-size:10px;vertical-align:middle;"><i class="fa fa-exchange" style="font-size:10px;"></i></button>'
            + '<button class="btn-delete-row" title="' + __('حذف') + '" style="padding:1px 4px;border-radius:3px;border:1px solid #e74c3c;color:#e74c3c;background:transparent;cursor:pointer;font-size:10px;vertical-align:middle;"><i class="fa fa-trash" style="font-size:10px;"></i></button></td>'
            + '</tr>';

        $('#scanner-results-body').prepend(row_html);
        var new_tr = $('#scanner-results-body tr:first-child');
        DBE.UI.update_new_status_cell_style(new_tr);

        DBE.State.current_page = 1;
        DBE.UI.reindex_rows();
        DBE.UI.update_counter();
        DBE.UI.add_focus_styling();
        DBE.UI.init_date_pickers();
        this.mark_batch_as_dirty();

        if (!exists) {
            setTimeout(function () {
                $('#scanner-results-body tr:first-child .ref-edit-input').focus().select();
            }, 150);
        }
    },

    // --- إعادة البحث عن مرجع صف ---
    research_row_reference: function (tr) {
        var input = tr.find('.ref-edit-input');
        if (!input.length) return;
        var new_ref = input.val().trim();
        if (!new_ref) {
            frappe.show_alert({ message: __('الرجاء كتابة مرجع صالح.'), indicator: 'orange' });
            input.focus();
            return;
        }

        var old_ref = input.attr('data-original-ref') || '';
        var duplicate = false;
        $('#scanner-results-body tr').each(function () {
            var other_tr = $(this);
            if (other_tr.is(tr) || other_tr.attr('id') === 'empty-row') return;
            var other_ref = other_tr.find('.ref-edit-input').length
                ? other_tr.find('.ref-edit-input').val().trim()
                : other_tr.find('td:nth-child(3)').text().trim();
            if (other_ref === new_ref) duplicate = true;
        });
        if (duplicate) {
            frappe.show_alert({ message: __('هذا المرجع الجديد مضاف بالفعل في سطر آخر بالجدول!'), indicator: 'red' });
            input.focus();
            return;
        }

        input.prop('disabled', true).css({ opacity: '0.5', cursor: 'wait' });
        frappe.call({
            method: 'judicial_files.judicial_files.page.dispute_batch_editor_v2.dispute_batch_editor_v2.get_dispute_file',
            args: { reference: new_ref },
            callback: function (r) {
                input.prop('disabled', false).css({ opacity: '1', cursor: 'text' });
                if (r.message) {
                    var file = r.message;
                    if (old_ref) DBE.State.scanned_references.delete(old_ref);
                    DBE.State.scanned_references.add(new_ref);
                    tr.find('td:nth-child(3)').html('<span class="ref-text">' + frappe.utils.escape_html(file.reference) + '</span>');
                    tr.find('.cell-input').each(function () {
                        var cell = $(this);
                        var fieldname = cell.data('fieldname');
                        if (fieldname) {
                            var val = (fieldname === 'new_status') ? (file.status === 'منظور' ? 'مرحل' : '') : (file[fieldname] || '');
                            cell.val(val).data('original', val).attr('data-original', val)
                                .data('docname', file.name).attr('data-docname', file.name)
                                .prop('readonly', true).css('cursor', 'default');
                        }
                    });
                    tr.find('.cell-input').removeClass('is-dirty').css('background-color', 'transparent');
                    tr.removeClass('row-missing');
                    if (file.status === 'مرحل') tr.addClass('row-archived');
                    else tr.removeClass('row-archived');
                    DBE.UI.update_new_status_cell_style(tr);
                    frappe.show_alert({ message: __('رائع! تم العثور على المرجع وجلب بيانات الملف بالكامل.'), indicator: 'green' });
                    setTimeout(function () { $('#scanner-reference-input').focus().select(); }, 150);
                } else {
                    if (old_ref !== new_ref) {
                        if (old_ref) DBE.State.scanned_references.delete(old_ref);
                        DBE.State.scanned_references.add(new_ref);
                        input.attr('data-original-ref', new_ref);
                    }
                    frappe.show_alert({ message: __('لم يتم العثور على المرجع الجديد أيضاً.'), indicator: 'red' });
                }
                DBE.UI.update_counter();
            }
        });
    },

    // --- الحذف المنطقي للصف ---
    delete_row_logic: function (row) {
        var ref = row.find('.ref-edit-input').length
            ? row.find('.ref-edit-input').val().trim()
            : row.find('td:nth-child(3)').text().trim();
        if (ref) DBE.State.scanned_references.delete(ref);
        row.remove();
        this.mark_batch_as_dirty();
    },

    // --- بحث في الصفوف المفقودة ---
    trigger_row_search_lookup: function (tr) {
        var file_number = tr.find('.cell-input[data-fieldname="file_number"]').val().trim();
        var year = tr.find('.cell-input[data-fieldname="year"]').val().trim();
        var petitioner = tr.find('.cell-input[data-fieldname="petitioner"]').val().trim();
        var respondent = tr.find('.cell-input[data-fieldname="respondent"]').val().trim();

        if (!file_number && !year && !petitioner && !respondent) {
            frappe.show_alert({ message: __('الرجاء كتابة أي بيان للبحث.'), indicator: 'orange' });
            return;
        }

        frappe.call({
            method: 'judicial_files.judicial_files.page.dispute_batch_editor_v2.dispute_batch_editor_v2.search_dispute_files',
            args: { file_number: file_number, year: year, petitioner: petitioner, respondent: respondent },
            callback: function (r) {
                if (r.message && r.message.length > 0) {
                    if (r.message.length === 1) {
                        DBE.Grid.populate_tr_with_file(tr, r.message[0]);
                    } else {
                        DBE.Grid.show_selection_dialog(tr, r.message);
                    }
                } else {
                    frappe.show_alert({ message: __('لم يتم العثور على ملفات مطابقة.'), indicator: 'red' });
                }
            }
        });
    },

    // --- تعبئة صف ببيانات ملف ---
    populate_tr_with_file: function (tr, file) {
        var input = tr.find('.ref-edit-input');
        var old_ref = input.length ? (input.attr('data-original-ref') || '') : tr.find('td:nth-child(3)').text().trim();
        if (old_ref) DBE.State.scanned_references.delete(old_ref);
        DBE.State.scanned_references.add(file.reference);

        tr.find('td:nth-child(3)').html('<span class="ref-text">' + frappe.utils.escape_html(file.reference) + '</span>');
        tr.find('.cell-input').each(function () {
            var cell = $(this);
            var fieldname = cell.data('fieldname');
            if (fieldname) {
                var val = (fieldname === 'new_status') ? (file.status === 'منظور' ? 'مرحل' : '') : (file[fieldname] || '');
                cell.val(val).data('original', val).attr('data-original', val)
                    .data('docname', file.name).attr('data-docname', file.name)
                    .prop('readonly', true).css('cursor', 'default');
            }
        });
        tr.find('.cell-input').removeClass('is-dirty').css('background-color', 'transparent');
        tr.removeClass('row-missing');
        if (file.status === 'مرحل') tr.addClass('row-archived');
        else tr.removeClass('row-archived');
        DBE.UI.update_new_status_cell_style(tr);
        DBE.UI.update_counter();
        frappe.show_alert({ message: __('تم جلب بيانات الملف وتحديث الجدول بنجاح!'), indicator: 'green' });
        setTimeout(function () { $('#scanner-reference-input').focus().select(); }, 150);
    },

    // --- حوار اختيار ملف من نتائج البحث ---
    show_selection_dialog: function (tr, files) {
        var tbody_html = '';
        files.forEach(function (f, idx) {
            tbody_html += '<tr data-index="' + idx + '" style="cursor:pointer;">'
                + '<td style="font-weight:bold;color:#2980b9;">' + frappe.utils.escape_html(f.reference) + '</td>'
                + '<td>' + (f.file_number || '') + '</td>'
                + '<td>' + (f.year || '') + '</td>'
                + '<td>' + (f.petitioner || '') + '</td>'
                + '<td>' + (f.respondent || '') + '</td></tr>';
        });

        var dialog = new frappe.ui.Dialog({
            title: __('نتائج البحث المطابقة'),
            fields: [{
                fieldtype: 'HTML',
                fieldname: 'results_html',
                options: '<div style="max-height:350px;overflow-y:auto;direction:rtl;text-align:right;">'
                    + '<p style="font-size:13px;color:#7f8c8d;margin-bottom:15px;"><i class="fa fa-info-circle"></i> ' + __('انقر فوق الملف المطلوب:') + '</p>'
                    + '<table class="table table-bordered table-hover" id="dialog-lookup-table" style="font-size:12px;width:100%;direction:rtl;text-align:right;">'
                    + '<thead><tr style="background:#f8f9fa;"><th>' + __('المرجع') + '</th><th>' + __('رقم الملف') + '</th><th>' + __('السنة') + '</th><th>' + __('المدعي') + '</th><th>' + __('المدعى عليه') + '</th></tr></thead>'
                    + '<tbody>' + tbody_html + '</tbody>'
                    + '</table></div>'
            }],
            primary_action_label: __('إغلاق'),
            primary_action: function () { dialog.hide(); }
        });
        dialog.show();

        $(document).off('click', '#dialog-lookup-table tbody tr').on('click', '#dialog-lookup-table tbody tr', function () {
            var idx = $(this).data('index');
            if (files[idx]) DBE.Grid.populate_tr_with_file(tr, files[idx]);
            dialog.hide();
        });
    },

    // --- حفظ التعديلات السريعة ---
    save_all_changes: function () {
        var selected_assistant = DBE.State.secretary_control ? DBE.State.secretary_control.get_value() : '';
        if (!selected_assistant) {
            frappe.show_alert({ message: __('يرجى تحديد أمين السر من الحقل العلوي أولاً.'), indicator: 'red' });
            if (DBE.State.secretary_control && DBE.State.secretary_control.wrapper) {
                DBE.State.secretary_control.wrapper.find('input').focus();
            }
            return;
        }

        var changes = [];
        $('#scanner-results-body tr').each(function () {
            var tr = $(this);
            if (tr.attr('id') === 'empty-row') return;
            var original_status = tr.find('.cell-input[data-fieldname="status"]').val() || '';
            if (original_status !== 'منظور') return;

            var name = tr.find('.cell-input:first').data('docname');
            var reference_text = tr.find('.ref-edit-input').length
                ? tr.find('.ref-edit-input').val().trim()
                : tr.find('td:nth-child(3)').text().trim();

            changes.push({
                name: name || '',
                reference: reference_text,
                current_secretary: selected_assistant,
                new_status: tr.find('.cell-input[data-fieldname="new_status"]').val(),
                new_status: tr.find('.cell-input[data-fieldname="new_status"]').val(),
                posting_type: tr.find('.cell-input[data-fieldname="posting_type"]').val()
            });
        });

        if (changes.length === 0) {
            frappe.show_alert({ message: __('لا توجد تعديلات قابلة للحفظ.'), indicator: 'orange' });
            return;
        }

        frappe.confirm(__('هل أنت متأكد من إتمام عملية حفظ لعدد ({0}) سجلات؟', [changes.length]), function () {
            frappe.call({
                method: 'judicial_files.judicial_files.page.dispute_batch_editor_v2.dispute_batch_editor_v2.save_grid_changes',
                args: { changes: JSON.stringify(changes) },
                freeze: true,
                freeze_message: __('جاري الحفظ...'),
                callback: function (r) {
                    if (r.message) {
                        frappe.show_alert({ message: __('تم حفظ جميع التعديلات بنجاح.'), indicator: 'green' });
                        setTimeout(function () { location.reload(); }, 1000);
                    } else {
                        frappe.show_alert({ message: __('حدث خطأ أثناء محاولة حفظ التعديلات!'), indicator: 'red' });
                    }
                }
            });
        });
    },

    // --- التعيين التلقائي لأمين السر الحالي ---
    apply_auto_current_secretary_assignment: function (secretary_name) {
        if (!secretary_name) return;
        $('#scanner-results-body tr').each(function () {
            var tr = $(this);
            if (tr.attr('id') === 'empty-row') return;
            var status_val = tr.find('.cell-input[data-fieldname="status"]').val() || '';
            if (status_val === 'منظور') {
                var cell = tr.find('.cell-input[data-fieldname="current_secretary"]');
                if (cell.length && cell.val() !== secretary_name) {
                    cell.val(secretary_name).addClass('is-dirty').css({ 'background-color': '#fffbeb', 'font-weight': 'bold' });
                }
            }
        });
    },

    // --- تطبيق تاريخ الأرشفة التلقائي ---
    apply_auto_archive_date: function (archive_date) {
        if (!archive_date) return;
        judicial_files.utils.get_hijri_date(archive_date).then(function (hijri) {
            if (!hijri) return;
            DBE.State.active_archive_date = archive_date;
            DBE.State.active_archive_date_hijri = hijri.date || '';
            DBE.State.active_archive_year_hijri = hijri.year ? hijri.year.toString() : '';
            DBE.State.active_archive_month_hijri = hijri.month_name || '';

            $('#scanner-results-body tr').each(function () {
                var tr = $(this);
                if (tr.attr('id') === 'empty-row') return;
                ['archive_date', 'archive_year_hijri', 'archive_month_hijri'].forEach(function (fn) {
                    var cell = tr.find('.cell-input[data-fieldname="' + fn + '"]');
                    if (cell.length) {
                        var v = DBE.State['active_' + fn] || '';
                        if (fn === 'archive_date') {
                            cell.val(frappe.datetime.str_to_user(v)).data('sys-date', v).addClass('is-dirty').css({ 'background-color': '#fffbeb', 'font-weight': 'bold' });
                        } else {
                            cell.val(v).addClass('is-dirty').css({ 'background-color': '#fffbeb', 'font-weight': 'bold' });
                        }
                    }
                });
            });
            DBE.Grid.mark_batch_as_dirty();
        }).catch(function () {
            frappe.show_alert({ message: __('فشل تحويل تاريخ الأرشيف إلى هجري.'), indicator: 'red' });
        });
    },
};

// =============================================================================
// DBE.Batch — إدارة الأرشفة (حفظ، تحميل، ترحيل)
// =============================================================================

var DBE = DBE || {};

DBE.Batch = {
    // --- تجميع بيانات الجدول ---
    collect_current_grid_items: function () {
        var items = [];
        $('#scanner-results-body tr').each(function () {
            var tr = $(this);
            if (tr.attr('id') === 'empty-row') return;
            var ref_input = tr.find('.ref-edit-input');
            var reference = ref_input.length ? ref_input.val().trim() : tr.find('td:nth-child(3)').text().trim();
            items.push({
                reference: reference,
                dispute_file: tr.find('.cell-input[data-fieldname="file_number"]').data('docname') || '',
                file_number: tr.find('.cell-input[data-fieldname="file_number"]').val() || '',
                year: tr.find('.cell-input[data-fieldname="year"]').val() || '',
                petitioner: tr.find('.cell-input[data-fieldname="petitioner"]').val() || '',
                respondent: tr.find('.cell-input[data-fieldname="respondent"]').val() || '',
                judge: tr.find('.cell-input[data-fieldname="judge"]').val() || '',
                original_secretary: tr.find('.cell-input[data-fieldname="secretary"]').val() || '',
                current_secretary: tr.find('.cell-input[data-fieldname="current_secretary"]').val() || '',
                execution_file_no: tr.find('.cell-input[data-fieldname="execution_file_no"]').val() || '',
                original_status: tr.find('.cell-input[data-fieldname="status"]').val() || '',
                new_status: tr.find('.cell-input[data-fieldname="new_status"]').val() || '',
                posting_type: tr.find('.cell-input[data-fieldname="posting_type"]').val() || '',
                archive_date: tr.find('.cell-input[data-fieldname="archive_date"]').data('sys-date') || tr.find('.cell-input[data-fieldname="archive_date"]').val() || '',
                archive_year_hijri: tr.find('.cell-input[data-fieldname="archive_year_hijri"]').val() || '',
                archive_month_hijri: tr.find('.cell-input[data-fieldname="archive_month_hijri"]').val() || ''
            });
        });
        return items;
    },

    // --- مسح الجدول ---
    clear_grid: function () {
        $('#scanner-results-body').html('<tr id="empty-row"><td colspan="18" class="text-center text-muted" style="padding: 60px; font-size: 14px; text-align: center;">'
            + __('لا توجد ملفات حالياً. ابدأ بإدخال المرجع للبدء في التعديل السريع.') + '</td></tr>');
        DBE.State.scan_index = 0;
        DBE.State.scanned_references = new Set();
        DBE.State.active_batch_name = null;
        DBE.State.active_batch_title = '';
        DBE.State.active_batch_description = '';
        DBE.State.active_logo_emblem = '';
        DBE.State.active_header_text_image = '';
        DBE.State.active_judge_name = '';
        DBE.State.active_archive_month_hijri = '';
        DBE.State.is_readonly_mode = false;
        DBE.UI.update_counter();
        $('#table-pagination-bar').hide();
        $('#active-batch-indicator').remove();
        $('#scanner-reference-input').prop('disabled', false);
        $('#scanner-btn-post').prop('disabled', false).css({ opacity: '1', display: 'flex' });
        $('#action-save-draft').hide();
        $('#li-print, #li-print-all, #separator-print').hide();
        $('#li-edit-batch, #separator-edit-batch').hide();
        $('#btn-delete-archive').hide();
    },

    // --- مؤشر المحفظة النشطة ---
    update_batch_indicator: function (title, is_posted, mode_label) {
        $('#active-batch-indicator').remove();
        console.log('[DBE] update_batch_indicator — title:', title, 'is_posted:', is_posted, 'mode_label:', mode_label);
        if (!title) return;
        var color = '#27ae60';
        var icon = 'fa-archive';
        var label = __('مرحل — للاستعراض فقط');
        if (mode_label === 'تعديل') {
            color = '#e67e22';
            icon = 'fa-pencil-square-o';
            label = __('تعديل أرشيف مرحل');
        } else if (!is_posted) {
            color = '#e67e22';
            icon = 'fa-pencil-square-o';
            label = __('مسودة نشطة');
        }
        var html = '<div id="active-batch-indicator" style="display:inline-flex;align-items:center;gap:6px;background:' + color + '18;border:1px solid ' + color + '55;border-radius:6px;padding:4px 12px;font-size:11px;color:' + color + ';font-weight:bold;direction:rtl;margin-right:8px;">'
            + '<i class="fa ' + icon + '"></i>'
            + '<span>' + frappe.utils.escape_html(title) + '</span>'
            + '<span style="opacity:0.7;font-weight:normal;">— ' + label + '</span></div>';
        $('.counter-badges-container').after(html);
        $('#li-print, #li-print-all, #separator-print').show();
        if (is_posted) $('#li-edit-batch, #separator-edit-batch').hide();
        else $('#li-edit-batch, #separator-edit-batch').show();
    },

    // --- تحميل بيانات محفظة ---
    load_batch_into_grid: function (batch_data, readonly) {
        this.clear_grid();
        DBE.State.is_readonly_mode = !!readonly;
        DBE.State.active_batch_name = batch_data.name;
        DBE.State.active_batch_title = batch_data.title || '';
        DBE.State.active_batch_description = batch_data.description || '';
        DBE.State.active_logo_emblem = batch_data.logo_emblem || '';
        DBE.State.active_header_text_image = batch_data.header_text_image || '';
        DBE.State.active_judge_name = batch_data.judge_name || '';
        DBE.State.active_archive_month_hijri = batch_data.archive_month_hijri || '';
        DBE.State.active_archive_date = '';
        DBE.State.active_archive_date_hijri = '';
        DBE.State.active_archive_year_hijri = '';

        (batch_data.items || []).forEach(function (item, idx) {
            if (idx === 0 && item.archive_date) {
                DBE.State.active_archive_date = item.archive_date;
                DBE.State.active_archive_date_hijri = item.archive_date_hijri || '';
                DBE.State.active_archive_year_hijri = item.archive_year_hijri || '';
                DBE.State.active_archive_month_hijri = item.archive_month_hijri || DBE.State.active_archive_month_hijri;
            }
            var file_obj = {
                name: item.dispute_file || '',
                reference: item.reference,
                file_number: item.file_number || '',
                year: item.year || '',
                petitioner: item.petitioner || '',
                respondent: item.respondent || '',
                judge: item.judge || '',
                secretary: item.secretary || item.original_secretary || '',
                current_secretary: item.current_secretary || '',
                original_current_secretary: item.current_secretary || '',
                execution_file_no: item.execution_file_no || '',
                status: item.original_status || '',
                posting_type: item.posting_type || '',
                archive_date: item.archive_date || '',
                archive_year_hijri: item.archive_year_hijri || '',
                archive_month_hijri: item.archive_month_hijri || ''
            };
            DBE.Grid.add_row_to_grid(file_obj, !!item.dispute_file);
            DBE.State.scanned_references.add(item.reference);
        });

        if (DBE.State.is_readonly_mode) {
            $('#scanner-results-body .cell-input').prop('readonly', true).css('cursor', 'default');
            $('#scanner-reference-input').prop('disabled', true);
            $('#scanner-btn-post').prop('disabled', true).css('opacity', '0.5');
            $('#scanner-results-body .btn-toggle-posting').prop('disabled', true).css({ cursor: 'not-allowed', opacity: '0.4' });
            $('#scanner-secretary-container input').prop('disabled', true).css('cursor', 'not-allowed');
            frappe.show_alert({ message: __('وضع الاستعراض: هذا الأرشيف مرحل ولا يمكن تعديله.'), indicator: 'blue' });
            $('#btn-delete-archive').hide();
        } else {
            $('#btn-delete-archive').css('display', 'inline-flex');
        }
        this.update_batch_indicator(batch_data.title, DBE.State.is_readonly_mode);
    },

    // --- حفظ كمسودة ---
    action_save_draft: function () {
        if (DBE.State.is_readonly_mode) {
            frappe.show_alert({ message: __('لا يمكن الحفظ في وضع الاستعراض.'), indicator: 'red' });
            return;
        }
        var items = this.collect_current_grid_items();
        if (items.length === 0) {
            frappe.show_alert({ message: __('الجدول فارغ! أضف سجلات أولاً.'), indicator: 'orange' });
            return;
        }
        if (DBE.State.active_batch_name) {
            this._do_save_draft(DBE.State.active_batch_name, DBE.State.active_batch_title,
                DBE.State.active_batch_description, DBE.State.active_logo_emblem,
                DBE.State.active_header_text_image, DBE.State.active_judge_name,
                DBE.State.active_archive_date, DBE.State.active_archive_date_hijri,
                DBE.State.active_archive_year_hijri, DBE.State.active_archive_month_hijri, items);
            return;
        }
        this._show_batch_title_dialog(DBE.State.active_batch_title, DBE.State.active_batch_description,
            DBE.State.active_logo_emblem, DBE.State.active_header_text_image,
            DBE.State.active_judge_name, DBE.State.active_archive_date,
            DBE.State.active_archive_date_hijri, DBE.State.active_archive_year_hijri,
            DBE.State.active_archive_month_hijri,
            function (title, desc, logo, header, judge, ad, adh, ayh, month) {
                DBE.State.active_archive_date = ad || DBE.State.active_archive_date;
                DBE.State.active_archive_date_hijri = adh || DBE.State.active_archive_date_hijri;
                DBE.State.active_archive_year_hijri = ayh || DBE.State.active_archive_year_hijri;
                DBE.State.active_archive_month_hijri = month || DBE.State.active_archive_month_hijri;
                DBE.Batch._do_save_draft(DBE.State.active_batch_name, title, desc, logo, header, judge, ad, adh, ayh, month, items);
            });
    },

    // --- حوار عنوان المحفظة ---
    _show_batch_title_dialog: function (def_title, def_desc, def_logo, def_header, def_judge, def_ad, def_adh, def_ayh, def_month, on_confirm) {
        function _set_title_from(dialog, month, year) {
            var base = 'ارشيف ملفات منازعات التنفيذ شهر';
            var sec = DBE.State.secretary_control ? DBE.State.secretary_control.get_value() : '';
            if (month && year) {
                dialog.set_value('title', base + ' ' + month + ' لعام ' + year + ' هـ' + (sec ? ' - أمين السر: ' + sec : ''));
            } else if (def_title && !def_ad) {
                dialog.set_value('title', def_title);
            } else {
                dialog.set_value('title', base);
            }
        }

        var dialog = new frappe.ui.Dialog({
            title: __('بيانات وحفظ محفظة الأرشيف'),
            fields: [
                { fieldtype: 'Data', fieldname: 'title', label: __('عنوان المحفظة'), reqd: 1, read_only: 1, default: def_title || 'ارشيف ملفات منازعات التنفيذ شهر' },
                { fieldtype: 'Date', fieldname: 'archive_date', label: __('تاريخ الأرشفة ميلادي'), reqd: 1, default: def_ad || DBE.State.active_archive_date || '', onchange: function () {
                    var value = this.get_value();
                    if (!value) { dialog.set_value('archive_date_hijri', ''); dialog.set_value('archive_year_hijri', ''); dialog.set_value('archive_month_hijri', ''); dialog.set_value('title', 'ارشيف ملفات منازعات التنفيذ شهر'); return; }
                    judicial_files.utils.get_hijri_date(value).then(function (hijri) {
                        if (hijri) {
                            dialog.set_value('archive_date_hijri', hijri.date || '');
                            dialog.set_value('archive_year_hijri', hijri.year ? hijri.year.toString() : '');
                            dialog.set_value('archive_month_hijri', hijri.month_name || '');
                            DBE.Grid.apply_auto_archive_date(value);
                            _set_title_from(dialog, hijri.month_name || '', hijri.year ? hijri.year.toString() : '');
                        }
                    }).catch(function () { frappe.show_alert({ message: __('فشل تحويل تاريخ الأرشيف إلى هجري.'), indicator: 'red' }); });
                }},
                { fieldtype: 'Data', fieldname: 'archive_date_hijri', label: __('تاريخ الأرشفة هجري'), read_only: 1, default: def_adh || DBE.State.active_archive_date_hijri || '' },
                { fieldtype: 'Data', fieldname: 'archive_year_hijri', label: __('سنة الأرشفة هجري'), read_only: 1, default: def_ayh || DBE.State.active_archive_year_hijri || '' },
                { fieldtype: 'Data', fieldname: 'archive_month_hijri', label: __('الشهر الهجري'), read_only: 1, default: def_month || DBE.State.active_archive_month_hijri || '' },
                { fieldtype: 'Link', fieldname: 'judge_name', label: __('اسم رئيس المحكمة (للطباعة)'), options: 'Judicial Employee', get_query: function () { return { filters: { chief_justice: 1 } }; }, default: def_judge || '' },
                { fieldtype: 'Section Break', label: __('صورة الترويسة') },
                { fieldtype: 'Attach Image', fieldname: 'archive_image', label: __('صورة الترويسة (عرض كامل)'), default: def_logo || '/files/a_archive.png' },
                { fieldtype: 'Section Break', label: __('ملاحظات') },
                { fieldtype: 'Small Text', fieldname: 'description', label: __('ملاحظات / وصف (اختياري)'), default: def_desc || '' }
            ],
            primary_action_label: __('حفظ'),
            primary_action: function (values) {
                var secretary_val = DBE.State.secretary_control ? DBE.State.secretary_control.get_value() : '';
                if (!secretary_val) {
                    frappe.show_alert({ message: __('يجب اختيار أمين السر أولاً.'), indicator: 'red' });
                    return;
                }
                if (!values.title || !values.title.trim()) {
                    frappe.show_alert({ message: __('يجب إدخال عنوان للمحفظة.'), indicator: 'red' });
                    return;
                }
                dialog.hide();
                var img = values.archive_image || '/files/a_archive.png';
                on_confirm(values.title.trim(), values.description || '', img, img, values.judge_name || '', values.archive_date || '', values.archive_date_hijri || '', values.archive_year_hijri || '', values.archive_month_hijri || '');
            }
        });
        dialog.show();

        // التعبئة التلقائية للعنوان عند فتح الديالوج:
        // ننتظر استجابة API ثم نستخدم القيم مباشرة
        var date_val = dialog.get_value('archive_date');
        var month_val = dialog.get_value('archive_month_hijri');
        var year_val = dialog.get_value('archive_year_hijri');
        if (date_val && (!month_val || !year_val)) {
            judicial_files.utils.get_hijri_date(date_val).then(function (hijri) {
                if (hijri) {
                    dialog.set_value('archive_date_hijri', hijri.date || '');
                    dialog.set_value('archive_year_hijri', hijri.year ? hijri.year.toString() : '');
                    dialog.set_value('archive_month_hijri', hijri.month_name || '');
                    _set_title_from(dialog, hijri.month_name || '', hijri.year ? hijri.year.toString() : '');
                }
            }).catch(function () {});
        } else if (month_val && year_val) {
            _set_title_from(dialog, month_val, year_val);
        }

        if (!def_judge) {
            DBE.UI.get_chief_justice_name(function (chief) {
                if (chief && !dialog.fields_dict.judge_name.get_value()) dialog.set_value('judge_name', chief);
            });
        }
    },

    // --- التنفيذ الفعلي للحفظ ---
    _do_save_draft: function (batch_name, title, desc, logo, header, judge, ad, adh, ayh, month, items) {
        frappe.call({
            method: 'judicial_files.judicial_files.page.dispute_batch_editor_v2.dispute_batch_editor_v2.save_batch_draft',
            args: {
                batch_name: batch_name || '', items: JSON.stringify(items),
                title: title || '', description: desc || '',
                logo_emblem: logo || '', header_text_image: header || '',
                judge_name: judge || '', archive_date: ad || '',
                archive_date_hijri: adh || '', archive_year_hijri: ayh || '',
                archive_month_hijri: month || ''
            },
            freeze: true, freeze_message: __('جاري حفظ المسودة...'),
            callback: function (r) {
                if (r.message && r.message.success) {
                    DBE.State.active_batch_name = r.message.batch_name;
                    DBE.State.active_batch_title = r.message.title;
                    DBE.State.active_batch_description = r.message.description || '';
                    DBE.State.active_logo_emblem = logo || '';
                    DBE.State.active_header_text_image = header || '';
                    DBE.State.active_judge_name = judge || '';
                    DBE.State.active_archive_date = ad || DBE.State.active_archive_date;
                    DBE.State.active_archive_date_hijri = adh || DBE.State.active_archive_date_hijri;
                    DBE.State.active_archive_year_hijri = ayh || DBE.State.active_archive_year_hijri;
                    DBE.State.active_archive_month_hijri = month || '';
                    DBE.Batch.update_batch_indicator(r.message.title, false);
                    $('#action-save-draft').hide();
                    $('#scanner-btn-post').css('display', 'flex');
                    $('#btn-delete-archive').css('display', 'inline-flex');
                    frappe.show_alert({ message: __('تم حفظ الأرشيف بنجاح: {0}', [r.message.title]), indicator: 'green' });
                } else {
                    frappe.show_alert({ message: __('فشل الحفظ: ') + ((r.message && r.message.message) || ''), indicator: 'red' });
                }
            }
        });
    },

    // --- جلب من الأرشيف ---
    action_fetch_from_archive: function () {
        $.when(
            frappe.call({ method: 'judicial_files.judicial_files.page.dispute_batch_editor_v2.dispute_batch_editor_v2.get_draft_batches' }),
            frappe.call({ method: 'judicial_files.judicial_files.page.dispute_batch_editor_v2.dispute_batch_editor_v2.get_posted_batches' })
        ).done(function (drafts_res, posted_res) {
            var all = (drafts_res[0] ? drafts_res[0].message || [] : []).concat(posted_res[0] ? posted_res[0].message || [] : []);
            if (all.length === 0) {
                frappe.show_alert({ message: __('لا توجد أرشفة في النظام.'), indicator: 'orange' });
                return;
            }
            DBE.Batch._show_batch_selection_dialog(__('اختر أرشيفاً'), all, function (chosen) {
                var is_posted_batch = chosen.status === 'Posted';
                frappe.call({
                    method: 'judicial_files.judicial_files.page.dispute_batch_editor_v2.dispute_batch_editor_v2.load_batch_data',
                    args: { batch_name: chosen.name },
                    freeze: true, freeze_message: __('جاري تحميل الأرشيف...'),
                    callback: function (r2) {
                        if (r2.message) DBE.Batch.load_batch_into_grid(r2.message, is_posted_batch);
                        else frappe.show_alert({ message: __('تعذر تحميل الأرشيف!'), indicator: 'red' });
                    }
                });
            });
        });
    },

    // --- حوار اختيار محفظة مع فلاتر بحث ---
    _show_batch_selection_dialog: function (title, batches, on_select) {
        var all_batches = batches;
        var filtered_batches = batches.slice();
        var hijri_months = ['', 'محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'];

        function render_table() {
            var filter_month = dialog.get_value('filter_month_hijri') || '';
            var filter_year = dialog.get_value('filter_year_hijri') || '';
            var filter_desc = dialog.get_value('filter_description') || '';
            var filter_status = dialog.get_value('filter_status') || '';

            filtered_batches = all_batches.filter(function (b) {
                if (filter_month && (b.archive_month_hijri || '') !== filter_month) return false;
                if (filter_year && (b.archive_year_hijri || '').indexOf(filter_year) === -1) return false;
                if (filter_desc && (b.description || '').indexOf(filter_desc) === -1) return false;
                if (filter_status === __('مسودة') && b.status !== 'Draft') return false;
                if (filter_status === __('مرحل') && b.status !== 'Posted') return false;
                return true;
            });

            var rows_html = '';
            filtered_batches.forEach(function (b, idx) {
                var date_val = b.status === 'Posted' ? (b.posting_date || '') : (b.creation_date || '');
                var status_label = b.status === 'Posted' ? __('مرحل') : __('مسودة');
                var status_color = b.status === 'Posted' ? '#27ae60' : '#f39c12';
                rows_html += '<tr data-index="' + idx + '" style="cursor:pointer;">'
                    + '<td style="font-weight:bold;color:#2980b9;padding:8px 12px;">' + frappe.utils.escape_html(b.title || b.name) + '</td>'
                    + '<td style="padding:8px 12px;color:#555;">' + date_val + '</td>'
                    + '<td style="padding:8px 12px;color:#555;">' + frappe.utils.escape_html(b.archive_month_hijri || '') + '</td>'
                    + '<td style="padding:8px 12px;color:#555;">' + frappe.utils.escape_html(b.archive_year_hijri || '') + '</td>'
                    + '<td style="padding:8px 12px;color:' + status_color + ';font-weight:bold;">' + status_label + '</td>'
                    + '<td style="padding:8px 12px;color:#888;font-size:11px;">' + frappe.utils.escape_html(b.description || '') + '</td></tr>';
            });

            var table_html = '<p style="font-size:12px;color:#7f8c8d;margin-bottom:12px;"><i class="fa fa-hand-pointer-o"></i> ' + __('انقر فوق المحفظة المطلوبة:') + '</p>'
                + '<table class="table table-bordered table-hover" id="batch-select-table" style="font-size:12px;width:100%;direction:rtl;text-align:right;">'
                + '<thead><tr style="background:#f8f9fa;"><th style="padding:8px 12px;">' + __('العنوان') + '</th><th style="padding:8px 12px;">' + __('التاريخ') + '</th><th style="padding:8px 12px;">' + __('الشهر الهجري') + '</th><th style="padding:8px 12px;">' + __('السنة الهجرية') + '</th><th style="padding:8px 12px;">' + __('الحالة') + '</th><th style="padding:8px 12px;">' + __('الوصف') + '</th></tr></thead>'
                + '<tbody>' + (rows_html || '<tr><td colspan="6" style="text-align:center;color:#999;padding:20px;">' + __('لا توجد نتائج تطابق الفلترة.') + '</td></tr>') + '</tbody>'
                + '</table>';

            dialog.fields_dict.table_html.$wrapper.html(table_html);
        }

        var dialog = new frappe.ui.Dialog({
            title: title,
            fields: [
                { fieldtype: 'Column Break' },
                { fieldtype: 'Select', fieldname: 'filter_month_hijri', label: __('الشهر الهجري'), options: hijri_months.join('\n'), default: '', onchange: function () { render_table(); } },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Data', fieldname: 'filter_year_hijri', label: __('السنة الهجرية'), default: '', onchange: function () { render_table(); } },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Data', fieldname: 'filter_description', label: __('الوصف'), default: '', onchange: function () { render_table(); } },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Select', fieldname: 'filter_status', label: __('الحالة'), options: [__('الكل'), __('مسودة'), __('مرحل')].join('\n'), default: __('الكل'), onchange: function () { render_table(); } },
                { fieldtype: 'Section Break' },
                { fieldtype: 'HTML', fieldname: 'table_html', options: '' }
            ],
            primary_action_label: __('إغلاق'),
            primary_action: function () { dialog.hide(); }
        });
        dialog.show();
        render_table();
        $(document).off('click', '#batch-select-table tbody tr').on('click', '#batch-select-table tbody tr', function () {
            var idx = parseInt($(this).data('index'));
            dialog.hide();
            on_select(filtered_batches[idx]);
        });
    },

    // --- ترحيل المحفظة ---
    action_post_batch: function () {
        if (DBE.State.is_readonly_mode) {
            frappe.show_alert({ message: __('لا يمكن الترحيل في وضع الاستعراض.'), indicator: 'red' });
            return;
        }
        var selected_assistant = DBE.State.secretary_control ? DBE.State.secretary_control.get_value() : '';
        if (!selected_assistant) {
            frappe.show_alert({ message: __('يرجى تحديد أمين السر أولاً.'), indicator: 'red' });
            if (DBE.State.secretary_control && DBE.State.secretary_control.wrapper) DBE.State.secretary_control.wrapper.find('input').focus();
            return;
        }

        var items = this.collect_current_grid_items();
        var eligible = items.filter(function (it) { return it.original_status === 'منظور'; });
        if (eligible.length === 0) {
            frappe.show_alert({ message: __('لا توجد سجلات بحالة "منظور" قابلة للترحيل.'), indicator: 'orange' });
            return;
        }

        frappe.confirm(__('هل أنت متأكد من ترحيل ملف الأرشيف؟ سيتم تحديث {0} سجلاً بشكل نهائي.', [eligible.length]), function () {
            if (DBE.State.active_batch_name) {
                DBE.Batch._do_post_batch(DBE.State.active_batch_name, DBE.State.active_batch_title,
                    DBE.State.active_batch_description, DBE.State.active_logo_emblem,
                    DBE.State.active_header_text_image, DBE.State.active_judge_name,
                    DBE.State.active_archive_date, DBE.State.active_archive_date_hijri,
                    DBE.State.active_archive_year_hijri, DBE.State.active_archive_month_hijri, items);
            } else {
                DBE.Batch._show_batch_title_dialog(DBE.State.active_batch_title, DBE.State.active_batch_description,
                    DBE.State.active_logo_emblem, DBE.State.active_header_text_image,
                    DBE.State.active_judge_name, DBE.State.active_archive_date,
                    DBE.State.active_archive_date_hijri, DBE.State.active_archive_year_hijri,
                    DBE.State.active_archive_month_hijri,
                    function (title, desc, logo, header, judge, ad, adh, ayh, month) {
                        DBE.State.active_archive_date = ad || DBE.State.active_archive_date;
                        DBE.State.active_archive_date_hijri = adh || DBE.State.active_archive_date_hijri;
                        DBE.State.active_archive_year_hijri = ayh || DBE.State.active_archive_year_hijri;
                        DBE.State.active_archive_month_hijri = month || DBE.State.active_archive_month_hijri;
                        DBE.Batch._do_post_batch(null, title, desc, logo, header, judge, ad, adh, ayh, month, items);
                    });
            }
        });
    },

    // --- التنفيذ الفعلي للترحيل ---
    _do_post_batch: function (batch_name, title, desc, logo, header, judge, ad, adh, ayh, month, items) {
        var selected_assistant = DBE.State.secretary_control ? DBE.State.secretary_control.get_value() : '';
        items.forEach(function (it) { it.current_secretary = selected_assistant || it.current_secretary; });

        frappe.call({
            method: 'judicial_files.judicial_files.page.dispute_batch_editor_v2.dispute_batch_editor_v2.post_batch_archive',
            args: {
                batch_name: batch_name || '', items: JSON.stringify(items),
                title: title || '', description: desc || '',
                logo_emblem: logo || '', header_text_image: header || '',
                judge_name: judge || '', archive_date: ad || '',
                archive_date_hijri: adh || '', archive_year_hijri: ayh || '',
                archive_month_hijri: month || ''
            },
            freeze: true, freeze_message: __('جاري ترحيل الأرشيف...'),
            callback: function (r) {
                if (r.message && r.message.success) {
                    DBE.State.active_batch_name = r.message.batch_name;
                    DBE.State.active_batch_title = r.message.title;
                    DBE.State.active_logo_emblem = logo || '';
                    DBE.State.active_header_text_image = header || '';
                    DBE.State.active_judge_name = judge || '';
                    DBE.State.active_archive_month_hijri = month || '';
                    DBE.State.is_readonly_mode = true;
                    $('#scanner-results-body .cell-input').prop('readonly', true).css('cursor', 'default');
                    $('#scanner-reference-input').prop('disabled', true);
                    $('#scanner-btn-post').prop('disabled', true).css('opacity', '0.5');
                    $('#btn-delete-archive').hide();
                    DBE.Batch.update_batch_indicator(r.message.title, true);
                    frappe.show_alert({ message: __('تم ترحيل ملف الأرشيف بنجاح: {0}', [r.message.title]), indicator: 'green' });
                } else {
                    frappe.show_alert({ message: __('فشل الترحيل: ') + ((r.message && r.message.message) || ''), indicator: 'red' });
                }
            }
        });
    },
};

// =============================================================================
// DBE.Print — الطباعة
// =============================================================================

var DBE = DBE || {};

DBE.Print = {
    action_print: function () {
        var rows = $('#scanner-results-body tr').not('#empty-row');
        if (rows.length === 0) {
            frappe.show_alert({ message: __('لا توجد بيانات للطباعة.'), indicator: 'orange' });
            return;
        }

        var default_month = '';
        rows.each(function () {
            var m = $(this).find('.cell-input[data-fieldname="archive_month_hijri"]').val() || '';
            if (m && !default_month) { default_month = m; return false; }
        });

        var posting_type_options = [__('الكل')].concat(DBE.State.posting_types).join('\n');

        var dialog = new frappe.ui.Dialog({
            title: __('خيارات الطباعة'),
            fields: [
                { fieldtype: 'Link', fieldname: 'judge_name', label: __('اسم القاضي'), options: 'Judicial Employee', get_query: function () { return { filters: { chief_justice: 1 } }; }, reqd: 1 },
                { fieldtype: 'Data', fieldname: 'month_hijri', label: __('الشهر الهجري'), default: default_month },
                { fieldtype: 'Select', fieldname: 'posting_type_filter', label: __('نوع الترحيل'), options: posting_type_options, default: 'الكل' },
                { fieldtype: 'Section Break', label: __('صورة الترويسة') },
                { fieldtype: 'Attach Image', fieldname: 'print_archive_image', label: __('صورة الترويسة (عرض كامل)'), default: DBE.State.active_logo_emblem || '/files/a_archive.png' }
            ],
            primary_action_label: __('طباعة'),
            primary_action: function (values) {
                if (!values.judge_name || !values.judge_name.trim()) {
                    frappe.show_alert({ message: __('يجب إدخال اسم القاضي.'), indicator: 'red' });
                    return;
                }
                dialog.hide();
                DBE.Print._do_print({
                    judge_name: values.judge_name.trim(),
                    month_hijri: values.month_hijri || '',
                    archive_year_hijri: DBE.State.active_archive_year_hijri || '',
                    posting_type_filter: values.posting_type_filter || __('الكل'),
                    print_logo: values.print_archive_image || DBE.State.active_logo_emblem,
                    print_header: values.print_archive_image || DBE.State.active_header_text_image
                });
            }
        });
        dialog.show();
        dialog.set_values({
            judge_name: DBE.State.active_judge_name || '',
            month_hijri: DBE.State.active_archive_month_hijri || default_month,
            print_archive_image: DBE.State.active_logo_emblem || '/files/a_archive.png'
        });
    },

    _do_print: function (opts) {
        var rows_data = [];
        var row_num = 1;
        $('#scanner-results-body tr').not('#empty-row').each(function () {
            var tr = $(this);
            var posting_type = tr.find('.cell-input[data-fieldname="posting_type"]').val() || '';
            if (opts.posting_type_filter !== __('الكل') && posting_type !== opts.posting_type_filter) return;

            var row_color_class = tr.hasClass('row-archived') ? 'row-archived' : (tr.hasClass('row-missing') ? 'row-missing' : '');
            var row_reference = tr.find('.ref-edit-input').length ? tr.find('.ref-edit-input').val().trim() : tr.find('td:nth-child(3)').text().trim();

            rows_data.push({
                num: row_num++, reference: row_reference,
                file_number: tr.find('.cell-input[data-fieldname="file_number"]').val() || '',
                year: tr.find('.cell-input[data-fieldname="year"]').val() || '',
                petitioner: tr.find('.cell-input[data-fieldname="petitioner"]').val() || '',
                respondent: tr.find('.cell-input[data-fieldname="respondent"]').val() || '',
                judge: tr.find('.cell-input[data-fieldname="judge"]').val() || '',
                assistant: tr.find('.cell-input[data-fieldname="secretary"]').val() || '',
                cur_asst: tr.find('.cell-input[data-fieldname="current_secretary"]').val() || '',
                status: tr.find('.cell-input[data-fieldname="status"]').val() || '',
                posting_type: posting_type,
                exec_file_no: tr.find('.cell-input[data-fieldname="execution_file_no"]').val() || '',
                month: tr.find('.cell-input[data-fieldname="archive_month_hijri"]').val() || '',
                archive_date: tr.find('.cell-input[data-fieldname="archive_date"]').data('sys-date') || tr.find('.cell-input[data-fieldname="archive_date"]').val() || '',
                archive_year_hijri: tr.find('.cell-input[data-fieldname="archive_year_hijri"]').val() || '',
                row_color_class: row_color_class
            });
        });

        if (rows_data.length === 0) {
            frappe.show_alert({ message: __('لا توجد بيانات مطابقة لنوع الترحيل المختار.'), indicator: 'orange' });
            return;
        }

        var tbody_html = '';
        rows_data.forEach(function (r) {
            var row_class = r.row_color_class ? ' class="' + r.row_color_class + '"' : '';
            tbody_html += '<tr' + row_class + '>'
                + '<td>' + r.num + '</td><td>' + frappe.utils.escape_html(r.reference) + '</td>'
                + '<td>' + frappe.utils.escape_html(r.file_number) + '</td><td>' + frappe.utils.escape_html(r.year) + '</td>'
                + '<td>' + frappe.utils.escape_html(r.petitioner) + '</td><td>' + frappe.utils.escape_html(r.respondent) + '</td>'
                + '<td class="print-hide-col">' + frappe.utils.escape_html(r.judge) + '</td><td>' + frappe.utils.escape_html(r.assistant) + '</td>'
                + '<td>' + frappe.utils.escape_html(r.cur_asst) + '</td><td>' + frappe.utils.escape_html(r.status) + '</td>'
                + '<td>' + frappe.utils.escape_html(r.posting_type) + '</td>'
                + '<td>' + frappe.utils.escape_html(r.exec_file_no) + '</td>'
                + '<td class="print-hide-col">' + frappe.utils.escape_html(r.month) + '</td>'
                + '<td class="print-hide-col">' + frappe.utils.escape_html(r.archive_date) + '</td>'
                + '<td class="print-hide-col">' + frappe.utils.escape_html(r.archive_year_hijri) + '</td>'
                + '<td style="min-width:80px;">&nbsp;</td></tr>';
        });

        var title_posting = opts.posting_type_filter === __('الكل') ? __('كافة أنواع الترحيل') : opts.posting_type_filter;
        var report_title = __('قضايا المنازعات التنفيذية المرحلة للأرشيف') + ' (' + title_posting + ')';
        if (opts.month_hijri) report_title += ' ' + __('لشهر') + ' ' + opts.month_hijri;
        if (opts.archive_year_hijri) report_title += ' ' + opts.archive_year_hijri + 'هـ';
        report_title += ' ' + __('القاضي') + ' / ' + opts.judge_name + ' - ' + __('رئيس المحكمة التجارية بأمانة العاصمة');

        var print_date = new Date().toLocaleDateString('ar-YE');

        var img_src = opts.print_logo || opts.print_header || '/files/a_archive.png';
        var src = img_src.startsWith('/') ? window.location.origin + img_src : img_src;

        // إحصاء السجلات حسب نوع الترحيل
        var type_counts = {};
        rows_data.forEach(function (r) {
            var t = r.posting_type || __('بدون');
            type_counts[t] = (type_counts[t] || 0) + 1;
        });
        var type_summary = Object.keys(type_counts).map(function (t) {
            return t + ': <strong>' + type_counts[t] + '</strong>';
        }).join(' &nbsp;|&nbsp; ');

        var print_css = '*{box-sizing:border-box;margin:0;padding:0}'
            + 'body{font-family:"Traditional Arabic","Arial",sans-serif;font-size:9pt;direction:rtl;color:#000;background:#fff}'
            + 'table{width:100%;border-collapse:collapse;font-size:11pt}'
            + 'thead{display:table-header-group}'
            + 'thead .print-header-row td, thead .print-title-row td { background: #fff; padding: 0; border: none; }'
            + 'thead .print-header-row img { width:100%; height:auto; max-height:80px; display:block; }'
            + 'thead .print-title-row td { text-align:center; font-size:15pt; font-weight:bold; padding:8px 0 4px; }'
            + 'thead th{background:#e8e8e8;border:1px solid #444;padding:4px 2px;text-align:center;font-weight:bold;white-space:nowrap;font-size:11pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
            + 'tbody td{border:1px solid #888;padding:3px 3px;text-align:center;vertical-align:middle}'
            + 'tbody tr.row-archived td{background-color:#fff3e0!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
            + 'tbody tr.row-missing td{background-color:#ffebee!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
            + 'tbody tr:not(.row-archived):not(.row-missing):nth-child(even) td{background:#fff}'
            + '.print-hide-col{display:none}'
            + '.print-footer{border-top:1px solid #bbb;padding-top:4px;margin-top:8px;display:flex;justify-content:space-between;font-size:8pt}'
            + '.type-summary-row{margin-top:6px;font-size:9pt;text-align:center;padding:3px 0}'
            + '@media print{-webkit-print-color-adjust:exact;print-color-adjust:exact}'
            + 'thead th{-webkit-print-color-adjust:exact;print-color-adjust:exact}'
            + '@page{size:A4 landscape;margin:3mm 8mm 12mm;@bottom-center{content:"\\635\\641\\62D\\629 " counter(page) " \\645\\646 " counter(pages);font-size:8pt;font-family:"Traditional Arabic","Arial",sans-serif}}';

        var headerColspan = 15;
        var theadContent = '<thead>'
            + '<tr class="print-header-row"><td colspan="' + headerColspan + '" style="text-align:center; padding:0; margin:0; border:none;"><img src="' + src + '" alt="الترويسة" style="width:100%; height:auto; max-height:80px; display:block;"></td></tr>'
            + '<tr class="print-title-row"><td colspan="' + headerColspan + '" style="text-align:center; font-size:15pt; font-weight:bold; padding:8px 0 4px; border:none;">' + report_title + '</td></tr>'
            + '<tr>'
            + '<th>#</th><th>' + __('المرجع') + '</th><th>' + __('رقم الملف') + '</th><th>' + __('السنة') + '</th>'
            + '<th>' + __('المدعي') + '</th><th>' + __('المدعى عليه') + '</th><th class="print-hide-col">' + __('القاضي') + '</th>'
            + '<th>' + __('أمين السر') + '</th>'
            + '<th>' + __('أمين السر الحالي') + '</th>'
            + '<th>' + __('حالة الملف') + '</th><th>' + __('نوع الترحيل') + '</th>'
            + '<th>' + __('رقم ملف التنفيذ') + '</th>'
            + '<th class="print-hide-col">' + __('الشهر') + '</th>'
            + '<th class="print-hide-col">' + __('تاريخ الترحيل ميلادي') + '</th>'
            + '<th class="print-hide-col">' + __('السنة الهجرية') + '</th>'
            + '<th>' + __('الملاحظات') + '</th>'
            + '</tr></thead>';

        var fullTable = '<table style="width:100%; border-collapse:collapse; font-size:11pt;">'
            + theadContent
            + '<tbody>' + tbody_html + '</tbody>'
            + '</table>';

        var print_html = '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">'
            + '<title>' + report_title + '</title>'
            + '<style>' + print_css + '</style>'
            + '</head><body>'
            + fullTable
            + '<div class="type-summary-row">' + __('توزيع أنواع الترحيل') + ': ' + type_summary + '</div>'
            + '<div class="print-footer">'
            + '<span>' + __('إجمالي السجلات') + ': <strong>' + rows_data.length + '</strong></span>'
            + '<span>' + __('تاريخ الطباعة') + ': <strong>' + print_date + '</strong></span></div>'
            + '<script>window.onload = function () { setTimeout(function () { window.print(); }, 900); };<\/script>'
            + '</body></html>';

        var pw = window.open('', '_blank', 'width=1100,height=720,scrollbars=yes');
        if (!pw) {
            frappe.show_alert({ message: __('تعذر فتح نافذة الطباعة! يرجى السماح بالنوافذ المنبثقة.'), indicator: 'red' });
            return;
        }
        pw.document.write(print_html);
        pw.document.close();
    },

    action_print_all: function () {
        var posting_type_options = [__('الكل')].concat(DBE.State.posting_types).join('\n');

        var dialog = new frappe.ui.Dialog({
            title: __('خيارات الطباعة'),
            fields: [
                { fieldtype: 'Link', fieldname: 'judge_name', label: __('اسم القاضي'), options: 'Judicial Employee', get_query: function () { return { filters: { chief_justice: 1 } }; }, reqd: 1 },
                { fieldtype: 'Select', fieldname: 'month_hijri', label: __('الشهر الهجري'), options: ['', 'محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'].join('\n'), default: DBE.State.active_archive_month_hijri || '' },
                { fieldtype: 'Select', fieldname: 'posting_type_filter', label: __('نوع الترحيل'), options: posting_type_options, default: __('الكل') },
                { fieldtype: 'Section Break', label: __('صورة الترويسة') },
                { fieldtype: 'Attach Image', fieldname: 'print_archive_image', label: __('صورة الترويسة (عرض كامل)'), default: DBE.State.active_logo_emblem || '/files/a_archive.png' }
            ],
            primary_action_label: __('طباعة'),
            primary_action: function (values) {
                if (!values.judge_name || !values.judge_name.trim()) {
                    frappe.show_alert({ message: __('يجب إدخال اسم القاضي.'), indicator: 'red' });
                    return;
                }
                dialog.hide();

                var args = {
                    month: values.month_hijri || '',
                    year: DBE.State.active_archive_year_hijri || '',
                    posting_type: (values.posting_type_filter === __('الكل')) ? '' : values.posting_type_filter
                };

                frappe.call({
                    method: 'judicial_files.judicial_files.page.dispute_batch_editor_v2.dispute_batch_editor_v2.get_dispute_files_for_print',
                    args: args,
                    freeze: true,
                    freeze_message: __('جاري تجهيز بيانات الطباعة...'),
                    callback: function (r) {
                        var data = r.message || [];
                        if (data.length === 0) {
                            frappe.show_alert({ message: __('لا توجد بيانات للطباعة.'), indicator: 'orange' });
                            return;
                        }

                        var tbody_html = '';
                        var row_num = 1;
                        data.forEach(function (row) {
                            var row_color = (row.status === 'مرحل') ? ' class="row-archived"' : '';
                            tbody_html += '<tr' + row_color + '>'
                                + '<td>' + (row_num++) + '</td>'
                                + '<td>' + frappe.utils.escape_html(row.reference || '') + '</td>'
                                + '<td>' + frappe.utils.escape_html(row.file_number || '') + '</td>'
                                + '<td>' + frappe.utils.escape_html(row.year || '') + '</td>'
                                + '<td>' + frappe.utils.escape_html(row.petitioner || '') + '</td>'
                                + '<td>' + frappe.utils.escape_html(row.respondent || '') + '</td>'
                                + '<td class="print-hide-col">' + frappe.utils.escape_html(row.judge || '') + '</td>'
                                + '<td>' + frappe.utils.escape_html(row.secretary || '') + '</td>'
                                + '<td>' + frappe.utils.escape_html(row.current_secretary || '') + '</td>'
                                + '<td>' + frappe.utils.escape_html(row.status || '') + '</td>'
                                + '<td>' + frappe.utils.escape_html(row.posting_type || '') + '</td>'
                                + '<td>' + frappe.utils.escape_html(row.execution_file_no || '') + '</td>'
                                + '<td class="print-hide-col">' + frappe.utils.escape_html(row.archive_month_hijri || '') + '</td>'
                                + '<td class="print-hide-col">' + frappe.utils.escape_html(row.archive_date || '') + '</td>'
                                + '<td class="print-hide-col">' + frappe.utils.escape_html(row.archive_year_hijri || '') + '</td>'
                                + '<td style="min-width:80px;">&nbsp;</td></tr>';
                        });

                        var title_posting = values.posting_type_filter === __('الكل') ? __('كافة أنواع الترحيل') : values.posting_type_filter;
                        var report_title = __('قضايا المنازعات التنفيذية المرحلة للأرشيف') + ' (' + title_posting + ')';
                        if (values.month_hijri) report_title += ' ' + __('لشهر') + ' ' + values.month_hijri;
                        if (DBE.State.active_archive_year_hijri) report_title += ' ' + DBE.State.active_archive_year_hijri + 'هـ';
                        report_title += ' ' + __('القاضي') + ' / ' + values.judge_name.trim() + ' - ' + __('رئيس المحكمة التجارية بأمانة العاصمة');

                        var type_counts = {};
                        data.forEach(function (row) {
                            var t = row.posting_type || __('بدون');
                            type_counts[t] = (type_counts[t] || 0) + 1;
                        });
                        var type_summary = Object.keys(type_counts).map(function (t) {
                            return t + ': <strong>' + type_counts[t] + '</strong>';
                        }).join(' &nbsp;|&nbsp; ');

                        var print_date = new Date().toLocaleDateString('ar-YE');
                        var img_src = values.print_archive_image || DBE.State.active_logo_emblem || '/files/a_archive.png';
                        var src = img_src.startsWith('/') ? window.location.origin + img_src : img_src;

                        var print_css = '*{box-sizing:border-box;margin:0;padding:0}'
                            + 'body{font-family:"Traditional Arabic","Arial",sans-serif;font-size:9pt;direction:rtl;color:#000;background:#fff}'
                            + 'table{width:100%;border-collapse:collapse;font-size:11pt}'
                            + 'thead{display:table-header-group}'
                            + 'thead .print-header-row td, thead .print-title-row td { background: #fff; padding: 0; border: none; }'
                            + 'thead .print-header-row img { width:100%; height:auto; max-height:80px; display:block; }'
                            + 'thead .print-title-row td { text-align:center; font-size:15pt; font-weight:bold; padding:8px 0 4px; }'
                            + 'thead th{background:#e8e8e8;border:1px solid #444;padding:4px 2px;text-align:center;font-weight:bold;white-space:nowrap;font-size:11pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
                            + 'tbody td{border:1px solid #888;padding:3px 3px;text-align:center;vertical-align:middle}'
                            + 'tbody tr.row-archived td{background-color:#fff3e0!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
                            + 'tbody tr.row-missing td{background-color:#ffebee!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
                            + 'tbody tr:not(.row-archived):not(.row-missing):nth-child(even) td{background:#fff}'
                            + '.print-hide-col{display:none}'
                            + '.print-footer{border-top:1px solid #bbb;padding-top:4px;margin-top:8px;display:flex;justify-content:space-between;font-size:8pt}'
                            + '.type-summary-row{margin-top:6px;font-size:9pt;text-align:center;padding:3px 0}'
                            + '@media print{-webkit-print-color-adjust:exact;print-color-adjust:exact}'
                            + 'thead th{-webkit-print-color-adjust:exact;print-color-adjust:exact}'
                            + '@page{size:A4 landscape;margin:3mm 8mm 12mm;@bottom-center{content:"\\635\\641\\62D\\629 " counter(page) " \\645\\646 " counter(pages);font-size:8pt;font-family:"Traditional Arabic","Arial",sans-serif}}';

        var headerColspan = 16;
                        var theadContent = '<thead>'
                            + '<tr class="print-header-row"><td colspan="' + headerColspan + '" style="text-align:center; padding:0; margin:0; border:none;"><img src="' + src + '" alt="الترويسة" style="width:100%; height:auto; max-height:80px; display:block;"></td></tr>'
                            + '<tr class="print-title-row"><td colspan="' + headerColspan + '" style="text-align:center; font-size:15pt; font-weight:bold; padding:8px 0 4px; border:none;">' + report_title + '</td></tr>'
                            + '<tr>'
                            + '<th>#</th><th>' + __('المرجع') + '</th><th>' + __('رقم الملف') + '</th><th>' + __('السنة') + '</th>'
                            + '<th>' + __('المدعي') + '</th><th>' + __('المدعى عليه') + '</th><th class="print-hide-col">' + __('القاضي') + '</th>'
                            + '<th>' + __('أمين السر') + '</th>'
                            + '<th>' + __('أمين السر الحالي') + '</th>'
                            + '<th>' + __('حالة الملف') + '</th><th>' + __('نوع الترحيل') + '</th>'
                            + '<th>' + __('رقم ملف التنفيذ') + '</th>'
                            + '<th class="print-hide-col">' + __('الشهر') + '</th>'
                            + '<th class="print-hide-col">' + __('تاريخ الترحيل ميلادي') + '</th>'
                            + '<th class="print-hide-col">' + __('السنة الهجرية') + '</th>'
                            + '<th>' + __('الملاحظات') + '</th>'
                            + '</tr></thead>';

                        var fullTable = '<table style="width:100%; border-collapse:collapse; font-size:11pt;">'
                            + theadContent
                            + '<tbody>' + tbody_html + '</tbody>'
                            + '</table>';

                        var print_html = '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">'
                            + '<title>' + report_title + '</title>'
                            + '<style>' + print_css + '</style>'
                            + '</head><body>'
                            + fullTable
                            + '<div class="type-summary-row">' + __('توزيع أنواع الترحيل') + ': ' + type_summary + '</div>'
                            + '<div class="print-footer">'
                            + '<span>' + __('إجمالي السجلات') + ': <strong>' + data.length + '</strong></span>'
                            + '<span>' + __('تاريخ الطباعة') + ': <strong>' + print_date + '</strong></span></div>'
                            + '<script>window.onload = function () { setTimeout(function () { window.print(); }, 900); };<\/script>'
                            + '</body></html>';

                        var pw = window.open('', '_blank', 'width=1100,height=720,scrollbars=yes');
                        if (!pw) {
                            frappe.show_alert({ message: __('تعذر فتح نافذة الطباعة! يرجى السماح بالنوافذ المنبثقة.'), indicator: 'red' });
                            return;
                        }
                        pw.document.write(print_html);
                        pw.document.close();
                    }
                });
            }
        });
        dialog.show();
        dialog.set_values({
            judge_name: DBE.State.active_judge_name || '',
            month_hijri: DBE.State.active_archive_month_hijri || '',
            print_archive_image: DBE.State.active_logo_emblem || '/files/a_archive.png'
        });
    },
};

// =============================================================================
// DBE.Events — ربط الأحداث (Events Setup)
// =============================================================================

var DBE = DBE || {};

DBE.Events = {
    setup: function (page) {
        // التركيز التلقائي
        setTimeout(function () { $('#scanner-reference-input').focus(); }, 600);

        // إنشاء حقل Link لمعاون التنفيذ
        DBE.State.secretary_control = frappe.ui.form.make_control({
            parent: $('#scanner-secretary-container'),
            df: {
                fieldtype: 'Link',
                fieldname: 'secretary',
                options: 'Judicial Employee',
                placeholder: __('ابحث عن أمين السر...'),
                get_query: function () { return { filters: { designation: 'أمين سر' } }; },
                onchange: function () {
                    var val = DBE.State.secretary_control.get_value();
                    if (val) {
                        DBE.Grid.apply_auto_current_secretary_assignment(val);
                        DBE.Grid.mark_batch_as_dirty();
                    }
                }
            },
            render_input: true
        });

        // زر ترحيل المحفظة
        $('#scanner-btn-post').on('click', function () { DBE.Batch.action_post_batch(); });

        // حفظ الأرشيف
        $(document).off('click', '#action-save-draft').on('click', '#action-save-draft', function (e) { e.preventDefault(); DBE.Batch.action_save_draft(); });

        // جلب من الأرشيف
        $(document).off('click', '#action-fetch-from-archive').on('click', '#action-fetch-from-archive', function (e) { e.preventDefault(); DBE.Batch.action_fetch_from_archive(); });

        // حذف ملف أرشيف غير مرحل
        $(document).on('click', '#btn-delete-archive', function (e) {
            e.preventDefault();
            if (!DBE.State.active_batch_name) return;
            frappe.confirm(
                __('هل أنت متأكد من حذف الأرشيف "{0}"؟', [DBE.State.active_batch_name]),
                function () {
                    frappe.call({
                        method: 'judicial_files.judicial_files.page.dispute_batch_editor_v2.dispute_batch_editor_v2.delete_draft_batch',
                        args: { batch_name: DBE.State.active_batch_name },
                        callback: function (r) {
                            if (r.message && r.message.success) {
                                frappe.show_alert({ message: __('تم حذف الأرشيف بنجاح'), indicator: 'green' });
                                DBE.Grid.clear_grid();
                            } else {
                                frappe.show_alert({ message: r.message.message || __('فشل حذف الأرشيف'), indicator: 'red' });
                            }
                        }
                    });
                }
            );
        });

        // طباعة
        $('#action-print').on('click', function (e) { e.preventDefault(); DBE.Print.action_print(); });
        $('#action-print-all').on('click', function (e) { e.preventDefault(); DBE.Print.action_print_all(); });

        // تعديل الترويسة
        $('#action-edit-batch').on('click', function (e) {
            e.preventDefault();
            if (!DBE.State.active_batch_name) {
                frappe.show_alert({ message: __('يجب حفظ المحفظة كمسودة أولاً.'), indicator: 'orange' });
                return;
            }
            if (DBE.State.is_readonly_mode) {
                frappe.show_alert({ message: __('لا يمكن تعديل محفظة مرحلة.'), indicator: 'red' });
                return;
            }
            DBE.Batch._show_batch_title_dialog(
                DBE.State.active_batch_title, DBE.State.active_batch_description,
                DBE.State.active_logo_emblem, DBE.State.active_header_text_image,
                DBE.State.active_judge_name, DBE.State.active_archive_date,
                DBE.State.active_archive_date_hijri, DBE.State.active_archive_year_hijri,
                DBE.State.active_archive_month_hijri,
                function (title, desc, logo, header, judge, ad, adh, ayh, month) {
                    var items = DBE.Batch.collect_current_grid_items();
                    DBE.Batch._do_save_draft(DBE.State.active_batch_name, title, desc, logo, header, judge, ad, adh, ayh, month, items);
                }
            );
        });

        // تتبع التعديلات
        $(document).on('input change', '.cell-input, .ref-edit-input', function () {
            DBE.Grid.mark_batch_as_dirty();
        });

        // تحويل هجري تلقائي عند تغيير تاريخ الأرشفة
        $(document).on('change', '.cell-input[data-fieldname="archive_date"]', function () {
            var tr = $(this).closest('tr');
            var archive_date = $(this).data('sys-date') || '';
            if (!archive_date) {
                tr.find('.cell-input[data-fieldname="archive_year_hijri"]').val('');
                tr.find('.cell-input[data-fieldname="archive_month_hijri"]').val('');
                return;
            }
            judicial_files.utils.get_hijri_date(archive_date).then(function (hijri) {
                if (hijri) {
                    tr.find('.cell-input[data-fieldname="archive_year_hijri"]').val(hijri.year.toString());
                    tr.find('.cell-input[data-fieldname="archive_month_hijri"]').val(hijri.month_name);
                    if (!DBE.State.active_archive_month_hijri) DBE.State.active_archive_month_hijri = hijri.month_name;
                    DBE.Grid.mark_batch_as_dirty();
                }
            }).catch(function () {
                frappe.show_alert({ message: __('فشل تحويل تاريخ الأرشيف إلى هجري.'), indicator: 'red' });
            });
        });

        // معالجة الإدخال الذكي للتاريخ
        $(document).on('blur', '.date-input', function () {
            var input = $(this);
            if (input.prop('readonly') || input.prop('disabled')) return;

            var val = input.val().trim();
            if (!val) {
                input.data('sys-date', '');
                input.trigger('change');
                return;
            }

            if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
                input.data('sys-date', val);
                input.trigger('change');
                return;
            }

            var parts = val.split(/[-/.]/);
            var d = new Date();
            var day = d.getDate(), month = d.getMonth() + 1, year = d.getFullYear();

            var valid = true;
            if (parts.length === 1 && val.length <= 2) {
                day = parseInt(parts[0]);
            } else if (parts.length === 2) {
                day = parseInt(parts[0]);
                month = parseInt(parts[1]);
            } else if (parts.length === 3) {
                day = parseInt(parts[0]);
                month = parseInt(parts[1]);
                year = parseInt(parts[2]);
                if (year < 100) year += 2000;
            } else {
                if (isNaN(Date.parse(val))) valid = false;
            }

            if (valid && parts.length <= 3 && parts.length > 0) {
                if (isNaN(day) || isNaN(month) || isNaN(year) || day < 1 || day > 31 || month < 1 || month > 12) {
                    valid = false;
                } else {
                    var pad = function (n) { return n < 10 ? '0' + n : n; };
                    var sys_date = year + '-' + pad(month) + '-' + pad(day);
                    var user_date = frappe.datetime.str_to_user(sys_date);

                    input.data('sys-date', sys_date);
                    input.val(user_date);
                    input.trigger('change');
                    return;
                }
            }

            if (!valid) {
                input.val('');
                input.data('sys-date', '');
                input.trigger('change');
            }
        });

        // تغيير حجم الصفحة
        $('#pagination-page-size').on('change', function () {
            var val = $(this).val();
            DBE.State.records_per_page = (val === 'all') ? Infinity : (parseInt(val) || 25);
            DBE.State.current_page = 1;
            DBE.UI.reindex_rows();
        });

        // أزرار التصفح
        $('#pagination-btn-prev').on('click', function () {
            if (DBE.State.current_page > 1) { DBE.State.current_page--; DBE.UI.apply_pagination(); }
        });
        $('#pagination-btn-next').on('click', function () {
            var total_records = $('#scanner-results-body tr').not('#empty-row').length;
            var total_pages = Math.ceil(total_records / DBE.State.records_per_page);
            if (DBE.State.current_page < total_pages) { DBE.State.current_page++; DBE.UI.apply_pagination(); }
        });

        // فرز الأعمدة
        $(document).on('click', '.sortable-header', function () {
            var tbody = $('#scanner-results-body');
            var rows = tbody.children('tr').not('#empty-row').get();
            if (rows.length <= 1) return;

            var header = $(this);
            var col_idx = header.index() + 1;
            var is_asc = !header.hasClass('sorted-asc');

            $('.sortable-header').removeClass('sorted-asc sorted-desc')
                .find('i').removeClass('fa-sort-up fa-sort-down').addClass('fa-sort text-muted');

            header.addClass(is_asc ? 'sorted-asc' : 'sorted-desc')
                .find('i').removeClass('fa-sort text-muted').addClass(is_asc ? 'fa-sort-up' : 'fa-sort-down');

            rows.sort(function (a, b) {
                var valA = DBE.Events._get_cell_sorting_value($(a).find('td:nth-child(' + col_idx + ')'));
                var valB = DBE.Events._get_cell_sorting_value($(b).find('td:nth-child(' + col_idx + ')'));
                var isNum = /^\d+(\.\d+)?$/;
                if (isNum.test(valA) && isNum.test(valB)) {
                    return is_asc ? parseFloat(valA) - parseFloat(valB) : parseFloat(valB) - parseFloat(valA);
                }
                return is_asc ? valA.localeCompare(valB, 'ar', { numeric: true, sensitivity: 'base' })
                    : valB.localeCompare(valA, 'ar', { numeric: true, sensitivity: 'base' });
            });

            $.each(rows, function (i, row) { tbody.append(row); });
            DBE.State.current_page = 1;
            DBE.UI.reindex_rows();
        });

        // Enter للبحث
        $('#scanner-reference-input').on('keypress', function (e) {
            if (e.which === 13) { e.preventDefault(); DBE.Grid.perform_search(); }
        });

        // Enter لتصحيح المرجع
        $(document).on('keydown', '.ref-edit-input', function (e) {
            if (e.which === 13) { e.preventDefault(); DBE.Grid.research_row_reference($(this).closest('tr')); }
        });

        // Enter للبحث في الصفوف المفقودة
        $(document).on('keydown', '.row-missing .cell-input', function (e) {
            if (e.which === 13) { e.preventDefault(); DBE.Grid.trigger_row_search_lookup($(this).closest('tr')); }
        });

        // حذف الصفوف
        $(document).on('click', '.btn-delete-row', function () {
            var tr = $(this).closest('tr');
            var checked = $('#scanner-results-body .row-selector-checkbox:checked');
            var is_checked = tr.find('.row-selector-checkbox').prop('checked');

            if (checked.length > 0 && is_checked) {
                frappe.confirm(__('هل أنت متأكد من حذف الصفوف المحددة ({0})؟', [checked.length]), function () {
                    checked.each(function () { DBE.Grid.delete_row_logic($(this).closest('tr')); });
                    DBE.UI.reindex_rows();
                    DBE.UI.update_counter();
                    $('#select-all-rows').prop('checked', false);
                    DBE.UI.check_empty_table();
                });
            } else {
                DBE.Grid.delete_row_logic(tr);
                DBE.UI.reindex_rows();
                DBE.UI.update_counter();
                DBE.UI.update_select_all_state();
                DBE.UI.check_empty_table();
            }
        });

        // التنقل بالأسهم
        $(document).on('keydown', '.cell-input', function (e) {
            var input = $(this);
            var row = parseInt(input.data('row'));
            var col = parseInt(input.data('col'));
            var target = null;
            switch (e.which) {
                case 38: target = $('.cell-input[data-row="' + (row - 1) + '"][data-col="' + col + '"]'); break;
                case 40: target = $('.cell-input[data-row="' + (row + 1) + '"][data-col="' + col + '"]'); break;
                case 37: target = $('.cell-input[data-row="' + row + '"][data-col="' + (col + 1) + '"]'); break;
                case 39: target = $('.cell-input[data-row="' + row + '"][data-col="' + (col - 1) + '"]'); break;
                default: return;
            }
            if (target && target.length) { e.preventDefault(); target.focus().select(); }
        });

        // تتبع التعديلات (dirty state)
        $(document).on('input', '.cell-input', function () {
            var input = $(this);
            var original = input.data('original');
            var current = input.data('fieldname') === 'archive_date' ? (input.data('sys-date') || '') : input.val();
            if (current !== original) {
                input.addClass('is-dirty').css('background-color', '#fffdeb');
            } else {
                input.removeClass('is-dirty').css('background-color', 'transparent');
            }
            if (input.data('fieldname') === 'status') {
                var tr = input.closest('tr');
                if (!tr.hasClass('row-missing')) {
                    tr.toggleClass('row-archived', current.trim() === 'مرحل');
                    DBE.UI.update_counter();
                }
            }
            if (input.data('fieldname') === 'new_status') {
                DBE.UI.update_new_status_cell_style(input.closest('tr'));
            }
        });

        // تبديل نوع الترحيل
        $(document).off('click', '.btn-toggle-posting').on('click', '.btn-toggle-posting', function () {
            var btn = $(this);
            var tr = btn.closest('tr');
            var posting_type_cell = tr.find('.cell-input[data-fieldname="posting_type"]');
            if (!posting_type_cell.length) return;

            var next_val = '';
            if (DBE.State.posting_types.length > 0) {
                var current_val = posting_type_cell.val() ? posting_type_cell.val().trim() : '';
                var idx = DBE.State.posting_types.indexOf(current_val);
                next_val = (idx === -1 || idx === DBE.State.posting_types.length - 1) ? DBE.State.posting_types[0] : DBE.State.posting_types[idx + 1];
            } else {
                var cv = posting_type_cell.val() ? posting_type_cell.val().trim() : '';
                next_val = (cv === 'حفظ') ? 'إغلاق' : 'حفظ';
            }

            var checked = $('#scanner-results-body .row-selector-checkbox:checked');
            var is_checked = tr.find('.row-selector-checkbox').prop('checked');
            if (checked.length > 0 && is_checked) {
                var count = 0;
                checked.each(function () {
                    var row = $(this).closest('tr');
                    var ns = row.find('.cell-input[data-fieldname="new_status"]').val().trim();
                    if (ns === 'مرحل') {
                        var cell = row.find('.cell-input[data-fieldname="posting_type"]');
                        if (cell.length) {
                            cell.val(next_val).addClass('is-dirty').css({ 'background-color': '#fff3e0', color: '#e65100', 'font-weight': 'bold' });
                            count++;
                        }
                    }
                });
                frappe.show_alert({ message: __('تم تبديل نوع الترحيل لـ {0} صفوف.', [count]) + ' ' + next_val, indicator: 'orange' });
            } else {
                posting_type_cell.val(next_val).addClass('is-dirty').css({ 'background-color': '#fff3e0', color: '#e65100', 'font-weight': 'bold' });
                frappe.show_alert({ message: __('تم تبديل نوع الترحيل إلى: ') + next_val, indicator: 'orange' });
            }
            DBE.Grid.mark_batch_as_dirty();
        });

        // تحديد الكل
        $(document).off('change', '#select-all-rows').on('change', '#select-all-rows', function () {
            $('#scanner-results-body tr:visible .row-selector-checkbox').prop('checked', $(this).prop('checked'));
        });

        // تحديث تحديد الكل
        $(document).off('change', '.row-selector-checkbox').on('change', '.row-selector-checkbox', function () {
            DBE.UI.update_select_all_state();
        });
    },

    _get_cell_sorting_value: function (td) {
        var input = td.find('.cell-input, .ref-edit-input');
        return input.length ? input.val().trim() : td.text().trim();
    },
};

// =============================================================================
// DBE.CSS + DBE.UI_TEMPLATE — الأنماط والقوالب
// =============================================================================

var DBE = DBE || {};

DBE.CSS = ''
    // ===== شريط التمرير الفاخر =====
    + '.table-responsive::-webkit-scrollbar{height:8px}'
    + '.table-responsive::-webkit-scrollbar-track{background:rgba(0,0,0,0.02);border-radius:4px}'
    + '.table-responsive::-webkit-scrollbar-thumb{background:rgba(41,128,185,0.2);border-radius:4px}'
    + '.table-responsive::-webkit-scrollbar-thumb:hover{background:rgba(41,128,185,0.4)}'

    // ===== الحاوية الرئيسية =====
    + '.scanner-container{display:flex;flex-direction:column;min-height:calc(100vh - 110px);overflow-y:auto;gap:12px;font-family:"Outfit","Inter","Segoe UI",sans-serif;padding:0;background:#fff}'

    // ===== شريط العمليات والعدادات =====
    + '.header-actions-row{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding:4px 6px;margin-bottom:2px;direction:rtl;width:100%}'
    + '.counter-badges-container{display:flex;gap:6px;align-items:center;flex-wrap:wrap;direction:rtl}'
    + '.badge-counter{font-size:11px;padding:4px 10px;border-radius:15px;color:#fff;font-weight:bold;box-shadow:0 1px 3px rgba(0,0,0,0.05)}'
    + '.badge-counter.badge-total{background-color:#2980b9}'
    + '.badge-counter.badge-active{background-color:#7f8c8d}'
    + '.badge-counter.badge-archived{background-color:#f59e0b}'
    + '.badge-counter.badge-missing{background-color:#ef4444}'
    + '.actions-container{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex-shrink:0}'

    // ===== اللوحة العلوية الثابتة =====
    + '.sticky-top-panel{position:relative!important;z-index:15!important;flex:0 0 auto;background:#fff!important;border-bottom:2px solid #2980b9!important;box-shadow:0 4px 15px rgba(0,0,0,0.04)!important;transition:all .2s ease}'
    + '.sticky-row-container{display:flex;flex-direction:row;justify-content:space-between;align-items:flex-end;gap:20px;direction:rtl;text-align:right;width:100%;flex-wrap:wrap}'

    // ===== بطاقة الجدول =====
    + '.card.glass-card{border:1px solid rgba(0,0,0,0.08);border-radius:8px;padding:14px 16px;margin-bottom:10px;background:rgba(255,255,255,0.9);box-shadow:0 4px 15px rgba(0,0,0,0.04)}'
    + '.scanner-container .card.glass-card:last-child{flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden;margin-bottom:0!important;position:relative!important;z-index:1!important}'

    // ===== حقول الإدخال العلوية =====
    + '.field-group{flex:1;min-width:280px;margin-bottom:5px;display:flex;flex-direction:column}'
    + '.field-group label{font-weight:700!important;color:#000!important;display:block;margin-bottom:8px;font-size:12px!important;line-height:1.2;text-align:right}'
    + '.input-row{display:flex;align-items:center;width:100%;direction:rtl}'
    + '.input-row .form-control{border:1px solid rgba(0,0,0,0.15)!important;border-radius:0 6px 6px 0!important;height:32px!important;font-size:12px!important;padding:4px 12px!important;width:100%!important;min-width:0!important;flex:1!important;text-align:right;direction:ltr}'
    + '.btn-save-draft{background-color:#2980b9!important;border:none!important;border-radius:6px 0 0 6px!important;height:32px!important;padding:0 15px!important;font-weight:600!important;font-size:12px!important;color:#fff!important;display:flex;align-items:center;justify-content:center;cursor:pointer;white-space:nowrap;margin-right:-1px;transition:background .2s}'
    + '.btn-save-draft:hover{background-color:#2471a3!important}'
    + '.btn-post-batch{background-color:#27ae60!important;border:none!important;border-radius:6px 0 0 6px!important;height:32px!important;padding:0 15px!important;font-weight:600!important;font-size:12px!important;color:#fff!important;display:none;align-items:center;justify-content:center;cursor:pointer;white-space:nowrap;margin-right:-1px;transition:background .2s}'
    + '.btn-post-batch:hover{background-color:#219a52!important}'
    + '.btn-delete-row{padding:1px 4px;border-radius:3px;border:1px solid #e74c3c;color:#e74c3c;background:transparent;cursor:pointer;font-size:10px;height:auto;display:inline;white-space:nowrap}'
     + '.btn-toggle-posting{padding:1px 4px;border-radius:3px;border:1px solid #ccc;color:#95a5a6;background:transparent;font-size:10px;height:auto;display:inline;white-space:nowrap;margin-left:2px}'
     + '.btn-toggle-posting:not([disabled]){cursor:pointer;color:#3498db;border-color:#3498db}'
     + '.btn-toggle-posting:not([disabled]):hover{background:#ebf5fb}'

    // ===== الأعمدة الثابتة (Sticky) =====
    + '.sticky-col-left{position:sticky!important;left:0!important;z-index:4!important;background:#fff!important;box-shadow:2px 0 5px rgba(0,0,0,0.04);border-right:2px solid rgba(0,0,0,0.08)!important}'
    + '.sticky-col-right-1{position:sticky!important;right:0!important;z-index:4!important;background:#fff!important;box-shadow:-2px 0 5px rgba(0,0,0,0.03)}'
    + '.sticky-col-right-2{position:sticky!important;right:' + COL_WIDTHS.checkbox + 'px!important;z-index:4!important;background:#fff!important;box-shadow:-2px 0 5px rgba(0,0,0,0.03)}'
    + '.sticky-col-right-3{position:sticky!important;right:' + (COL_WIDTHS.checkbox + COL_WIDTHS.index) + 'px!important;z-index:4!important;background:#fff!important;box-shadow:-3px 0 5px rgba(0,0,0,0.04);border-left:2px solid rgba(0,0,0,0.08)!important}'
    + '#editor-table thead th.sticky-col-left{position:sticky!important;top:0!important;left:0!important;z-index:105!important;background:#f8f9fa!important;box-shadow:2px 0 5px rgba(0,0,0,0.04),inset 0 -1.5px 0 rgba(0,0,0,0.12)!important;will-change:transform}'
    + '#editor-table thead th.sticky-col-right-1{position:sticky!important;top:0!important;right:0!important;z-index:105!important;background:#f8f9fa!important;box-shadow:-2px 0 5px rgba(0,0,0,0.03),inset 0 -1.5px 0 rgba(0,0,0,0.12)!important;will-change:transform}'
    + '#editor-table thead th.sticky-col-right-2{position:sticky!important;top:0!important;right:' + COL_WIDTHS.checkbox + 'px!important;z-index:105!important;background:#f8f9fa!important;box-shadow:-2px 0 5px rgba(0,0,0,0.03),inset 0 -1.5px 0 rgba(0,0,0,0.12)!important;will-change:transform}'
    + '#editor-table thead th.sticky-col-right-3{position:sticky!important;top:0!important;right:' + (COL_WIDTHS.checkbox + COL_WIDTHS.index) + 'px!important;z-index:105!important;background:#f8f9fa!important;box-shadow:-3px 0 5px rgba(0,0,0,0.04),inset 0 -1.5px 0 rgba(0,0,0,0.12)!important;border-left:2px solid rgba(0,0,0,0.08)!important;will-change:transform}'

    // ===== تلوين الصف بالكامل (خلفية + خلايا + حقول إدخال) =====
    + '.row-archived{background-color:#fff3e0!important}.row-archived td{background-color:#fff3e0!important}'
    + '.row-missing{background-color:#ffebee!important}.row-missing td{background-color:#ffebee!important}'
    + '.row-archived .sticky-col-right-1,.row-archived .sticky-col-right-2,.row-archived .sticky-col-right-3,.row-archived .sticky-col-left{background-color:#fff3e0!important}'
    + '.row-missing .sticky-col-right-1,.row-missing .sticky-col-right-2,.row-missing .sticky-col-right-3,.row-missing .sticky-col-left{background-color:#ffebee!important}'


    // ===== الجدول =====
    +     '.table-responsive{overflow-x:auto;overflow-y:auto;width:100%;-webkit-overflow-scrolling:touch;flex:1;min-height:0}'
+ '#editor-table{margin-bottom:0;font-size:10.5px;width:max-content;min-width:1800px;direction:rtl;text-align:right;border-collapse:collapse}'
    + '#editor-table thead th{position:sticky!important;top:0!important;z-index:100!important;background:#f8f9fa!important;box-shadow:inset 0 -1.5px 0 rgba(0,0,0,0.12)!important;white-space:nowrap!important;color:#000!important;font-weight:bold!important;font-size:13px!important;padding:12px;vertical-align:middle}'
    + '#editor-table tbody td{padding:4px 5px;vertical-align:middle;font-size:10px;line-height:1.4;border:1px solid #e5e7eb;white-space:nowrap}'

    // ===== عرض الأعمدة =====
    + '.th-checkbox{width:' + COL_WIDTHS.checkbox + 'px;min-width:' + COL_WIDTHS.checkbox + 'px;max-width:' + COL_WIDTHS.checkbox + 'px;text-align:center}'
    + '.th-index{width:' + COL_WIDTHS.index + 'px;min-width:' + COL_WIDTHS.index + 'px;max-width:' + COL_WIDTHS.index + 'px;text-align:center}'
    + '.th-actions{width:' + COL_WIDTHS.actions + 'px;min-width:' + COL_WIDTHS.actions + 'px;max-width:' + COL_WIDTHS.actions + 'px;text-align:center}'
    + '.td-cell{padding:0;text-align:center;vertical-align:middle}'
     + '.td-index{font-weight:bold;color:#7f8c8d;vertical-align:middle;text-align:center;padding:4px;width:' + COL_WIDTHS.index + 'px;min-width:' + COL_WIDTHS.index + 'px;max-width:' + COL_WIDTHS.index + 'px;font-size:11px}'
     + '.td-ref{font-weight:bold;vertical-align:middle;padding:3px 6px;width:' + COL_WIDTHS.ref + 'px;min-width:' + COL_WIDTHS.ref + 'px;max-width:' + COL_WIDTHS.ref + 'px;font-size:11px}'
     + '.td-actions{text-align:center;vertical-align:middle;white-space:nowrap;padding:2px 4px;width:' + COL_WIDTHS.actions + 'px;min-width:' + COL_WIDTHS.actions + 'px;max-width:' + COL_WIDTHS.actions + 'px}'
    + '.td-center{text-align:center;vertical-align:middle;padding:4px 0;width:' + COL_WIDTHS.checkbox + 'px;min-width:' + COL_WIDTHS.checkbox + 'px;max-width:' + COL_WIDTHS.checkbox + 'px}'

    // ===== عرض أعمدة البيانات (قابلة للتعديل يدوياً من المتغيرات في بداية الملف) =====
    + '#editor-table thead th:nth-child(4){width:' + COL_WIDTHS.file_number + 'px;min-width:' + COL_WIDTHS.file_number + 'px}'
    + '#editor-table thead th:nth-child(5){width:' + COL_WIDTHS.year + 'px;min-width:' + COL_WIDTHS.year + 'px}'
    + '#editor-table thead th:nth-child(6){width:' + COL_WIDTHS.petitioner + 'px;min-width:' + COL_WIDTHS.petitioner + 'px}'
    + '#editor-table thead th:nth-child(7){width:' + COL_WIDTHS.respondent + 'px;min-width:' + COL_WIDTHS.respondent + 'px}'
    + '#editor-table thead th:nth-child(8){width:' + COL_WIDTHS.judge + 'px;min-width:' + COL_WIDTHS.judge + 'px}'
    + '#editor-table thead th:nth-child(9){width:' + COL_WIDTHS.secretary + 'px;min-width:' + COL_WIDTHS.secretary + 'px}'
    + '#editor-table thead th:nth-child(10){width:' + COL_WIDTHS.current_secretary + 'px;min-width:' + COL_WIDTHS.current_secretary + 'px}'
    + '#editor-table thead th:nth-child(11){width:' + COL_WIDTHS.status + 'px;min-width:' + COL_WIDTHS.status + 'px}'
    + '#editor-table thead th:nth-child(12){width:' + COL_WIDTHS.new_status + 'px;min-width:' + COL_WIDTHS.new_status + 'px}'
    + '#editor-table thead th:nth-child(13){width:' + COL_WIDTHS.posting_type + 'px;min-width:' + COL_WIDTHS.posting_type + 'px}'
    + '#editor-table thead th:nth-child(14){width:' + COL_WIDTHS.execution_file_no + 'px;min-width:' + COL_WIDTHS.execution_file_no + 'px}'
    + '#editor-table thead th:nth-child(15){width:' + COL_WIDTHS.archive_date + 'px;min-width:' + COL_WIDTHS.archive_date + 'px}'
    + '#editor-table thead th:nth-child(16){width:' + COL_WIDTHS.archive_year + 'px;min-width:' + COL_WIDTHS.archive_year + 'px}'
    + '#editor-table thead th:nth-child(17){width:' + COL_WIDTHS.archive_month + 'px;min-width:' + COL_WIDTHS.archive_month + 'px}'
    + '#editor-table tbody td[data-col="1"]{width:' + COL_WIDTHS.file_number + 'px;min-width:' + COL_WIDTHS.file_number + 'px}'
    + '#editor-table tbody td[data-col="2"]{width:' + COL_WIDTHS.year + 'px;min-width:' + COL_WIDTHS.year + 'px}'
    + '#editor-table tbody td[data-col="3"]{width:' + COL_WIDTHS.petitioner + 'px;min-width:' + COL_WIDTHS.petitioner + 'px}'
    + '#editor-table tbody td[data-col="4"]{width:' + COL_WIDTHS.respondent + 'px;min-width:' + COL_WIDTHS.respondent + 'px}'
    + '#editor-table tbody td[data-col="5"]{width:' + COL_WIDTHS.judge + 'px;min-width:' + COL_WIDTHS.judge + 'px}'
    + '#editor-table tbody td[data-col="6"]{width:' + COL_WIDTHS.secretary + 'px;min-width:' + COL_WIDTHS.secretary + 'px}'
    + '#editor-table tbody td[data-col="7"]{width:' + COL_WIDTHS.current_secretary + 'px;min-width:' + COL_WIDTHS.current_secretary + 'px}'
    + '#editor-table tbody td[data-col="8"]{width:' + COL_WIDTHS.status + 'px;min-width:' + COL_WIDTHS.status + 'px}'
    + '#editor-table tbody td[data-col="9"]{width:' + COL_WIDTHS.new_status + 'px;min-width:' + COL_WIDTHS.new_status + 'px}'
    + '#editor-table tbody td[data-col="10"]{width:' + COL_WIDTHS.posting_type + 'px;min-width:' + COL_WIDTHS.posting_type + 'px}'
    + '#editor-table tbody td[data-col="11"]{width:' + COL_WIDTHS.execution_file_no + 'px;min-width:' + COL_WIDTHS.execution_file_no + 'px}'
    + '#editor-table tbody td[data-col="12"]{width:' + COL_WIDTHS.archive_date + 'px;min-width:' + COL_WIDTHS.archive_date + 'px}'
    + '#editor-table tbody td[data-col="13"]{width:' + COL_WIDTHS.archive_year + 'px;min-width:' + COL_WIDTHS.archive_year + 'px}'
    + '#editor-table tbody td[data-col="14"]{width:' + COL_WIDTHS.archive_month + 'px;min-width:' + COL_WIDTHS.archive_month + 'px}'

    // ===== حقل المرجع =====
    + '.ref-text{color:#000;font-weight:bold;font-size:12px}'
     + '.ref-edit-wrap{display:flex;gap:5px;align-items:center;width:100%}'
     + '.ref-edit-input{width:100%;border:1px solid rgba(231,76,60,0.4);border-radius:4px;padding:4px 8px;font-size:12px;color:#e74c3c;font-weight:bold;background:#fff;outline:none;text-align:left}'
    + '.row-selector-checkbox{cursor:pointer;width:14px;height:14px;transform:scale(1.2)}'

    // ===== خلايا الإدخال =====
    + '.cell-input{width:100%;border:none;background:transparent;padding:3px 6px;font-size:11px;font-family:inherit;outline:none;border-radius:3px;text-align:right;transition:all .2s ease}.cell-input:focus{outline:none}.row-archived .cell-input{background-color:#fff3e0!important;border-color:#e0c6a5}.row-missing .cell-input{background-color:#ffebee!important;border-color:#e0b4b4}select.cell-input{min-width:80px}.date-input{padding:2px 6px;text-align:center}'

    // ===== حقل معاون التنفيذ =====
    + '#scanner-secretary-container .frappe-control{margin-bottom:0!important;padding:0!important}'
    + '#scanner-secretary-container .form-group{margin-bottom:0!important;padding-bottom:0!important}'
    + '#scanner-secretary-container label.control-label{display:none!important}'
    + '#scanner-secretary-container input.form-control{height:32px!important;border-radius:6px!important;border:1px solid rgba(0,0,0,0.15)!important;font-size:13px!important;background-color:#fff!important;direction:rtl;text-align:right;padding:4px 8px}'
    + '#scanner-secretary-container .link-btn{height:32px!important;top:0!important;display:flex;align-items:center;justify-content:center}'

    // ===== شريط التصفح =====
    + '#table-pagination-bar{display:none;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-top:12px;padding-top:10px;border-top:1px solid rgba(0,0,0,0.06);direction:rtl;width:100%;font-size:11px;color:#6b7280}'
    + '#table-pagination-bar select{width:auto;display:inline-block;height:28px;font-size:11px;padding:2px 6px;border-radius:4px;border:1px solid rgba(0,0,0,0.15);cursor:pointer;background-color:#fff}'
    + '#pagination-info{font-size:11px;font-weight:bold;color:#718096;direction:rtl;white-space:nowrap}'
    + '#pagination-btn-prev,#pagination-btn-next{border:1px solid rgba(0,0,0,0.15)!important;background-color:#fff!important;border-radius:4px!important;padding:4px 10px!important;font-weight:bold!important;font-size:11px!important;color:#4a5568!important;cursor:pointer;display:flex;align-items:center;gap:4px;box-shadow:0 1px 2px rgba(0,0,0,0.04);height:28px}'
    + '#pagination-btn-prev i.fa,#pagination-btn-next i.fa{font-size:9px}'

    // ===== أزرار القائمة المنسدلة =====
    + '#scanner-btn-actions{border:1px solid rgba(0,0,0,0.15)!important;background-color:#fff!important;border-radius:6px!important;padding:4px 12px!important;font-weight:bold!important;font-size:11px!important;color:#4a5568!important;cursor:pointer;display:flex;align-items:center;gap:4px;box-shadow:0 1px 2px rgba(0,0,0,0.04);transition:all .2s}'
    + '#scanner-btn-actions i.fa-cogs{color:#2980b9}'
    + '.dropdown-menu-right{border-radius:6px;box-shadow:0 4px 15px rgba(0,0,0,0.08);border:1px solid rgba(0,0,0,0.08);font-size:12px;min-width:180px;text-align:right;direction:rtl;margin-top:5px}'
    + '.dropdown-menu-right .dropdown-item{padding:8px 12px;display:flex;align-items:center;gap:8px;color:#2d3748;text-decoration:none}'

    // ===== رأس الجدول القابل للفرز =====
    + '.sortable-header{cursor:pointer;user-select:none;white-space:nowrap!important}'
    + '.sortable-header:hover{background-color:rgba(41,128,185,0.05)!important;color:#2980b9!important}'
    + '.sortable-header i.fa{transition:color .2s ease;font-size:10px;margin-right:4px;opacity:.4}'
    + '.sortable-header:hover i.fa{color:#2980b9!important}'
    + '.sortable-header.sorted-asc i.fa-sort-up,.sortable-header.sorted-desc i.fa-sort-down{opacity:1;color:#2563eb}'

    // ===== مدخل المرجع =====
    + '#scanner-reference-input{border:1px solid rgba(0,0,0,0.15)!important;border-radius:0 6px 6px 0!important;height:32px!important;font-size:12px!important;padding:4px 12px!important;width:100%!important;min-width:0!important;flex:1!important;text-align:right;direction:ltr}'

    // ===== استجابة الشاشات الصغيرة =====
    + '@media(max-width:768px){.scanner-container{height:auto;min-height:calc(100vh - 110px)}.field-group{min-width:100%}.badge-counter{font-size:9px;padding:3px 6px}.card.glass-card{padding:10px}.input-row{flex-wrap:wrap}.btn-save-draft,.btn-post-batch{font-size:10px;padding:0 8px}}'

    // ===== أنماط الطباعة =====
    + '@media print{body{padding:10px}.card.glass-card{border:none;padding:0;margin:0;background:none;box-shadow:none}.header-actions-row,.actions-container,.btn,.dropdown{display:none!important}.badge-counter{border:1px solid #ccc!important;font-size:8px;padding:2px 5px;background:none!important;color:#000!important}.sticky-col-left,.sticky-col-right-1,.sticky-col-right-2,.sticky-col-right-3,.sticky-top-panel{position:static!important;background:none!important;box-shadow:none!important}#table-pagination-bar{display:none!important}.table-responsive{overflow:visible;border:none}#editor-table{font-size:8px;min-width:auto}#editor-table thead th{background:#eee!important;border:1px solid #999!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}#editor-table tbody td{border:1px solid #bbb;padding:3px}#editor-table tbody tr.row-archived td{background-color:#fff3e0!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}#editor-table tbody tr.row-missing td{background-color:#ffebee!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.cell-input{border:none;background:transparent;height:auto;padding:0;min-width:auto}}';

DBE.UI_TEMPLATE = function () {
    return '<style>' + DBE.CSS + '</style><div class="scanner-container">'
        + '<div class="header-actions-row">'
        + '<div class="counter-badges-container">'
        + '<span class="badge-counter badge-total" id="counter-total">' + __('الإجمالي') + ': 0</span>'
        + '<span class="badge-counter badge-active" id="counter-active">' + __('المنظور') + ': 0</span>'
        + '<span class="badge-counter badge-archived" id="counter-archived">' + __('المرحل') + ': 0</span>'
        + '<span class="badge-counter badge-missing" id="counter-missing">' + __('الغير موجود') + ': 0</span>'
        + '</div>'
        + '<div class="actions-container">'
        + '<div class="dropdown">'
        + '<button class="btn btn-default btn-xs dropdown-toggle" id="scanner-btn-actions" data-toggle="dropdown">'
        + '<i class="fa fa-cogs"></i> ' + __('إجراءات الأرشيف') + ' <i class="fa fa-caret-down"></i></button>'
        + '<ul class="dropdown-menu dropdown-menu-right">'
        + '<li><a class="dropdown-item" id="action-fetch-from-archive" href="#"><i class="fa fa-archive text-info"></i> ' + __('جلب من الأرشيف') + '</a></li>'
        + '<li id="separator-edit-batch" role="separator" style="display:none;"></li>'
        + '<li id="li-edit-batch" style="display:none;"><a class="dropdown-item" id="action-edit-batch" href="#"><i class="fa fa-pencil text-warning"></i> ' + __('تعديل الترويسة وبيانات المحفظة') + '</a></li>'
        + '<li id="separator-print" role="separator" style="display:none;"></li>'
        + '<li id="li-print" style="display:none;"><a class="dropdown-item" id="action-print" href="#"><i class="fa fa-print"></i> ' + __('طباعة') + '</a></li>'
        + '<li id="li-print-all"><a class="dropdown-item" id="action-print-all" href="#"><i class="fa fa-print"></i> ' + __('طباعة الكل') + '</a></li>'
        + '</ul></div>'
        + '<button class="btn btn-default btn-xs" id="btn-delete-archive" style="display:none;margin-right:4px;" title="' + __('حذف ملف أرشيف غير مرحل') + '"><i class="fa fa-trash text-danger"></i> ' + __('حذف ملف أرشيف') + '</button></div></div>'

        + '<div class="card glass-card sticky-top-panel">'
        + '<div class="sticky-row-container">'
        + '<div class="field-group"><label>' + __('أمين السر') + '</label><div id="scanner-secretary-container"></div></div>'
        + '<div class="field-group"><label>' + __('رقم مرجع ملف المنازعات (Reference)') + '</label>'
        + '<div class="input-row">'
        + '<input type="text" id="scanner-reference-input" class="form-control" placeholder="' + __('أدخل رقم المرجع واضغط Enter للإضافة السريعة بالجدول...') + '">'
        + '<button class="btn-save-draft" id="action-save-draft"><i class="fa fa-save"></i> ' + __('حفظ الأرشيف') + '</button>'
        + '<button class="btn-post-batch" id="scanner-btn-post"><i class="fa fa-paper-plane"></i> ' + __('ترحيل ملف الأرشيف') + '</button>'
        + '</div></div></div></div>'

        + '<div class="card glass-card">'
        + '<div class="table-responsive">'
        + '<table class="table table-bordered table-hover" id="editor-table">'
        + '<thead><tr>'
        + '<th class="sticky-col-right-1 th-checkbox"><input type="checkbox" id="select-all-rows" title="' + __('تحديد / إلغاء تحديد الكل') + '"></th>'
        + '<th class="sticky-col-right-2 th-index">#</th>'
        + '<th class="sortable-header sticky-col-right-3">' + __('المرجع') + ' <i class="fa fa-sort"></i></th>'
        + '<th class="sortable-header">' + __('رقم الملف') + ' <i class="fa fa-sort"></i></th>'
        + '<th class="sortable-header">' + __('السنة') + ' <i class="fa fa-sort"></i></th>'
        + '<th class="sortable-header">' + __('المدعي') + ' <i class="fa fa-sort"></i></th>'
        + '<th class="sortable-header">' + __('المدعى عليه') + ' <i class="fa fa-sort"></i></th>'
        + '<th class="sortable-header">' + __('القاضي المختص') + ' <i class="fa fa-sort"></i></th>'
        + '<th class="sortable-header">' + __('أمين السر') + ' <i class="fa fa-sort"></i></th>'
        + '<th class="sortable-header">' + __('أمين السر الحالي') + ' <i class="fa fa-sort"></i></th>'
        + '<th class="sortable-header">' + __('حالة الملف') + ' <i class="fa fa-sort"></i></th>'
        + '<th class="sortable-header">' + __('حالة الملف الجديدة') + ' <i class="fa fa-sort"></i></th>'
        + '<th class="sortable-header">' + __('نوع الترحيل') + ' <i class="fa fa-sort"></i></th>'
        + '<th class="sortable-header">' + __('رقم ملف التنفيذ') + ' <i class="fa fa-sort"></i></th>'
        + '<th class="sortable-header">' + __('تاريخ الأرشيف ميلادي') + ' <i class="fa fa-sort"></i></th>'
        + '<th class="sortable-header">' + __('سنة الأرشفة هجري') + ' <i class="fa fa-sort"></i></th>'
        + '<th class="sortable-header">' + __('الشهر الهجري') + ' <i class="fa fa-sort"></i></th>'
        + '<th class="sticky-col-left th-actions">' + __('حذف') + '</th>'
        + '</tr></thead>'
        + '<tbody id="scanner-results-body">'
        + '<tr id="empty-row"><td colspan="18" class="text-center text-muted">' + __('لا توجد ملفات حالياً. ابدأ بإدخال المرجع للبدء في التعديل السريع.') + '</td></tr>'
        + '</tbody>'
        + '</table></div>'

        + '<div id="table-pagination-bar">'
        + '<div style="display:flex;align-items:center;gap:8px;"><span>' + __('عدد السجلات في الصفحة:') + '</span>'
        + '<select id="pagination-page-size" class="form-control" style="width:80px;"><option value="10">10</option><option value="25" selected>25</option><option value="50">50</option><option value="all">' + __('الكل') + '</option></select></div>'
        + '<div id="pagination-info">' + __('إجمالي') + ': 0 ' + __('سجل') + '</div>'
        + '<div style="display:flex;gap:6px;align-items:center;"><button class="btn btn-default btn-xs" id="pagination-btn-prev"><i class="fa fa-chevron-right" style="margin-left:2px;"></i> ' + __('السابق') + '</button>'
        + '<button class="btn btn-default btn-xs" id="pagination-btn-next">' + __('التالي') + ' <i class="fa fa-chevron-left" style="margin-right:2px;"></i></button></div>'
        + '</div></div></div>';
};

// =============================================================================
// نقطة البداية (Page Load)
// =============================================================================

frappe.pages['dispute-batch-editor-v2'].on_page_load = function (wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __('محرر دفعات ملفات المنازعات المطور'),
        single_column: true
    });

    // تحميل أنواع الترحيل أولاً، ثم بناء الواجهة
    frappe.call({
        method: 'judicial_files.judicial_files.page.dispute_batch_editor_v2.dispute_batch_editor_v2.get_posting_types',
        callback: function (r) {
            if (r.message) {
                DBE.State.posting_types = r.message.map(function (pt) { return pt.posting_type; });
            }
            $(page.body).html(DBE.UI_TEMPLATE());
            DBE.Events.setup(page);
        }
    });
};
