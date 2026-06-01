// =============================================================================
// dispute_mail_editor.js — محرر البريد لملفات المنازعات
// =============================================================================
// المعمارية: Data-Driven Architecture — الفصل التام بين البيانات والواجهة
// =============================================================================
// Namespace  │ المسؤولية
// -----------┼--------------------------------------------------------------
// DME.State  │ الحالة العامة (records[], mail_statuses, pagination...)
// DME.Store  │ Actions: add_row / update_row_field / delete_row / clear
// DME.Logic  │ Business Rules: قواعد العمل والتبعيات بين الحقول
// DME.Template│ HTML Template: توليد HTML الصف من كائن البيانات
// DME.UI     │ Rendering: renderGrid / renderRow / pagination / reindex
// DME.Grid   │ Grid Actions: perform_search / add_file / delete_row
// DME.Batch  │ API Layer: save_draft / load_batch / post_batch
// DME.Print  │ Printing: action_print / action_print_all
// DME.Events │ Event Delegation: مستمع أحداث موحد على مستوى الجدول
// =============================================================================

// =============================================================================
// قيم عرض الأعمدة
// =============================================================================

var COL_WIDTHS = {
    checkbox: 40,
    index: 40,
    ref: 60,
    file_number: 60,
    year: 40,
    petitioner: 160,
    respondent: 160,
    judge: 120,
    secretary: 120,
    current_secretary: 120,
    execution_file_no: 80,
    status: 60,
    upload_mail: 50,
    upload_mail_date: 100,
    mail_returned: 50,
    mail_returned_date: 100,
    mail_status: 100,
    mail_notes: 140,
    mail_batch: 100,
    actions: 80,
};

// =============================================================================
// DME.State — الحالة العامة لمحرر البريد
// =============================================================================

var DME = {};

DME.State = {
    records: [], // المصفوفة المركزية للبيانات
    mail_statuses: [],
    scan_index: 0,
    scanned_references: new Set(),
    current_page: 1,
    records_per_page: 25,

    // بيانات المحفظة النشطة
    active_batch_name: null,
    active_batch_title: '',
    active_batch_description: '',

    is_readonly_mode: false,
    is_reply_mode: false,  // true بعد الضغط على "إضافة رد" وقبل الحفظ كمسودة
};

// =============================================================================
// DME.Store — إدارة البيانات المركزية (Actions)
// =============================================================================
DME.Store = {
    // إضافة صف جديد
    add_row: function (data_obj) {
        // إنشاء معرّف فريد داخلي إذا لم يكن موجوداً
        data_obj._id = data_obj._id || 'row_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        DME.State.records.unshift(data_obj); // الإضافة في الأعلى
        return data_obj;
    },

    // تحديث حقل معين في صف
    update_row_field: function (id, field, value) {
        var row = DME.State.records.find(function (r) { return r._id === id; });
        if (row) {
            row[field] = value;
            // تلوين الحقول التي تم تعديلها برمجياً أو يدوياً
            if (!row.dirty_fields) row.dirty_fields = {};
            row.dirty_fields[field] = true;
            row.is_dirty = true;
            return row;
        }
        return null;
    },

    // مسح صف
    delete_row: function (id) {
        var idx = DME.State.records.findIndex(function (r) { return r._id === id; });
        if (idx !== -1) {
            DME.State.records.splice(idx, 1);
            return true;
        }
        return false;
    },

    // مسح السجلات
    clear_records: function () {
        DME.State.records = [];
        DME.State.scanned_references.clear();
        DME.State.scan_index = 0;
    },

    // جلب جميع السجلات
    get_all: function () {
        return DME.State.records;
    }
};

// =============================================================================
// DME.Logic — هندسة قواعد العمل (Business Rules)
// =============================================================================
DME.Logic = {
    // تطبيق القواعد المبدئية عند إضافة صف جديد
    apply_new_row_rules: function (row) {
        var is_pending = (row.status === 'منظور');

        row.upload_mail = is_pending ? '1' : '0';
        row.upload_mail_date = is_pending ? new Date().toISOString().split('T')[0] : '';
        row.mail_status = is_pending ? 'معلق' : '';
        row.mail_returned = '0';
        row.mail_returned_date = '';
        row.mail_notes = '';

        // تعليم الحقول المعدلة تلقائياً
        row.dirty_fields = {
            upload_mail: true,
            upload_mail_date: true,
            mail_status: true
        };
        row.is_dirty = true;

        return row;
    },

    // معالجة التبعيات عند تغيير أحد الحقول
    resolve_dependencies: function (row, changed_field) {
        if (changed_field === 'upload_mail') {
            var is_checked = (row.upload_mail == 1 || row.upload_mail === '1' || row.upload_mail === true);
            
            // القاعدة: لا يمكن رفع البريد إلا إذا كانت حالة الملف "منظور"
            if (is_checked && row.status !== 'منظور') {
                frappe.msgprint(__('لا يمكن تحديد "رفع البريد" لملف حالته ليست "منظور"'));
                row.upload_mail = '0';
                is_checked = false;
            }

            if (is_checked) {
                if (!row.upload_mail_date) {
                    row.upload_mail_date = new Date().toISOString().split('T')[0];
                    row.dirty_fields = row.dirty_fields || {};
                    row.dirty_fields['upload_mail_date'] = true;
                }
                // تعيين معلق تلقائياً إذا تم تحديد الرفع ولم يكن له حالة
                if (!row.mail_status) {
                    row.mail_status = 'معلق';
                    row.dirty_fields = row.dirty_fields || {};
                    row.dirty_fields['mail_status'] = true;
                }
            } else {
                // إذا تم إلغاء رفع البريد، يتم مسح حالة البريد وتواريخه
                row.upload_mail_date = '';
                row.mail_status = '';
                row.mail_returned = '0';
                row.mail_returned_date = '';
                
                row.dirty_fields = row.dirty_fields || {};
                row.dirty_fields['upload_mail_date'] = true;
                row.dirty_fields['mail_status'] = true;
                row.dirty_fields['mail_returned'] = true;
                row.dirty_fields['mail_returned_date'] = true;
            }
        } // نهاية if (changed_field === 'upload_mail')
        if (changed_field === 'mail_returned') {
            var is_checked = (row.mail_returned == 1 || row.mail_returned === '1' || row.mail_returned === true);
            if (is_checked) {
                if (!row.mail_returned_date) {
                    row.mail_returned_date = new Date().toISOString().split('T')[0];
                    row.dirty_fields = row.dirty_fields || {};
                    row.dirty_fields['mail_returned_date'] = true;
                }

            }
        }
        return row;
    }
};

// =============================================================================
// DME.Template — نظام القوالب (Smart Template Engine)
// =============================================================================
DME.Template = {
    row: function (row) {
        var is_archived = (row.status === 'مرحل');
        var is_missing = row.is_missing;
        var row_class = is_missing ? 'row-missing' : (is_archived ? 'row-archived' : '');

        var file_link_html = !is_missing
            ? '<span class="ref-text">' + frappe.utils.escape_html(row.reference) + '</span>'
            : '<div class="ref-edit-wrap"><input type="text" class="ref-edit-input" value="'
            + frappe.utils.escape_html(row.reference || '')
            + '" data-id="' + row._id
            + '" data-original-ref="' + frappe.utils.escape_html(row.reference || '')
            + '" placeholder="' + __('اكتب المرجع واضغط Enter...') + '"></div>';

        // readonly_attr: للحقول الإعلامية فقط (file_number, year, petitioner...)
        // في وضع الاستعراض نستخدم CSS class على الجدول بدلاً من disabled
        var readonly_attr = !is_missing ? 'readonly' : '';
        // input_disabled_attr: يُعطّل حقول البريد فقط عند الصفوف المفقودة
        var input_disabled_attr = !is_missing ? '' : 'disabled';
        
        // تعطيل رفع البريد إذا كانت حالة الملف ليست منظور
        var upload_mail_disabled_attr = (!is_missing && row.status !== 'منظور') ? 'disabled' : input_disabled_attr;
        
        var input_style = 'cell-input';
        var select_style = 'cell-input mail-status-select';

        var mail_status_options = '<option value="" selected disabled style="display:none;"></option>';
        var filtered_statuses = DME.State.mail_statuses.filter(function (ms) {
            if (DME.State.is_reply_mode) return ms.mail_status !== 'معلق';
            return ms.mail_status === 'معلق';
        });
        filtered_statuses.forEach(function (ms) {
            var selected = (ms.mail_status === row.mail_status) ? 'selected' : '';
            mail_status_options += '<option value="' + ms.mail_status + '" ' + selected + '>' + ms.mail_status + '</option>';
        });

        // حالة الحقول التابعة للبريد (Disable/Opacity)
        var mail_disabled = (!is_missing && is_archived && row.status !== 'منظور') || (row.upload_mail != 1 && row.upload_mail !== '1' && row.upload_mail !== true);
        var field_disabled_attr = DME.State.is_reply_mode ? '' : (mail_disabled ? 'disabled' : '');
        // في مرحلة رفع البريد (غير reply mode)، حقول الرد تكون مقفلة دائماً
        var reply_field_disabled_attr = DME.State.is_reply_mode ? '' : 'disabled';
        var field_opacity = 'opacity: 1;';
        var container_opacity = 'opacity: 1;';

        // الألوان (الخلفية فقط للحقول المُعدلة، بينما لون الصف الأساسي تتولاه كلاسات الـ CSS)
        var dirty = row.dirty_fields || {};
        var get_bg = function (field) {
            if (dirty[field]) return 'background-color: #fffdeb;';
            return 'background-color: transparent;';
        };

        // مساعدة لإضافة لون النص البرتقالي للقيم المعبأة فقط
        var text_orange = function (val) {
            return (val && val !== '0' && val !== 0 && val !== false) ? ' text-orange-val' : '';
        };

        // دالة لعرض التاريخ بصيغة يوم-شهر-سنة للمستخدم
        var user_date = function(val) {
            if (!val) return '';
            return frappe.datetime.str_to_user(val);
        };

        var html = '<tr id="' + row._id + '" class="' + row_class + '" data-id="' + row._id + '">'
            + '<td class="sticky-col-right-1 td-center"><input type="checkbox" class="row-selector-checkbox" title="' + __('تحديد هذا الصف') + '"></td>'
            + '<td class="sticky-col-right-2 td-center td-index"></td>' // سيتم تحديثه عبر reindex
            + '<td class="sticky-col-right-3 td-ref">' + file_link_html + '</td>'
            + '<td class="td-cell"><input type="text" class="' + input_style + '" value="' + (row.file_number || '') + '" data-fieldname="file_number" ' + readonly_attr + ' tabindex="-1"></td>'
            + '<td class="td-cell"><input type="text" class="' + input_style + '" value="' + (row.year || '') + '" data-fieldname="year" ' + readonly_attr + ' tabindex="-1"></td>'
            + '<td class="td-cell"><input type="text" class="' + input_style + '" value="' + (row.petitioner || '') + '" data-fieldname="petitioner" ' + readonly_attr + ' tabindex="-1"></td>'
            + '<td class="td-cell"><input type="text" class="' + input_style + '" value="' + (row.respondent || '') + '" data-fieldname="respondent" ' + readonly_attr + ' tabindex="-1"></td>'
            + '<td class="td-cell"><input type="text" class="' + input_style + '" value="' + (row.judge || '') + '" data-fieldname="judge" ' + readonly_attr + ' tabindex="-1"></td>'
            + '<td class="td-cell"><input type="text" class="' + input_style + '" value="' + (row.secretary || '') + '" data-fieldname="secretary" ' + readonly_attr + ' tabindex="-1"></td>'
            + '<td class="td-cell"><input type="text" class="' + input_style + '" value="' + (row.current_secretary || '') + '" data-fieldname="current_secretary" ' + readonly_attr + ' tabindex="-1"></td>'
            + '<td class="td-cell"><input type="text" class="' + input_style + '" value="' + (row.execution_file_no || '') + '" data-fieldname="execution_file_no" ' + readonly_attr + ' tabindex="-1"></td>'
            + '<td class="td-cell"><input type="text" class="' + input_style + '" value="' + (row.status || '') + '" data-fieldname="status" ' + readonly_attr + ' tabindex="-1"></td>'

+ '<td class="td-cell mail-fields-container mail-field-status" style="' + container_opacity + get_bg('mail_status') + '">'
+ '<select class="' + select_style + text_orange(row.mail_status) + (dirty['mail_status'] ? ' is-dirty' : '') + '" ' + input_disabled_attr + ' ' + field_disabled_attr + ' style="' + field_opacity + '" data-fieldname="mail_status">' + mail_status_options + '</select></td>'

            + '<td class="td-cell mail-fields-container mail-field-upload" style="' + get_bg('upload_mail') + '">'
            + '<input type="checkbox" class="' + input_style + ' mail-checkbox ' + (dirty['upload_mail'] ? ' is-dirty' : '') + '" value="1" ' + ((row.upload_mail == 1 || row.upload_mail === '1' || row.upload_mail === true) ? 'checked' : '') + ' ' + upload_mail_disabled_attr + ' data-fieldname="upload_mail"></td>'

             + '<td class="td-cell mail-fields-container mail-field-upload date-picker-wrapper" style="' + container_opacity + get_bg('upload_mail_date') + '">'
             + '<input type="text" data-fieldtype="Date" class="' + input_style + ' date-input' + text_orange(row.upload_mail_date) + (dirty['upload_mail_date'] ? ' is-dirty' : '') + '" value="' + user_date(row.upload_mail_date) + '" data-sys-date="' + (row.upload_mail_date || '') + '" ' + input_disabled_attr + ' ' + field_disabled_attr + ' style="' + field_opacity + '" data-fieldname="upload_mail_date"></td>'

            + '<td class="td-cell mail-fields-container mail-field-reply" style="' + container_opacity + get_bg('mail_returned') + '">'
            + '<input type="checkbox" class="' + input_style + ' mail-checkbox ' + (dirty['mail_returned'] ? ' is-dirty' : '') + '" value="1" ' + ((row.mail_returned == 1 || row.mail_returned === '1' || row.mail_returned === true) ? 'checked' : '') + ' ' + input_disabled_attr + ' ' + reply_field_disabled_attr + ' style="' + field_opacity + '" data-fieldname="mail_returned"></td>'

             + '<td class="td-cell mail-fields-container mail-field-reply date-picker-wrapper" style="' + container_opacity + get_bg('mail_returned_date') + '">'
             + '<input type="text" data-fieldtype="Date" class="' + input_style + ' date-input' + text_orange(row.mail_returned_date) + (dirty['mail_returned_date'] ? ' is-dirty' : '') + '" value="' + user_date(row.mail_returned_date) + '" data-sys-date="' + (row.mail_returned_date || '') + '" ' + input_disabled_attr + ' ' + reply_field_disabled_attr + ' style="' + field_opacity + '" data-fieldname="mail_returned_date"></td>'

            + '<td class="td-cell mail-fields-container mail-field-reply" style="' + container_opacity + get_bg('mail_notes') + '">'
            + '<input type="text" class="' + input_style + text_orange(row.mail_notes) + (dirty['mail_notes'] ? ' is-dirty' : '') + '" value="' + frappe.utils.escape_html(row.mail_notes || '') + '" ' + input_disabled_attr + ' ' + reply_field_disabled_attr + ' style="' + field_opacity + '" data-fieldname="mail_notes"></td>'

            + '<td class="td-cell"><input type="text" class="' + input_style + '" value="' + (row.judicial_mail_batch || '') + '" data-fieldname="judicial_mail_batch" readonly tabindex="-1"></td>'

            + '<td class="sticky-col-left td-actions">'
            + '<button class="btn-mail-delete-row" title="' + __('حذف') + '" style="padding:1px 5px;border-radius:3px;border:1px solid #e74c3c;color:#e74c3c;background:transparent;cursor:pointer;font-size:10px;vertical-align:middle;"><i class="fa fa-trash" style="font-size:10px;"></i></button>'
            + '</tr>';

        return html;
    }
};

// =============================================================================
// DME.UI — دوال الواجهة المساعدة
// =============================================================================

DME.UI = {
    // --- دالة الرسم الأساسية (Render Grid) ---
    renderGrid: function () {
        var tbody = $('#mail-results-body');
        tbody.empty();

        var records = DME.Store.get_all();
        if (records.length === 0) {
            this.check_empty_table();
            this.update_counter();
            $('#table-pagination-bar').hide();
            return;
        }

        var html = '';
        records.forEach(function (row) {
            html += DME.Template.row(row);
        });

        tbody.html(html);

        this.reindex_rows();
        this.update_counter();
        this.apply_pagination();
        this.add_focus_styling();
        // تطبيق أوضاع CSS
        if (DME.State.is_reply_mode) {
            $('#editor-table').addClass('table-reply-mode').removeClass('table-readonly');
        } else if (DME.State.is_readonly_mode) {
            $('#editor-table').addClass('table-readonly').removeClass('table-reply-mode');
            $('#editor-table').find('input, select, button, textarea').attr('tabindex', '-1');
        } else {
            $('#editor-table').removeClass('table-readonly table-reply-mode');
        }
        this.init_date_pickers();
        this.updateMenuVisibility();
    },

    // --- تحديث صف معين (Render Row) ---
    renderRow: function (id) {
        var row = DME.State.records.find(function (r) { return r._id === id; });
        if (!row) return;

        var old_tr = $('#' + id);
        if (old_tr.length) {
            var new_html = DME.Template.row(row);
            old_tr.replaceWith(new_html);
        } else {
            this.renderGrid();
        }

        this.reindex_rows();
        this.init_date_pickers();
    },

    // --- العدادات ---
    update_counter: function () {
        var total = 0, active = 0, archived = 0, missing = 0;
        $('#mail-results-body tr').each(function () {
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

    // --- إظهار/إخفاء أزرار القائمة حسب حالة الصفحة ---
    updateMenuVisibility: function () {
        if (DME.State.is_readonly_mode || DME.State.is_reply_mode) {
            $('#li-fetch-mail-completed').hide();
        } else {
            $('#li-fetch-mail-completed').show();
        }
    },

    // --- التصفح (Pagination) ---
    apply_pagination: function () {
        var rows = $('#mail-results-body tr').not('#empty-row');
        var total_records = rows.length;

        if (total_records === 0) {
            $('#table-pagination-bar').hide();
            return;
        }
        $('#table-pagination-bar').css('display', 'flex');

        var is_all = (DME.State.records_per_page === Infinity || isNaN(DME.State.records_per_page));
        var total_pages = is_all ? 1 : Math.ceil(total_records / DME.State.records_per_page);

        if (DME.State.current_page > total_pages) DME.State.current_page = total_pages || 1;
        if (DME.State.current_page < 1) DME.State.current_page = 1;

        var start_idx = is_all ? 1 : (DME.State.current_page - 1) * DME.State.records_per_page + 1;
        var end_idx = is_all ? total_records : Math.min(DME.State.current_page * DME.State.records_per_page, total_records);

        var idx = 1;
        rows.each(function () {
            var tr = $(this);
            tr.toggle(is_all || (idx >= start_idx && idx <= end_idx));
            idx++;
        });

        var page_info = is_all
            ? __('إجمالي') + ': <strong>' + total_records + '</strong> ' + __('سجل')
            : __('إجمالي') + ': <strong>' + total_records + '</strong> ' + __('سجل') + ' | ' + __('صفحة') + ' <strong>' + DME.State.current_page + '</strong> ' + __('من') + ' <strong>' + total_pages + '</strong>';
        $('#pagination-info').html(page_info);

        $('#pagination-btn-prev').prop('disabled', is_all || DME.State.current_page <= 1)
            .css({ opacity: (is_all || DME.State.current_page <= 1) ? '0.5' : '1', cursor: (is_all || DME.State.current_page <= 1) ? 'not-allowed' : 'pointer' });
        $('#pagination-btn-next').prop('disabled', is_all || DME.State.current_page >= total_pages)
            .css({ opacity: (is_all || DME.State.current_page >= total_pages) ? '0.5' : '1', cursor: (is_all || DME.State.current_page >= total_pages) ? 'not-allowed' : 'pointer' });

        this.update_select_all_state();
    },

    update_select_all_state: function () {
        var visible = $('#mail-results-body tr:visible .row-selector-checkbox');
        var checked = $('#mail-results-body tr:visible .row-selector-checkbox:checked');
        $('#select-all-rows').prop('checked', visible.length > 0 && visible.length === checked.length);
    },

    // --- إعادة الفهرسة المرئية فقط (لا تمس data-id) ---
    reindex_rows: function () {
        var current_row = 1;
        $('#mail-results-body tr').each(function () {
            var tr = $(this);
            if (tr.attr('id') === 'empty-row') return;
            // تحديث العداد المرئي فقط — لا نمس data-id أو id الصف
            tr.find('td:nth-child(2)').text(current_row);
            tr.find('.cell-input, .ref-edit-input').attr('data-row', current_row);
            current_row++;
        });
        DME.State.scan_index = current_row - 1;
        this.apply_pagination();
    },

    // --- فحص الجدول الفارغ ---
    check_empty_table: function () {
        var rows = $('#mail-results-body tr');
        if (rows.length === 0 || (rows.length === 1 && rows.attr('id') === 'empty-row')) {
            DME.State.scan_index = 0;
            $('#mail-results-body').html(
                '<tr id="empty-row"><td colspan="18" class="text-center text-muted" style="padding: 50px; font-size: 14px; text-align: center;">'
                + __('لا توجد سجلات بريد حالياً. ابدأ بإدخال المرجع للبحث.')
                + '</td></tr>'
            );
        }
    },

    // --- تنسيق التركيز (مطابق لـ v2) ---
    add_focus_styling: function () {
        $('.cell-input').off('focus.custom blur.custom').on('focus.custom', function () {
            var input = $(this);
            if (input.hasClass('is-dirty')) input.css({ 'background-color': '#fffbeb', 'box-shadow': 'inset 0 0 0 1.5px #f59e0b' });
            else input.css({ 'background-color': '#fff', 'box-shadow': 'inset 0 0 0 1.5px #2980b9' });
        }).on('blur.custom', function () {
            var input = $(this);
            if (input.hasClass('is-dirty')) input.css({ 'background-color': '#fffbeb', 'box-shadow': 'none' });
            else input.css({ 'background-color': 'transparent', 'box-shadow': 'none' });
        });
    },

    // --- تهيئة منتقي التاريخ المباشر باستخدام air-datepicker (Frappe v16) ---
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
                onSelect: function(formattedDate, date, inst) {
                    if (date) {
                        var sysDate = moment(date).format('YYYY-MM-DD');
                        var userDate = frappe.datetime.str_to_user(sysDate);
                        $input.val(userDate);
                        $input.data('sys-date', sysDate);

                        var dp = $input.data('datepicker');
                        if (dp && dp.selectDate) {
                            dp.selectDate(date);
                        }

                        var $tr = $input.closest('tr');
                        var id = $tr.data('id');
                        var fieldname = $input.data('fieldname');
                        if (id && fieldname) {
                            var row = DME.Store.update_row_field(id, fieldname, sysDate);
                            if (row) {
                                DME.Grid.mark_batch_as_dirty();
                            }
                        }

                        $input.trigger('change');
                    } else if (formattedDate === '') {
                        $input.val('');
                        $input.data('sys-date', '');
                        var $tr = $input.closest('tr');
                        var id = $tr.data('id');
                        var fieldname = $input.data('fieldname');
                        if (id && fieldname) {
                            var row = DME.Store.update_row_field(id, fieldname, '');
                            if (row) {
                                DME.Grid.mark_batch_as_dirty();
                            }
                        }
                        $input.trigger('change');
                    }
                }
            });

            // معالجة بسيطة لحذف النص (بدون clear() لتجنب تعطيل datepicker)
            $input.on('input', function () {
                if ($(this).val().trim() === '') {
                    $(this).data('sys-date', '');
                }
            });

            // معالجة زر اليوم
            var dp = $input.data('datepicker');
            if (dp && dp.$datepicker) {
                dp.$datepicker.find('[data-action="today"]').click(function() {
                    var now = new Date();
                    dp.selectDate(now);
                    dp.hide();
                });
            }
        });
    }
};

// =============================================================================
// DME.Grid — إدارة الجدول (إضافة، بحث، تعديل، حذف)
// =============================================================================

DME.Grid = {
    // --- تعليم المسودة على أنها غير محفوظة ---
    mark_batch_as_dirty: function () {
        if (DME.State.is_readonly_mode && !DME.State.is_reply_mode) return;
        $('#mail-btn-post').hide();
        $('#action-save-draft').css('display', 'flex');
        $('#li-print').hide();
    },

    // --- البحث عن ملف وإضافة صفوف بريده ---
    perform_search: function () {
        var reference = $('#mail-reference-input').val();
        if (!reference) {
            frappe.show_alert({ message: __('الرجاء كتابة رقم المرجع للبحث.'), indicator: 'orange' });
            $('#mail-reference-input').focus();
            return;
        }
        reference = reference.trim();

        if (DME.State.scanned_references.has(reference)) {
            frappe.show_alert({ message: __('هذا الملف مضاف بالفعل في الجدول!'), indicator: 'red' });
            $('#mail-reference-input').val('').focus();
            return;
        }

        frappe.call({
            method: 'judicial_files.judicial_files.page.dispute_mail_editor.dispute_mail_editor.get_dispute_file',
            args: { reference: reference },
            callback: function (r) {
                if (r.message) {
                    DME.Grid.add_file_to_grid(r.message, true);
                    DME.State.scanned_references.add(reference);
                    frappe.show_alert({ message: __('تم العثور على الملف وجلب بياناته.'), indicator: 'green' });
                } else {
                    DME.Grid.add_file_to_grid({
                        name: '', reference: reference, file_number: '', year: '',
                        petitioner: '', respondent: '', judge: '',
                        secretary: '', current_secretary: '',
                        status: ''
                    }, false);
                    DME.State.scanned_references.add(reference);
                    frappe.show_alert({ message: __('الملف غير موجود! تم إضافته كصف فارغ بلون أحمر.'), indicator: 'red' });
                }
                $('#mail-reference-input').val('').focus();
            }
        });
    },

    // --- إضافة ملف مع صف بريد فارغ واحد إلى الجدول ---
    add_file_to_grid: function (file, exists) {
        this.add_mail_row_to_grid(file, {}, exists);
    },

    // --- إضافة صف بريد للجدول ---
    add_mail_row_to_grid: function (file, mail_row, exists) {
        var is_new_row = (mail_row.upload_mail === undefined) && exists;

        var row_obj = {
            docname: file.name || '',
            name: file.name || '',
            reference: file.reference || '',
            file_number: file.file_number || '',
            year: file.year || '',
            petitioner: file.petitioner || '',
            respondent: file.respondent || '',
            judge: file.judge || '',
            secretary: file.secretary || '',
            current_secretary: file.current_secretary || '',
            execution_file_no: file.execution_file_no || '',
            status: file.status || '',

            is_missing: !exists,
            is_dirty: false,
            dirty_fields: {}
        };

        if (is_new_row) {
            row_obj = DME.Logic.apply_new_row_rules(row_obj);
        } else {
            row_obj.upload_mail = mail_row.upload_mail;
            row_obj.upload_mail_date = mail_row.upload_mail_date || '';
            row_obj.mail_returned = mail_row.mail_returned;
            row_obj.mail_returned_date = mail_row.mail_returned_date || '';
            // يجب ألا نعين "معلق" هنا أبدًا؛ نأخذ القيمة كما هي، سواء كانت للملفات المفقودة أو المحملة
            row_obj.mail_status = mail_row.mail_status || '';
            row_obj.mail_notes = mail_row.mail_notes || '';
        }

        DME.Store.add_row(row_obj);
        DME.UI.renderGrid();

        DME.State.current_page = 1;
        this.mark_batch_as_dirty();

        if (!exists) {
            setTimeout(function () {
                $('#mail-results-body tr:first-child .ref-edit-input').focus().select();
            }, 150);
        }
    },

    // --- إعادة البحث عن مرجع صف ---
    research_row_reference: function (tr) {
        var id = tr.data('id');
        var row = DME.State.records.find(function (r) { return r._id === id; });
        if (!row) return;

        var input = tr.find('.ref-edit-input');
        if (!input.length) return;
        var new_ref = input.val().trim();
        if (!new_ref) {
            frappe.show_alert({ message: __('الرجاء كتابة مرجع صالح.'), indicator: 'orange' });
            input.focus();
            return;
        }

        var old_ref = input.attr('data-original-ref') || '';

        var duplicate = DME.State.records.some(function (r) {
            return r._id !== id && r.reference === new_ref;
        });

        if (duplicate) {
            frappe.show_alert({ message: __('هذا المرجع مضاف بالفعل في سطر آخر!'), indicator: 'red' });
            input.focus();
            return;
        }

        input.prop('disabled', true).css({ opacity: '0.5', cursor: 'wait' });
        frappe.call({
            method: 'judicial_files.judicial_files.page.dispute_mail_editor.dispute_mail_editor.get_dispute_file',
            args: { reference: new_ref },
            callback: function (r) {
                if (r.message) {
                    var file = r.message;
                    if (old_ref) DME.State.scanned_references.delete(old_ref);
                    DME.State.scanned_references.add(new_ref);

                    row.docname = file.name;
                    row.name = file.name;
                    row.reference = file.reference;
                    row.file_number = file.file_number;
                    row.year = file.year;
                    row.petitioner = file.petitioner;
                    row.respondent = file.respondent;
                    row.judge = file.judge;
                    row.secretary = file.secretary;
                    row.current_secretary = file.current_secretary;
                    row.status = file.status;
                    row.is_missing = false;

                    DME.Logic.apply_new_row_rules(row);
                    DME.UI.renderGrid();
                    DME.Grid.mark_batch_as_dirty();

                    frappe.show_alert({ message: __('تم العثور على المرجع وجلب بيانات الملف.'), indicator: 'green' });
                    setTimeout(function () { $('#mail-reference-input').focus().select(); }, 150);
                } else {
                    if (old_ref !== new_ref) {
                        if (old_ref) DME.State.scanned_references.delete(old_ref);
                        DME.State.scanned_references.add(new_ref);
                        input.attr('data-original-ref', new_ref);
                    }
                    input.prop('disabled', false).css({ opacity: '1', cursor: 'text' });
                    frappe.show_alert({ message: __('لم يتم العثور على المرجع الجديد أيضاً.'), indicator: 'red' });
                }
            }
        });
    },

    // --- الحذف المنطقي للصف ---
    delete_row_logic: function (tr) {
        var id = tr.data('id');
        DME.Store.delete_row(id);
        DME.UI.renderGrid();
        this.mark_batch_as_dirty();
    },

    // --- بحث في الصفوف المفقودة ---
    trigger_row_search_lookup: function (tr) {
        var id = tr.data('id');
        var row = DME.State.records.find(function (r) { return r._id === id; });
        if (!row) return;

        var file_number = (row.file_number || '').trim();
        var year = (row.year || '').trim();
        var petitioner = (row.petitioner || '').trim();
        var respondent = (row.respondent || '').trim();

        if (!file_number && !year && !petitioner && !respondent) {
            frappe.show_alert({ message: __('الرجاء كتابة أي بيان للبحث.'), indicator: 'orange' });
            return;
        }

        frappe.call({
            method: 'judicial_files.judicial_files.page.dispute_mail_editor.dispute_mail_editor.search_dispute_files',
            args: { file_number: file_number, year: year, petitioner: petitioner, respondent: respondent },
            callback: function (r) {
                if (r.message && r.message.length > 0) {
                    if (r.message.length === 1) {
                        DME.Grid.populate_tr_with_file(tr, r.message[0]);
                    } else {
                        DME.Grid.show_selection_dialog(tr, r.message);
                    }
                } else {
                    frappe.show_alert({ message: __('لم يتم العثور على ملفات مطابقة.'), indicator: 'red' });
                }
            }
        });
    },

    // --- تعبئة صف ببيانات ملف ---
    populate_tr_with_file: function (tr, file) {
        var id = tr.data('id');
        var row = DME.State.records.find(function (r) { return r._id === id; });
        if (!row) return;

        if (row.reference) DME.State.scanned_references.delete(row.reference);
        DME.State.scanned_references.add(file.reference);

        row.docname = file.name;
        row.name = file.name;
        row.reference = file.reference;
        row.file_number = file.file_number;
        row.year = file.year;
        row.petitioner = file.petitioner;
        row.respondent = file.respondent;
        row.judge = file.judge;
        row.secretary = file.secretary;
        row.current_secretary = file.current_secretary;
        row.status = file.status;
        row.is_missing = false;

        DME.Logic.apply_new_row_rules(row);
        DME.UI.renderGrid();
        DME.Grid.mark_batch_as_dirty();

        frappe.show_alert({ message: __('تم جلب بيانات الملف وتحديث الجدول بنجاح!'), indicator: 'green' });
        setTimeout(function () { $('#mail-reference-input').focus().select(); }, 150);
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
                + '<td>' + (f.respondent || '') + '</td>'
                + '</tr>';
        });

        var dialog = new frappe.ui.Dialog({
            title: __('نتائج البحث المطابقة'),
            fields: [{
                fieldtype: 'HTML',
                fieldname: 'results_html',
                options: '<div style="max-height:350px;overflow-y:auto;direction:rtl;text-align:right;">'
                    + '<p style="font-size:13px;color:#7f8c8d;margin-bottom:15px;"><i class="fa fa-info-circle"></i> ' + __('انقر فوق الملف المطلوب:') + '</p>'
                    + '<table class="table table-bordered table-hover" id="dialog-lookup-table" style="font-size:12px;width:100%;direction:rtl;text-align:right;">'
                    + '<thead><tr style="background:#f8f9fa;"><th>' + __('المرجع') + '</th><th>' + __('رقم الملف') + '</th><th>' + __('السنة') + '</th><th>' + __('طالب التنفيذ') + '</th><th>' + __('المنفذ ضده') + '</th> </thead>'
                    + '<tbody>' + tbody_html + '</tbody>'
                    + '</table></div>'
            }],
            primary_action_label: __('إغلاق'),
            primary_action: function () { dialog.hide(); }
        });
        dialog.show();

        $(document).off('click', '#dialog-lookup-table tbody tr').on('click', '#dialog-lookup-table tbody tr', function () {
            var idx = $(this).data('index');
            if (files[idx]) DME.Grid.populate_tr_with_file(tr, files[idx]);
            dialog.hide();
        });
    },
};







// =============================================================================
// DME.Batch — إدارة المحفظة البريدية (حفظ، تحميل، ترحيل)
// =============================================================================

DME.Batch = {
    // --- تجميع بيانات الجدول ---
    collect_current_grid_items: function () {
        var records = DME.Store.get_all();
        var items = [];
        records.forEach(function (r) {
            if (r.is_missing && !r.reference) return;
            items.push({
                reference: r.reference,
                dispute_file: r.file_number ? r.docname || r.name || '' : '',
                file_number: r.file_number || '',
                year: r.year || '',
                petitioner: r.petitioner || '',
                respondent: r.respondent || '',
                judge: r.judge || '',
                secretary: r.secretary || '',
                current_secretary: r.current_secretary || '',
                execution_file_no: r.execution_file_no || '',
                original_status: r.status || '',
                upload_mail: (r.upload_mail == 1 || r.upload_mail === '1' || r.upload_mail === true) ? 1 : 0,
                upload_mail_date: r.upload_mail_date || '',
                mail_returned: (r.mail_returned == 1 || r.mail_returned === '1' || r.mail_returned === true) ? 1 : 0,
                mail_returned_date: r.mail_returned_date || '',
                mail_status: r.mail_status || '',
                mail_notes: r.mail_notes || '',
            });
        });
        return items;
    },

    // --- التحقق من وجود بيانات رد مسبقة ---
    has_reply_data: function () {
        for (var i = 0; i < DME.State.records.length; i++) {
            var r = DME.State.records[i];
            if (r.mail_returned == 1 || r.mail_returned === '1' || r.mail_returned === true || r.mail_returned_date) {
                return true;
            }
        }
        return false;
    },

    // --- مسح الجدول ومدير البيانات ---
    clear_grid: function () {
        // مسح مدير البيانات المركزي وإعادة ضبط الحالة
        DME.Store.clear_records();
        DME.State.current_page = 1;
        DME.State.active_batch_name = null;
        DME.State.active_batch_title = '';
        DME.State.active_batch_description = '';
        DME.State.is_readonly_mode = false;
        DME.State.is_reply_mode = false;
        // renderGrid تتولى: مسح الـ DOM، رسم الجدول الفارغ، تحديث العدادات، إخفاء التصفح
        DME.UI.renderGrid();
        // إعادة ضبط حالة واجهة المستخدم
        $('#active-batch-indicator').remove();
        $('#mail-reference-input').prop('disabled', false);
        $('#mail-btn-post').prop('disabled', false).css({ opacity: '1', display: 'flex' });
        $('#action-save-draft, #li-add-reply').hide();
        $('#li-print').hide();
    },

    // --- مؤشر المحفظة النشطة ---
    update_batch_indicator: function (title, is_posted, mode_label) {
        $('#active-batch-indicator').remove();
        if (!title) return;
        var color = '#27ae60';
        var icon = 'fa-envelope';
        var label = __('مرحل — للاستعراض فقط');
        if (mode_label === 'تعديل') {
            color = '#e67e22';
            icon = 'fa-pencil-square-o';
            label = __('تعديل محفظة بريد مرحل');
        } else if (!is_posted) {
            color = '#e67e22';
            icon = 'fa-pencil-square-o';
            label = __('مسودة نشطة');
        }
        $('#li-print').show();
        var html = '<div id="active-batch-indicator" style="display:inline-flex;align-items:center;gap:6px;background:' + color + '18;border:1px solid ' + color + '55;border-radius:6px;padding:4px 12px;font-size:11px;color:' + color + ';font-weight:bold;direction:rtl;margin-right:8px;">'
            + '<i class="fa ' + icon + '"></i>'
            + '<span>' + frappe.utils.escape_html(title) + '</span>'
            + '<span style="opacity:0.7;font-weight:normal;">— ' + label + '</span></div>';
        $('.header-center').html(html);
    },

    // --- تحميل بيانات محفظة بريد ---
    load_batch_into_grid: function (batch_data, readonly) {
        DME.Store.clear_records();
        DME.State.is_readonly_mode = !!readonly;
        DME.State.is_reply_mode = false;
        DME.State.active_batch_name = batch_data.name;
        DME.State.active_batch_title = batch_data.title || '';
        DME.State.active_batch_description = batch_data.description || '';

        var items = batch_data.items || [];
        // نعكس المصفوفة لأن add_row يضيف في البداية
        items.reverse().forEach(function (item) {
            var row_obj = {
                docname: item.dispute_file || '',
                name: item.dispute_file || '',
                reference: item.reference || '',
                file_number: item.file_number || '',
                year: item.year || '',
                petitioner: item.petitioner || '',
                respondent: item.respondent || '',
                judge: item.judge || '',
                secretary: item.secretary || '',
                current_secretary: item.current_secretary || '',
                execution_file_no: item.execution_file_no || '',
                status: item.original_status || '',

                upload_mail: item.upload_mail,
                upload_mail_date: item.upload_mail_date || '',
                mail_returned: item.mail_returned,
                mail_returned_date: item.mail_returned_date || '',
                // نحافظ على القيمة المخزنة كما هي — القيمة الافتراضية 'معلق' للصفوف الجديدة فقط
                mail_status: item.mail_status || '',
                mail_notes: item.mail_notes || '',

                is_missing: !item.dispute_file, // إذا لم يكن هناك ملف حقيقي
                is_dirty: false,
                dirty_fields: {}
            };
            DME.Store.add_row(row_obj);
            DME.State.scanned_references.add(item.reference);
        });

        DME.UI.renderGrid();

        if (DME.State.is_readonly_mode) {
            frappe.show_alert({ message: __('وضع الاستعراض: هذه المحفظة البريدية مرحلة ولا يمكن تعديلها.'), indicator: 'blue' });
            $('#mail-btn-post').prop('disabled', true).css('opacity', '0.5').hide();
            $('#action-save-draft').hide();
            if (DME.Batch.has_reply_data()) {
                $('#li-add-reply').hide();
            } else {
                $('#li-add-reply').show();
            }
        } else {
            $('#mail-btn-post').prop('disabled', false).css('opacity', '1');
            $('#action-save-draft').hide();
            $('#li-add-reply').hide();
        }

        this.update_batch_indicator(batch_data.title, DME.State.is_readonly_mode);
    },

    // --- حفظ كمسودة ---
    action_save_draft: function () {
        if (DME.State.is_readonly_mode && !DME.State.is_reply_mode) {
            frappe.show_alert({ message: __('لا يمكن الحفظ في وضع الاستعراض.'), indicator: 'red' });
            return;
        }
        var items = this.collect_current_grid_items();
        if (items.length === 0) {
            frappe.show_alert({ message: __('الجدول فارغ! أضف سجلات أولاً.'), indicator: 'orange' });
            return;
        }
        if (DME.State.active_batch_name) {
            this._do_save_draft(DME.State.active_batch_name, DME.State.active_batch_title,
                DME.State.active_batch_description, items);
            return;
        }
        this._show_batch_title_dialog(DME.State.active_batch_title, DME.State.active_batch_description,
            function (title, desc) {
                DME.Batch._do_save_draft(DME.State.active_batch_name, title, desc, items);
            });
    },

    // --- حوار عنوان المحفظة ---
    _show_batch_title_dialog: function (def_title, def_desc, on_confirm) {
        var dialog = new frappe.ui.Dialog({
            title: __('بيانات وحفظ المحفظة البريدية'),
            fields: [
                { fieldtype: 'Data', fieldname: 'title', label: __('عنوان المحفظة البريدية'), reqd: 1, default: def_title || 'بريد ملفات المنازعات ' + new Date().toLocaleDateString('ar-YE') },
                { fieldtype: 'Small Text', fieldname: 'description', label: __('ملاحظات / وصف (اختياري)'), default: def_desc || '' }
            ],
            primary_action_label: __('حفظ'),
            primary_action: function (values) {
                if (!values.title || !values.title.trim()) {
                    frappe.show_alert({ message: __('يجب إدخال عنوان للمحفظة.'), indicator: 'red' });
                    return;
                }
                dialog.hide();
                on_confirm(values.title.trim(), values.description || '');
            }
        });
        dialog.show();
    },

    // --- التنفيذ الفعلي للحفظ ---
    _do_save_draft: function (batch_name, title, desc, items) {
        frappe.call({
            method: 'judicial_files.judicial_files.page.dispute_mail_editor.dispute_mail_editor.save_batch_draft',
            args: {
                batch_name: batch_name || '',
                items: JSON.stringify(items),
                title: title || '',
                description: desc || '',
            },
            freeze: true, freeze_message: __('جاري حفظ المسودة...'),
            callback: function (r) {
                if (r.message && r.message.success) {
                    DME.State.active_batch_name = r.message.batch_name;
                    DME.State.active_batch_title = r.message.title;
                    DME.State.active_batch_description = desc || '';

                    // إذا كان في وضع إضافة رد، الرجوع إلى الوضع العادي بعد الحفظ
                    if (DME.State.is_reply_mode) {
                        DME.State.is_reply_mode = false;
                        DME.State.is_readonly_mode = false;
                        $('#mail-reference-input').prop('disabled', false);
                        $('#mail-btn-post').prop('disabled', false).css('opacity', '1');
                    }

                    DME.Batch.update_batch_indicator(r.message.title, false);
                    $('#action-save-draft').hide();
                    $('#mail-btn-post').css('display', 'flex');
                    DME.UI.renderGrid();
                    frappe.show_alert({ message: __('تم حفظ المحفظة البريدية بنجاح: {0}', [r.message.title]), indicator: 'green' });
                } else {
                    frappe.show_alert({ message: __('فشل الحفظ: ') + ((r.message && r.message.message) || ''), indicator: 'red' });
                }
            }
        });
    },

    // --- جلب من الأرشيف ---
    action_fetch_from_archive: function () {
        $.when(
            frappe.call({ method: 'judicial_files.judicial_files.page.dispute_mail_editor.dispute_mail_editor.get_draft_batches' }),
            frappe.call({ method: 'judicial_files.judicial_files.page.dispute_mail_editor.dispute_mail_editor.get_posted_batches' })
        ).done(function (drafts_res, posted_res) {
            var all = (drafts_res[0] ? drafts_res[0].message || [] : []).concat(posted_res[0] ? posted_res[0].message || [] : []);
            if (all.length === 0) {
                frappe.show_alert({ message: __('لا توجد محافظ بريدية في النظام.'), indicator: 'orange' });
                return;
            }
            DME.Batch._show_batch_selection_dialog(__('اختر محفظة بريدية'), all, function (chosen) {
                var is_posted_batch = chosen.status === 'Posted';
                frappe.call({
                    method: 'judicial_files.judicial_files.page.dispute_mail_editor.dispute_mail_editor.load_batch_data',
                    args: { batch_name: chosen.name },
                    freeze: true, freeze_message: __('جاري تحميل المحفظة البريدية...'),
                    callback: function (r2) {
                        if (r2.message) DME.Batch.load_batch_into_grid(r2.message, is_posted_batch);
                        else frappe.show_alert({ message: __('تعذر تحميل المحفظة البريدية!'), indicator: 'red' });
                    }
                });
            });
        });
    },

    // --- حوار اختيار محفظة بريدية ---
    _show_batch_selection_dialog: function (title, batches, on_select) {
        var all_batches = batches;
        var filtered_batches = batches.slice();

        function render_table() {
            var filter_desc = dialog.get_value('filter_description') || '';
            var filter_status = dialog.get_value('filter_status') || '';
            var filter_date_from = dialog.get_value('filter_date_from') || '';
            var filter_date_to = dialog.get_value('filter_date_to') || '';

            filtered_batches = all_batches.filter(function (b) {
                if (filter_desc && (b.description || '').indexOf(filter_desc) === -1) return false;
                if (filter_status === __('مسودة') && b.status !== 'Draft') return false;
                if (filter_status === __('مرحل') && b.status !== 'Posted') return false;
                if (filter_date_from || filter_date_to) {
                    var date_val = b.status === 'Posted' ? (b.posting_date || '') : (b.creation_date || '');
                    if (filter_date_from && date_val && date_val < filter_date_from) return false;
                    if (filter_date_to && date_val && date_val > filter_date_to) return false;
                }
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
                    + '<td style="padding:8px 12px;color:' + status_color + ';font-weight:bold;">' + status_label + '</td>'
                    + '<td style="padding:8px 12px;color:#888;font-size:11px;">' + frappe.utils.escape_html(b.description || '') + '</td>'
                    + '</tr>';
            });

            var table_html = '<p style="font-size:12px;color:#7f8c8d;margin-bottom:12px;"><i class="fa fa-hand-pointer-o"></i> ' + __('انقر فوق المحفظة المطلوبة:') + '</p>'
                + '<table class="table table-bordered table-hover" id="batch-select-table" style="font-size:12px;width:100%;direction:rtl;text-align:right;">'
                + '<thead><tr style="background:#f8f9fa;"><th style="padding:8px 12px;">' + __('العنوان') + '</th><th style="padding:8px 12px;">' + __('التاريخ') + '</th><th style="padding:8px 12px;">' + __('الحالة') + '</th><th style="padding:8px 12px;">' + __('الوصف') + '</th> </thead>'
                + '<tbody>' + (rows_html || '<tr><td colspan="4" style="text-align:center;color:#999;padding:20px;">' + __('لا توجد نتائج تطابق الفلترة.') + '</td></tr>') + '</tbody>'
                + '<table>';

            dialog.fields_dict.table_html.$wrapper.html(table_html);
        }

        var dialog = new frappe.ui.Dialog({
            title: title,
            fields: [
                { fieldtype: 'Data', fieldname: 'filter_description', label: __('الوصف'), default: '', onchange: function () { render_table(); } },
                { fieldtype: 'Select', fieldname: 'filter_status', label: __('الحالة'), options: [__('الكل'), __('مسودة'), __('مرحل')].join('\n'), default: __('الكل'), onchange: function () { render_table(); } },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Date', fieldname: 'filter_date_from', label: __('من تاريخ'), default: '', onchange: function () { render_table(); } },
                { fieldtype: 'Date', fieldname: 'filter_date_to', label: __('إلى تاريخ'), default: '', onchange: function () { render_table(); } },
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

    // --- ترحيل المحفظة البريدية ---
    action_post_batch: function () {
        if (DME.State.is_readonly_mode) {
            frappe.show_alert({ message: __('لا يمكن الترحيل في وضع الاستعراض.'), indicator: 'red' });
            return;
        }

        var items = this.collect_current_grid_items();
        if (items.length === 0) {
            frappe.show_alert({ message: __('لا توجد سجلات للترحيل.'), indicator: 'orange' });
            return;
        }

        frappe.confirm(__('هل أنت متأكد من ترحيل المحفظة البريدية؟ سيتم إضافة {0} سجل بريد إلى ملفات المنازعات.', [items.length]), function () {
            if (DME.State.active_batch_name) {
                DME.Batch._do_post_batch(DME.State.active_batch_name, DME.State.active_batch_title,
                    DME.State.active_batch_description, items);
            } else {
                DME.Batch._show_batch_title_dialog(DME.State.active_batch_title, DME.State.active_batch_description,
                    function (title, desc) {
                        DME.Batch._do_post_batch(null, title, desc, items);
                    });
            }
        });
    },

    // --- التنفيذ الفعلي للترحيل ---
    _do_post_batch: function (batch_name, title, desc, items) {
        frappe.call({
            method: 'judicial_files.judicial_files.page.dispute_mail_editor.dispute_mail_editor.post_batch_archive',
            args: {
                batch_name: batch_name || '',
                items: JSON.stringify(items),
                title: title || '',
                description: desc || '',
            },
            freeze: true, freeze_message: __('جاري ترحيل المحفظة البريدية...'),
            callback: function (r) {
                if (r.message && r.message.success) {
                    DME.State.active_batch_name = r.message.batch_name;
                    DME.State.active_batch_title = r.message.title;
                    DME.State.active_batch_description = desc || '';
                    DME.State.is_readonly_mode = true;
                    // تفعيل وضع الاستعراض الكامل عبر إعادة الرسم من المتجر
                    // CSS (.table-readonly) يستخدم pointer-events: none لمنع التعديل دون تغيير التنسيق
                    DME.UI.renderGrid();
                    $('#mail-btn-post').prop('disabled', true).css('opacity', '0.5');
                    $('#action-save-draft').hide();
                    if (DME.Batch.has_reply_data()) {
                        $('#li-add-reply').hide();
                    } else {
                        $('#li-add-reply').show();
                    }
                    DME.Batch.update_batch_indicator(r.message.title, true);
                    frappe.show_alert({ message: __('تم ترحيل المحفظة البريدية بنجاح: {0}', [r.message.title]), indicator: 'green' });
                } else {
                    frappe.show_alert({ message: __('فشل الترحيل: ') + ((r.message && r.message.message) || ''), indicator: 'red' });
                }
            }
        });
    },
};

// =============================================================================
// DME.Print — الطباعة (مطابق لـ EBE.Print في v2)
// =============================================================================

DME.Print = {
    action_print: function () {
        var rows = $('#mail-results-body tr').not('#empty-row');
        if (rows.length === 0) {
            frappe.show_alert({ message: __('لا توجد بيانات للطباعة.'), indicator: 'orange' });
            return;
        }

        var dialog = new frappe.ui.Dialog({
            title: __('خيارات الطباعة'),
            fields: [
                { fieldtype: 'Link', fieldname: 'judge_name', label: __('اسم القاضي'), options: 'Judicial Employee', get_query: function () { return { filters: { chief_justice: 1 } }; }, reqd: 1 },
                { fieldtype: 'Link', fieldname: 'mail_status_filter', label: __('حالة البريد'), options: 'Judicial Mail Status' },
                { fieldtype: 'Link', fieldname: 'file_status_filter', label: __('حالة الملف'), options: 'Judicial File Status' },
                { fieldtype: 'Section Break', label: __('صورة الترويسة') },
                { fieldtype: 'Attach Image', fieldname: 'print_logo', label: __('صورة الترويسة (عرض كامل)'), default: '/files/a_archive.png' }
            ],
            primary_action_label: __('طباعة'),
            primary_action: function (values) {
                if (!values.judge_name || !values.judge_name.trim()) {
                    frappe.show_alert({ message: __('يجب إدخال اسم القاضي.'), indicator: 'red' });
                    return;
                }
                dialog.hide();
                DME.Print._do_print({
                    judge_name: values.judge_name.trim(),
                    mail_status_filter: values.mail_status_filter || null,
                    file_status_filter: values.file_status_filter || null,
                    print_logo: values.print_logo || '/files/a_archive.png'
                });
            }
        });
        dialog.show();
        dialog.set_values({
            judge_name: DME.State.active_judge_name || '',
            print_logo: '/files/a_archive.png'
        });
    },

    _do_print: function (opts) {
        // القراءة مباشرة من مدير البيانات — لا DOM Scraping
        var rows_data = [];
        var row_num = 1;
        var source_data = opts.data || DME.Store.get_all();
        source_data.forEach(function (r) {
            var mail_status = r.mail_status || '';
            if (opts.mail_status_filter && mail_status !== opts.mail_status_filter) return;
            if (opts.file_status_filter && r.status !== opts.file_status_filter) return;

            var row_color_class = r.is_missing ? 'row-missing' : (r.status === 'مرحل' ? 'row-archived' : '');
            var is_upload = (r.upload_mail == 1 || r.upload_mail === '1' || r.upload_mail === true);
            var is_returned = (r.mail_returned == 1 || r.mail_returned === '1' || r.mail_returned === true);

            rows_data.push({
                num: row_num++,
                reference: r.reference || '',
                file_number: r.file_number || '',
                year: r.year || '',
                petitioner: r.petitioner || '',
                respondent: r.respondent || '',
                judge: r.judge || '',
                assistant: r.secretary || '',
                cur_asst: r.current_secretary || '',
                execution_file_no: r.execution_file_no || '',
                status: r.status || '',
                mail_status: mail_status,
                upload_mail: is_upload ? '✓' : '',
                upload_mail_date: r.upload_mail_date || '',
                mail_returned: is_returned ? '✓' : '',
                mail_returned_date: r.mail_returned_date || '',
                mail_notes: r.mail_notes || '',
                row_color_class: row_color_class
            });
        });

        if (rows_data.length === 0) {
            frappe.show_alert({ message: __('لا توجد بيانات مطابقة لحالة البريد المختارة.'), indicator: 'orange' });
            return;
        }

        var tbody_html = '';
        rows_data.forEach(function (r) {
            var row_class = r.row_color_class ? ' class="' + r.row_color_class + '"' : '';
            tbody_html += '<tr' + row_class + '>'
                + '<td>' + r.num + '</td><td>' + frappe.utils.escape_html(r.reference) + '</td>'
                + '<td>' + frappe.utils.escape_html(r.file_number) + '</td><td>' + frappe.utils.escape_html(r.year) + '</td>'
                + '<td>' + frappe.utils.escape_html(r.petitioner) + '</td><td>' + frappe.utils.escape_html(r.respondent) + '</td>'
                + '<td class="print-hide-col">' + frappe.utils.escape_html(r.judge) + '</td>'
                + '<td>' + frappe.utils.escape_html(r.assistant) + '</td>'
                + '<td>' + frappe.utils.escape_html(r.cur_asst) + '</td>'
                + '<td>' + frappe.utils.escape_html(r.execution_file_no) + '</td><td>' + frappe.utils.escape_html(r.status) + '</td>'
                + '<td>' + frappe.utils.escape_html(r.mail_status) + '</td><td>' + r.upload_mail + '</td>'
                + '<td>' + frappe.utils.escape_html(r.upload_mail_date) + '</td><td>' + r.mail_returned + '</td>'
                + '<td>' + frappe.utils.escape_html(r.mail_returned_date) + '</td>'
                + '<td style="min-width:80px;">' + frappe.utils.escape_html(r.mail_notes) + '</td>'
                + '</tr>';
        });

        var report_title = __('سجلات البريد لملفات المنازعات');
        if (opts.mail_status_filter) report_title += ' (' + opts.mail_status_filter + ')';
        if (opts.file_status_filter) report_title += ' (' + opts.file_status_filter + ')';
        report_title += ' - ' + __('القاضي') + ' / ' + opts.judge_name;

        var print_date = new Date().toLocaleDateString('ar-YE');

        var img_src = opts.print_logo || '/files/a_archive.png';
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
            + '@media print{-webkit-print-color-adjust:exact;print-color-adjust:exact}'
            + 'thead th{-webkit-print-color-adjust:exact;print-color-adjust:exact}'
            + '@page{size:A4 landscape;margin:3mm 8mm 12mm;@bottom-center{content:"\\635\\641\\62D\\629 " counter(page) " \\645\\646 " counter(pages);font-size:8pt;font-family:"Traditional Arabic","Arial",sans-serif}}';

        var headerColspan = 17;
        var theadContent = '<thead>'
            + '<tr class="print-header-row"><td colspan="' + headerColspan + '" style="text-align:center; padding:0; margin:0; border:none;"><img src="' + src + '" alt="الترويسة" style="width:100%; height:auto; max-height:80px; display:block;"></td></tr>'
            + '<tr class="print-title-row"><td colspan="' + headerColspan + '" style="text-align:center; font-size:15pt; font-weight:bold; padding:8px 0 4px; border:none;">' + report_title + '<tr></tr>'
            + '<tr>'
            + '<th>#</th><th>' + __('المرجع') + '</th><th>' + __('رقم الملف') + '</th><th>' + __('السنة') + '</th>'
            + '<th>' + __('المدعي') + '</th><th>' + __('المدعى عليه') + '</th><th class="print-hide-col">' + __('القاضي') + '</th>'
            + '<th>' + __('أمين السر') + '</th><th>' + __('أمين السر الحالي') + '</th>'
            + '<th>' + __('رقم ملف التنفيذ') + '</th><th>' + __('حالة الملف') + '</th><th>' + __('حالة البريد') + '</th><th>' + __('رفع البريد') + '</th>'
            + '<th>' + __('تاريخ رفع البريد') + '</th><th>' + __('رد البريد') + '</th>'
            + '<th>' + __('تاريخ رد البريد') + '</th><th>' + __('الملاحظات') + '</th>'
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
            + '<div class="print-footer">'
            + '<span>' + __('إجمالي السجلات') + ': <strong>' + rows_data.length + '</strong></span>'
            + '<span>' + __('تاريخ الطباعة') + ': <strong>' + print_date + '</strong></span></div>'
            + '<script>window.onload = function () { setTimeout(function () { window.print(); }, 900); };<\/script>'
            + '</body></html>';

        var pw = window.open('', '_blank', 'width=1100,height=720,scrollbars=yes');
        if (!pw) {
            frappe.show_alert({ message: __('تعذر فتح نافذة الطباعة! يرجى السماح للنوافذ المنبثقة.'), indicator: 'red' });
            return;
        }
        pw.document.write(print_html);
        pw.document.close();
    },

    action_print_all: function () {
        var dialog = new frappe.ui.Dialog({
            title: __('طباعة الكل'),
            fields: [
                { fieldtype: 'Link', fieldname: 'judge_name', label: __('اسم القاضي'), options: 'Judicial Employee', get_query: function () { return { filters: { chief_justice: 1 } }; }, reqd: 1 },
                { fieldtype: 'Link', fieldname: 'file_status', label: __('حالة الملف'), options: 'Judicial File Status' },
                { fieldtype: 'Link', fieldname: 'mail_status', label: __('حالة البريد'), options: 'Judicial Mail Status' },
                { fieldtype: 'Section Break', label: __('صورة الترويسة') },
                { fieldtype: 'Attach Image', fieldname: 'print_logo', label: __('صورة الترويسة (عرض كامل)'), default: '/files/a_archive.png' }
            ],
            primary_action_label: __('طباعة'),
            primary_action: function (values) {
                if (!values.judge_name || !values.judge_name.trim()) {
                    frappe.show_alert({ message: __('يجب إدخال اسم القاضي.'), indicator: 'red' });
                    return;
                }
                dialog.hide();
                frappe.call({
                    method: 'judicial_files.judicial_files.page.dispute_mail_editor.dispute_mail_editor.get_files_with_any_mail_status',
                    args: {
                        file_status: values.file_status || null,
                        mail_status: values.mail_status || null
                    },
                    callback: function (r) {
                        var data = r.message || [];
                        if (data.length === 0) {
                            frappe.show_alert({ message: __('لا توجد ملفات للطباعة حسب الفلتر المحدد.'), indicator: 'orange' });
                            return;
                        }
                        DME.Print._do_print({
                            judge_name: values.judge_name.trim(),
                            mail_status_filter: __('الكل'),
                            print_logo: values.print_logo || '/files/a_archive.png',
                            data: data
                        });
                    }
                });
            }
        });
        dialog.show();
        dialog.set_values({
            judge_name: DME.State.active_judge_name || '',
            print_logo: '/files/a_archive.png'
        });
    },
};

// =============================================================================
// DME.Events — ربط الأحداث
// =============================================================================

DME.Events = {
    setup: function (page) {
        // التركيز التلقائي
        setTimeout(function () { $('#mail-reference-input').focus(); }, 600);

        // زر ترحيل المحفظة
        $('#mail-btn-post').on('click', function () { DME.Batch.action_post_batch(); });

        // حفظ المحفظة
        $(document).on('click', '#action-save-draft', function (e) { e.preventDefault(); DME.Batch.action_save_draft(); });

        // إضافة رد (لمحفظة مرحل)
        $(document).on('click', '#action-add-reply', function (e) {
            e.preventDefault();
            DME.State.is_reply_mode = true;
            $('#li-add-reply').hide();
            $('#li-fetch-mail-completed').hide();
            $('#action-save-draft').show();
            $('#mail-btn-post').hide();
            $('#mail-reference-input').prop('disabled', true);

            // تعيين تلقائي للصفوف التي لديها رفع بريد عند بدء وضع الرد
            var today = new Date().toISOString().split('T')[0];
            DME.State.records.forEach(function (row) {
                var has_upload = (row.upload_mail == 1 || row.upload_mail === '1' || row.upload_mail === true);
                if (!has_upload) return;

                row.mail_returned = 1;
                row.dirty_fields = row.dirty_fields || {};
                row.dirty_fields['mail_returned'] = true;

                row.mail_returned_date = today;
                row.dirty_fields['mail_returned_date'] = true;

                row.mail_status = 'تم التأشير على الملف';
                row.dirty_fields['mail_status'] = true;
                row.is_dirty = true;
            });

            DME.UI.renderGrid();
            frappe.show_alert({ message: __('تم تعيين رد البريد تلقائياً لجميع الملفات. يمكنك تعديل أي قيمة يدوياً.'), indicator: 'green' });
        });

        // جلب من الأرشيف
        $(document).on('click', '#action-fetch-from-archive', function (e) { e.preventDefault(); DME.Batch.action_fetch_from_archive(); });

        // جلب الملفات المستكمِل إطلاعها
        $(document).on('click', '#action-fetch-mail-completed', function (e) {
            e.preventDefault();
            frappe.call({
                method: 'judicial_files.judicial_files.page.dispute_mail_editor.dispute_mail_editor.get_files_with_mail_status',
                args: {
                    file_status: 'منظور',
                    target_mail_status: 'استكمال الاطلاع'
                },
                callback: function (r) {
                    if (r.message && r.message.length > 0) {
                        r.message.forEach(function (item) {
                            var exists = DME.State.records.some(function (r) { return r.reference === item.reference; });
                            if (!exists) {
                                DME.Logic.apply_new_row_rules(item);
                                DME.Store.add_row(item);
                            }
                        });
                        DME.UI.renderGrid();
                        frappe.show_alert({
                            message: __('تم جلب {0} ملف/ملفات مستكمِل الإطلاع', [r.message.length]),
                            indicator: 'green'
                        });
                    } else {
                        frappe.show_alert({
                            message: __('لا توجد ملفات مستكمِل الإطلاع حالياً'),
                            indicator: 'orange'
                        });
                    }
                }
            });
        });

        // طباعة
        $(document).on('click', '#action-print', function (e) { e.preventDefault(); DME.Print.action_print(); });
        $(document).on('click', '#action-print-all', function (e) { e.preventDefault(); DME.Print.action_print_all(); });

        // حذف محفظة بريد غير مرحل
        $(document).on('click', '#btn-delete-archive', function (e) {
            e.preventDefault();
            if (!DME.State.active_batch_name) return;
            frappe.confirm(
                __('هل أنت متأكد من حذف المحفظة البريدية "{0}"؟', [DME.State.active_batch_name]),
                function () {
                    frappe.call({
                        method: 'judicial_files.judicial_files.page.dispute_mail_editor.dispute_mail_editor.delete_draft_batch',
                        args: { batch_name: DME.State.active_batch_name },
                        callback: function (r) {
                            if (r.message && r.message.success) {
                                frappe.show_alert({ message: __('تم حذف المحفظة البريدية بنجاح'), indicator: 'green' });
                                DME.Grid.clear_grid();
                            } else {
                                frappe.show_alert({ message: r.message.message || __('فشل حذف المحفظة البريدية'), indicator: 'red' });
                            }
                        }
                    });
                }
            );
        });

        // تعديل الترويسة
        $('#action-edit-batch').on('click', function (e) {
            e.preventDefault();
            if (!DME.State.active_batch_name) {
                frappe.show_alert({ message: __('يجب حفظ المحفظة كمسودة أولاً.'), indicator: 'orange' });
                return;
            }
            if (DME.State.is_readonly_mode) {
                frappe.show_alert({ message: __('لا يمكن تعديل محفظة مرحلة.'), indicator: 'red' });
                return;
            }
            DME.Batch._show_batch_title_dialog(
                DME.State.active_batch_title, DME.State.active_batch_description,
                function (title, desc) {
                    var items = DME.Batch.collect_current_grid_items();
                    DME.Batch._do_save_draft(DME.State.active_batch_name, title, desc, items);
                }
            );
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

            // إذا كانت القيمة مطابقة لصيغة التاريخ النظامية (YYYY-MM-DD) فلا داعي للتحويل
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
                    var pad = function(n) { return n < 10 ? '0' + n : n; };
                    var sys_date = year + '-' + pad(month) + '-' + pad(day);
                    
                    // تحويل إلى صيغة المستخدم للظهور
                    var user_date = frappe.datetime.str_to_user(sys_date);
                    
                    // تعيين القيمة الأصلية لتستخدم في change
                    input.data('sys-date', sys_date);
                    input.val(user_date);
                    input.trigger('change');
                    return;
                }
            }
            
            if (!valid) {
                input.val(''); // مسح التاريخ الخاطئ
                input.data('sys-date', '');
                input.trigger('change');
            }
        });

        // تتبع التعديلات الموحد (Unified Event Listener)
        $(document).on('change', '.cell-input, .ref-edit-input', function () {
            if (DME.State.is_readonly_mode && !DME.State.is_reply_mode) return;
            var input = $(this);
            var tr = input.closest('tr');
            var id = tr.data('id');
            if (!id) return;

            // إذا كان التعديل في حقل المرجع
            if (input.hasClass('ref-edit-input')) {
                DME.Store.update_row_field(id, 'reference', input.val());
                return;
            }

            var fieldname = input.data('fieldname');
            var is_checkbox = input.is(':checkbox');
            
            var val;
            if (is_checkbox) {
                val = input.prop('checked') ? 1 : 0;
            } else if (input.hasClass('date-input')) {
                var sys_date = input.data('sys-date');
                if (sys_date) {
                    val = sys_date;
                } else if (input.val()) {
                    val = frappe.datetime.user_to_str(input.val());
                } else {
                    val = '';
                }
            } else {
                val = input.val();
            }

            var row = DME.Store.update_row_field(id, fieldname, val);
            if (row) {
                // تعيين تلقائي لتاريخ رد البريد وحالته عند التحديد
                if (fieldname === 'mail_returned') {
                    var is_checked = (val == 1 || val === '1' || val === true);
                    if (is_checked) {
                        if (!row.mail_returned_date) {
                            row.mail_returned_date = new Date().toISOString().split('T')[0];
                            row.dirty_fields = row.dirty_fields || {};
                            row.dirty_fields['mail_returned_date'] = true;
                        }

                    }
                }

                // تطبيق القواعد المترابطة (Dependencies)
                row = DME.Logic.resolve_dependencies(row, fieldname);
                DME.Grid.mark_batch_as_dirty();

                if (fieldname === 'upload_mail_date' || fieldname === 'mail_returned_date') {
                    var tr = $('#' + id);
                    var cell = tr.find('[data-fieldname="' + fieldname + '"]');
                    if (cell.length) {
                        var userVal = val ? frappe.datetime.str_to_user(val) : '';
                        cell.val(userVal);
                        cell.data('sys-date', val || '');
                    }
                } else {
                    DME.UI.renderGrid();
                }
            }
        });

        // تغيير حجم الصفحة
        $('#pagination-page-size').on('change', function () {
            var val = $(this).val();
            DME.State.records_per_page = (val === 'all') ? Infinity : (parseInt(val) || 25);
            DME.State.current_page = 1;
            DME.UI.reindex_rows();
        });

        // أزرار التصفح
        $('#pagination-btn-prev').on('click', function () {
            if (DME.State.current_page > 1) { DME.State.current_page--; DME.UI.apply_pagination(); }
        });
        $('#pagination-btn-next').on('click', function () {
            var total_records = $('#mail-results-body tr').not('#empty-row').length;
            var total_pages = Math.ceil(total_records / DME.State.records_per_page);
            if (DME.State.current_page < total_pages) { DME.State.current_page++; DME.UI.apply_pagination(); }
        });

        // فرز الأعمدة
        $(document).on('click', '.sortable-header', function () {
            var tbody = $('#mail-results-body');
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
                var valA = DME.Events._get_cell_sorting_value($(a).find('td:nth-child(' + col_idx + ')'));
                var valB = DME.Events._get_cell_sorting_value($(b).find('td:nth-child(' + col_idx + ')'));
                var isNum = /^\d+(\.\d+)?$/;
                if (isNum.test(valA) && isNum.test(valB)) {
                    return is_asc ? parseFloat(valA) - parseFloat(valB) : parseFloat(valB) - parseFloat(valA);
                }
                return is_asc ? valA.localeCompare(valB, 'ar', { numeric: true, sensitivity: 'base' })
                    : valB.localeCompare(valA, 'ar', { numeric: true, sensitivity: 'base' });
            });

            $.each(rows, function (i, row) { tbody.append(row); });
            DME.State.current_page = 1;
            DME.UI.reindex_rows();
        });

        // Enter للبحث
        $('#mail-reference-input').on('keypress', function (e) {
            if (e.which === 13) { e.preventDefault(); DME.Grid.perform_search(); }
        });

        // Enter لتصحيح المرجع
        $(document).on('keydown', '.ref-edit-input', function (e) {
            if (DME.State.is_readonly_mode) return;
            if (e.which === 13) { e.preventDefault(); DME.Grid.research_row_reference($(this).closest('tr')); }
        });

        // Enter للبحث في الصفوف المفقودة
        $(document).on('keydown', '.row-missing .cell-input[data-fieldname="file_number"], .row-missing .cell-input[data-fieldname="year"], .row-missing .cell-input[data-fieldname="petitioner"], .row-missing .cell-input[data-fieldname="respondent"]', function (e) {
            if (DME.State.is_readonly_mode) return;
            if (e.which === 13) { e.preventDefault(); DME.Grid.trigger_row_search_lookup($(this).closest('tr')); }
        });

        // حذف صفوف البريد
        $(document).on('click', '.btn-mail-delete-row', function () {
            if (DME.State.is_readonly_mode) return;
            var tr = $(this).closest('tr');
            var checked = $('#mail-results-body .row-selector-checkbox:checked');
            var is_checked = tr.find('.row-selector-checkbox').prop('checked');

            if (checked.length > 0 && is_checked) {
                frappe.confirm(__('هل أنت متأكد من حذف الصفوف المحددة ({0})؟', [checked.length]), function () {
                    checked.each(function () { DME.Grid.delete_row_logic($(this).closest('tr')); });
                    DME.UI.reindex_rows();
                    DME.UI.update_counter();
                    $('#select-all-rows').prop('checked', false);
                    DME.UI.check_empty_table();
                });
            } else {
                DME.Grid.delete_row_logic(tr);
                DME.UI.reindex_rows();
                DME.UI.update_counter();
                DME.UI.update_select_all_state();
                DME.UI.check_empty_table();
            }
        });

        // التنقل بالأسهم
        $(document).on('keydown', '.cell-input:not([tabindex="-1"])', function (e) {
            var input = $(this);
            var row = parseInt(input.data('row'));
            var col = parseInt(input.data('col'));
            var target = null;
            switch (e.which) {
                case 38: target = $('.cell-input[data-row="' + (row - 1) + '"][data-col="' + col + '"]:not([tabindex="-1"])'); break;
                case 40: target = $('.cell-input[data-row="' + (row + 1) + '"][data-col="' + col + '"]:not([tabindex="-1"])'); break;
                case 37: target = $('.cell-input[data-row="' + row + '"][data-col="' + (col + 1) + '"]:not([tabindex="-1"])'); break;
                case 39: target = $('.cell-input[data-row="' + row + '"][data-col="' + (col - 1) + '"]:not([tabindex="-1"])'); break;
                default: return;
            }
            if (target && target.length) { e.preventDefault(); target.focus().select(); }
        });

        // تحديد الكل
        $(document).off('change', '#select-all-rows').on('change', '#select-all-rows', function () {
            $('#mail-results-body tr:visible .row-selector-checkbox').prop('checked', $(this).prop('checked'));
        });

        // تحديث تحديد الكل
        $(document).off('change', '.row-selector-checkbox').on('change', '.row-selector-checkbox', function () {
            DME.UI.update_select_all_state();
        });
    },

    _get_cell_sorting_value: function (td) {
        var input = td.find('.cell-input, .ref-edit-input');
        if (input.is(':checkbox')) {
            return input.prop('checked') ? '1' : '0';
        }
        return input.length ? input.val().trim() : td.text().trim();
    },
};

// =============================================================================
// DME.CSS + DME.UI_TEMPLATE — الأنماط والقوالب
// =============================================================================

DME.CSS = ''
    // ===== شريط التمرير =====
    + '.table-responsive::-webkit-scrollbar{height:8px}'
    + '.table-responsive::-webkit-scrollbar-track{background:rgba(0,0,0,0.02);border-radius:4px}'
    + '.table-responsive::-webkit-scrollbar-thumb{background:rgba(41,128,185,0.2);border-radius:4px}'
    + '.table-responsive::-webkit-scrollbar-thumb:hover{background:rgba(41,128,185,0.4)}'

    // ===== الحاوية الرئيسية =====
    + '.mail-container{display:flex;flex-direction:column;min-height:calc(100vh - 110px);overflow-y:auto;gap:12px;font-family:"Outfit","Inter","Segoe UI",sans-serif;padding:0;background:#fff}'

    // ===== شريط العمليات والعدادات =====
    + '.header-actions-row{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding:4px 6px;margin-bottom:2px;direction:rtl;width:100%}'
    + '.counter-badges-container{display:flex;gap:6px;align-items:center;flex-wrap:wrap;direction:rtl}'
    + '.badge-counter{font-size:11px;padding:4px 10px;border-radius:15px;color:#fff;font-weight:bold;box-shadow:0 1px 3px rgba(0,0,0,0.05)}'
    + '.badge-counter.badge-total{background-color:#2980b9}'
    + '.badge-counter.badge-active{background-color:#7f8c8d}'
    + '.badge-counter.badge-found{background-color:#27ae60}'
    + '.badge-counter.badge-archived{background-color:#f59e0b}'
    + '.badge-counter.badge-missing{background-color:#ef4444}'
    + '.actions-container{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex-shrink:0}'
    + '.header-center{display:flex;align-items:center;justify-content:center;flex:1}'

    // ===== اللوحة العلوية =====
    + '.sticky-top-panel{position:relative!important;z-index:15!important;flex:0 0 auto;background:#fff!important;border-bottom:2px solid #2980b9!important;box-shadow:0 4px 15px rgba(0,0,0,0.04)!important;transition:all .2s ease}'
    + '.sticky-row-container{display:flex;flex-direction:row;justify-content:space-between;align-items:flex-end;gap:20px;direction:rtl;text-align:right;width:100%;flex-wrap:wrap}'

    // ===== البطاقة =====
    + '.card.glass-card{border:1px solid rgba(0,0,0,0.08);border-radius:8px;padding:14px 16px;margin-bottom:10px;background:rgba(255,255,255,0.9);box-shadow:0 4px 15px rgba(0,0,0,0.04)}'
    + '.mail-container .card.glass-card:last-child{flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden;margin-bottom:0!important;position:relative!important;z-index:1!important}'

    // ===== حقول الإدخال =====
    + '.field-group{flex:1;min-width:280px;margin-bottom:5px;display:flex;flex-direction:column}'
    + '.field-group label{font-weight:700!important;color:#000!important;display:block;margin-bottom:8px;font-size:12px!important;line-height:1.2;text-align:right}'
    + '.input-row{display:flex;align-items:center;width:100%;direction:rtl}'
    + '.input-row .form-control{border:1px solid rgba(0,0,0,0.15)!important;border-radius:0 6px 6px 0!important;height:32px!important;font-size:12px!important;padding:4px 12px!important;width:100%!important;min-width:0!important;flex:1!important;text-align:right;direction:ltr}'
    + '.btn-save-draft{background-color:#2980b9!important;border:none!important;border-radius:6px 0 0 6px!important;height:32px!important;padding:0 15px!important;font-weight:600!important;font-size:12px!important;color:#fff!important;display:flex;align-items:center;justify-content:center;cursor:pointer;white-space:nowrap;margin-right:-1px;transition:background .2s}'
    + '.btn-save-draft:hover{background-color:#2471a3!important}'
    + '.btn-post-batch{background-color:#27ae60!important;border:none!important;border-radius:6px 0 0 6px!important;height:32px!important;padding:0 15px!important;font-weight:600!important;font-size:12px!important;color:#fff!important;display:none;align-items:center;justify-content:center;cursor:pointer;white-space:nowrap;margin-right:-1px;transition:background .2s}'
    + '.btn-post-batch:hover{background-color:#219a52!important}'


    // ===== الأعمدة الثابتة =====
    + '.sticky-col-left{position:sticky!important;left:0!important;z-index:4!important;background:#fff!important;box-shadow:2px 0 5px rgba(0,0,0,0.04);border-right:2px solid rgba(0,0,0,0.08)!important}'
    + '.sticky-col-right-1{position:sticky!important;right:0!important;z-index:4!important;background:#fff!important;box-shadow:-2px 0 5px rgba(0,0,0,0.03)}'
    + '.sticky-col-right-2{position:sticky!important;right:' + COL_WIDTHS.checkbox + 'px!important;z-index:4!important;background:#fff!important;box-shadow:-2px 0 5px rgba(0,0,0,0.03)}'
    + '.sticky-col-right-3{position:sticky!important;right:' + (COL_WIDTHS.checkbox + COL_WIDTHS.index) + 'px!important;z-index:4!important;background:#fff!important;box-shadow:-3px 0 5px rgba(0,0,0,0.04);border-left:2px solid rgba(0,0,0,0.08)!important}'
    + '#editor-table thead th.sticky-col-left{position:sticky!important;top:0!important;left:0!important;z-index:105!important;background:#f8f9fa!important;box-shadow:2px 0 5px rgba(0,0,0,0.04),inset 0 -1.5px 0 rgba(0,0,0,0.12)!important;will-change:transform}'
    + '#editor-table thead th.sticky-col-right-1{position:sticky!important;top:0!important;right:0!important;z-index:105!important;background:#f8f9fa!important;box-shadow:-2px 0 5px rgba(0,0,0,0.03),inset 0 -1.5px 0 rgba(0,0,0,0.12)!important;will-change:transform}'
    + '#editor-table thead th.sticky-col-right-2{position:sticky!important;top:0!important;right:' + COL_WIDTHS.checkbox + 'px!important;z-index:105!important;background:#f8f9fa!important;box-shadow:-2px 0 5px rgba(0,0,0,0.03),inset 0 -1.5px 0 rgba(0,0,0,0.12)!important;will-change:transform}'
    + '#editor-table thead th.sticky-col-right-3{position:sticky!important;top:0!important;right:' + (COL_WIDTHS.checkbox + COL_WIDTHS.index) + 'px!important;z-index:105!important;background:#f8f9fa!important;box-shadow:-3px 0 5px rgba(0,0,0,0.04),inset 0 -1.5px 0 rgba(0,0,0,0.12)!important;border-left:2px solid rgba(0,0,0,0.08)!important;will-change:transform}'

    // ===== تلوين الصفوف =====
    + '.row-archived{background-color:#fff3e0!important}.row-archived td{background-color:#fff3e0!important}'
    + '.row-archived .sticky-col-right-1,.row-archived .sticky-col-right-2,.row-archived .sticky-col-right-3,.row-archived .sticky-col-left{background-color:#fff3e0!important}'
    + '.row-missing{background-color:#ffebee!important}.row-missing td{background-color:#ffebee!important}'
    + '.row-missing .sticky-col-right-1,.row-missing .sticky-col-right-2,.row-missing .sticky-col-right-3,.row-missing .sticky-col-left{background-color:#ffebee!important}'

    // ===== الجدول =====
    + '.table-responsive{overflow-x:auto;overflow-y:auto;width:100%;-webkit-overflow-scrolling:touch;flex:1;min-height:0}'
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

    // ===== عرض أعمدة البيانات =====
    + '#editor-table thead th:nth-child(4){width:' + COL_WIDTHS.file_number + 'px;min-width:' + COL_WIDTHS.file_number + 'px}'
    + '#editor-table thead th:nth-child(5){width:' + COL_WIDTHS.year + 'px;min-width:' + COL_WIDTHS.year + 'px}'
    + '#editor-table thead th:nth-child(6){width:' + COL_WIDTHS.petitioner + 'px;min-width:' + COL_WIDTHS.petitioner + 'px}'
    + '#editor-table thead th:nth-child(7){width:' + COL_WIDTHS.respondent + 'px;min-width:' + COL_WIDTHS.respondent + 'px}'
    + '#editor-table thead th:nth-child(8){width:' + COL_WIDTHS.judge + 'px;min-width:' + COL_WIDTHS.judge + 'px}'
    + '#editor-table thead th:nth-child(9){width:' + COL_WIDTHS.secretary + 'px;min-width:' + COL_WIDTHS.secretary + 'px}'
    + '#editor-table thead th:nth-child(10){width:' + COL_WIDTHS.current_secretary + 'px;min-width:' + COL_WIDTHS.current_secretary + 'px}'
    + '#editor-table thead th:nth-child(11){width:' + COL_WIDTHS.execution_file_no + 'px;min-width:' + COL_WIDTHS.execution_file_no + 'px}'
    + '#editor-table thead th:nth-child(12){width:' + COL_WIDTHS.status + 'px;min-width:' + COL_WIDTHS.status + 'px}'
    + '#editor-table thead th:nth-child(13){width:' + COL_WIDTHS.mail_status + 'px;min-width:' + COL_WIDTHS.mail_status + 'px}'
    + '#editor-table thead th:nth-child(14){width:' + COL_WIDTHS.upload_mail + 'px;min-width:' + COL_WIDTHS.upload_mail + 'px}'
    + '#editor-table thead th:nth-child(15){width:' + COL_WIDTHS.upload_mail_date + 'px;min-width:' + COL_WIDTHS.upload_mail_date + 'px}'
    + '#editor-table thead th:nth-child(16){width:' + COL_WIDTHS.mail_returned + 'px;min-width:' + COL_WIDTHS.mail_returned + 'px}'
    + '#editor-table thead th:nth-child(17){width:' + COL_WIDTHS.mail_returned_date + 'px;min-width:' + COL_WIDTHS.mail_returned_date + 'px}'
    + '#editor-table thead th:nth-child(18){width:' + COL_WIDTHS.mail_notes + 'px;min-width:' + COL_WIDTHS.mail_notes + 'px}'
    + '#editor-table tbody td[data-col="1"]{width:' + COL_WIDTHS.file_number + 'px;min-width:' + COL_WIDTHS.file_number + 'px}'
    + '#editor-table tbody td[data-col="2"]{width:' + COL_WIDTHS.year + 'px;min-width:' + COL_WIDTHS.year + 'px}'
    + '#editor-table tbody td[data-col="3"]{width:' + COL_WIDTHS.petitioner + 'px;min-width:' + COL_WIDTHS.petitioner + 'px}'
    + '#editor-table tbody td[data-col="4"]{width:' + COL_WIDTHS.respondent + 'px;min-width:' + COL_WIDTHS.respondent + 'px}'
    + '#editor-table tbody td[data-col="5"]{width:' + COL_WIDTHS.judge + 'px;min-width:' + COL_WIDTHS.judge + 'px}'
    + '#editor-table tbody td[data-col="6"]{width:' + COL_WIDTHS.secretary + 'px;min-width:' + COL_WIDTHS.secretary + 'px}'
    + '#editor-table tbody td[data-col="7"]{width:' + COL_WIDTHS.current_secretary + 'px;min-width:' + COL_WIDTHS.current_secretary + 'px}'
    + '#editor-table tbody td[data-col="8"]{width:' + COL_WIDTHS.execution_file_no + 'px;min-width:' + COL_WIDTHS.execution_file_no + 'px}'
    + '#editor-table tbody td[data-col="9"]{width:' + COL_WIDTHS.status + 'px;min-width:' + COL_WIDTHS.status + 'px}'

    // ===== حقل المرجع =====
    + '.ref-text{color:#000;font-weight:bold;font-size:12px}'
    + '.text-orange-val{color:#e67e22!important;font-weight:bold!important;background-color:#fff7ed!important}'
    + '.ref-edit-wrap{display:flex;gap:5px;align-items:center;width:100%}'
    + '.ref-edit-input{width:100%;border:1px solid rgba(231,76,60,0.4);border-radius:4px;padding:4px 8px;font-size:12px;color:#e74c3c;font-weight:bold;background:#fff;outline:none;text-align:left}'
    + '.row-selector-checkbox{cursor:pointer;width:14px;height:14px;transform:scale(1.2)}'

    // ===== خلايا الإدخال =====
    + '.cell-input{width:100%;border:none;background:transparent;padding:3px 6px;font-size:11px;font-family:inherit;outline:none;border-radius:3px;text-align:right;transition:all .2s ease}.cell-input:focus{outline:none}'
    + '.row-archived .cell-input{background-color:#fff3e0!important;border-color:#e0c6a5}'
    + '.row-missing .cell-input{background-color:#ffebee!important;border-color:#e0b4b4}'
    + 'select.cell-input{min-width:100px}select.cell-input option{color:#000}input[type=date].cell-input{padding:2px 6px}'
    + '.cell-input:disabled{background-color:#f5f5f5!important;cursor:not-allowed;color:#000!important;opacity:1!important}'
    + '.mail-checkbox{width:18px;height:18px;cursor:pointer;transform:scale(1.3)}'
    + '.mail-status-select{min-width:100px}'

    // ===== شريط التصفح =====
    + '#table-pagination-bar{display:none;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-top:12px;padding-top:10px;border-top:1px solid rgba(0,0,0,0.06);direction:rtl;width:100%;font-size:11px;color:#6b7280}'
    + '#table-pagination-bar select{width:auto;display:inline-block;height:28px;font-size:11px;padding:2px 6px;border-radius:4px;border:1px solid rgba(0,0,0,0.15);cursor:pointer;background-color:#fff}'
    + '#pagination-info{font-size:11px;font-weight:bold;color:#718096;direction:rtl;white-space:nowrap}'
    + '#pagination-btn-prev,#pagination-btn-next{border:1px solid rgba(0,0,0,0.15)!important;background-color:#fff!important;border-radius:4px!important;padding:4px 10px!important;font-weight:bold!important;font-size:11px!important;color:#4a5568!important;cursor:pointer;display:flex;align-items:center;gap:4px;box-shadow:0 1px 2px rgba(0,0,0,0.04);height:28px}'

    // ===== أزرار القائمة =====
    + '#mail-btn-actions{border:1px solid rgba(0,0,0,0.15)!important;background-color:#fff!important;border-radius:6px!important;padding:4px 12px!important;font-weight:bold!important;font-size:11px!important;color:#4a5568!important;cursor:pointer;display:flex;align-items:center;gap:4px;box-shadow:0 1px 2px rgba(0,0,0,0.04);transition:all .2s}'
    + '#mail-btn-actions i.fa-cogs{color:#2980b9}'
    + '.dropdown-menu-right{border-radius:6px;box-shadow:0 4px 15px rgba(0,0,0,0.08);border:1px solid rgba(0,0,0,0.08);font-size:12px;min-width:180px;text-align:right;direction:rtl;margin-top:5px}'
    + '.dropdown-menu-right .dropdown-item{padding:8px 12px;display:flex;align-items:center;gap:8px;color:#2d3748;text-decoration:none}'

    // ===== رأس الجدول القابل للفرز =====
    + '.sortable-header{cursor:pointer;user-select:none;white-space:nowrap!important}'
    + '.sortable-header:hover{background-color:rgba(41,128,185,0.05)!important;color:#2980b9!important}'
    + '.sortable-header i.fa{transition:color .2s ease;font-size:10px;margin-right:4px;opacity:.4}'
    + '.sortable-header:hover i.fa{color:#2980b9!important}'
    + '.sortable-header.sorted-asc i.fa-sort-up,.sortable-header.sorted-desc i.fa-sort-down{opacity:1;color:#2563eb}'

    // ===== مدخل المرجع =====
    + '#mail-reference-input{border:1px solid rgba(0,0,0,0.15)!important;border-radius:0 6px 6px 0!important;height:32px!important;font-size:12px!important;padding:4px 12px!important;width:100%!important;min-width:0!important;flex:1!important;text-align:right;direction:ltr}'

    // ===== استجابة الشاشات =====
    + '@media(max-width:768px){.mail-container{height:auto;min-height:calc(100vh - 110px)}.field-group{min-width:100%}.badge-counter{font-size:9px;padding:3px 6px}.card.glass-card{padding:10px}.input-row{flex-wrap:wrap}.btn-save-draft,.btn-post-batch{font-size:10px;padding:0 8px}}'

    // ===== وضع الاستعراض (بعد الترحيل) — تعطيل جميع الحقول =====
    + '.table-readonly .cell-input{pointer-events:none!important;cursor:default!important}'
    + '.table-readonly .mail-checkbox{pointer-events:none!important;cursor:default!important}'
    + '.table-readonly select.cell-input{pointer-events:none!important;cursor:default!important}'
    + '.table-readonly .ref-edit-input{pointer-events:none!important;cursor:default!important;opacity:0.7!important}'
    + '.table-readonly .ref-text{pointer-events:none!important}'
    + '.table-readonly .row-selector-checkbox{pointer-events:none!important;cursor:default!important;opacity:0.5!important}'
    + '.table-readonly .btn-mail-delete-row{pointer-events:none!important;opacity:0.35!important;cursor:not-allowed!important}'

    // ===== وضع إضافة رد (حقول الرفع مقفولة، حقول الرد مفتوحة) =====
    + '.table-reply-mode .mail-field-upload .cell-input{pointer-events:none!important;cursor:default!important;opacity:0.5!important}'
    + '.table-reply-mode .mail-field-upload .mail-checkbox{pointer-events:none!important;cursor:default!important;opacity:0.5!important}'
    + '.table-reply-mode .mail-field-upload select{pointer-events:none!important;cursor:default!important;opacity:0.5!important}'

    // ===== وضع رفع البريد (حقول الرد مقفولة، حقول الرفع مفتوحة) =====
    + '.table:not(.table-reply-mode) .mail-field-reply .cell-input{pointer-events:none!important;cursor:default!important;opacity:0.5!important}'
    + '.table:not(.table-reply-mode) .mail-field-reply .mail-checkbox{pointer-events:none!important;cursor:default!important;opacity:0.5!important}'

    // ===== أنماط الطباعة =====
    + '@media print{body{padding:10px}.card.glass-card{border:none;padding:0;margin:0;background:none;box-shadow:none}.header-actions-row,.actions-container,.btn,.dropdown{display:none!important}.badge-counter{border:1px solid #ccc!important;font-size:8px;padding:2px 5px;background:none!important;color:#000!important}.sticky-col-left,.sticky-col-right-1,.sticky-col-right-2,.sticky-col-right-3,.sticky-top-panel{position:static!important;background:none!important;box-shadow:none!important}#table-pagination-bar{display:none!important}.table-responsive{overflow:visible;border:none}#editor-table{font-size:8px;min-width:auto}#editor-table thead th{background:#eee!important;border:1px solid #999!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}#editor-table tbody td{border:1px solid #bbb;padding:3px}#editor-table tbody tr.row-archived td{background-color:#fff3e0!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}#editor-table tbody tr.row-missing td{background-color:#ffebee!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.cell-input{border:none;background:transparent;height:auto;padding:0;min-width:auto}}';

DME.UI_TEMPLATE = function () {
    return '<style>' + DME.CSS + '</style><div class="mail-container">'
        + '<div class="header-actions-row">'
        + '<div class="counter-badges-container">'
        + '<span class="badge-counter badge-total" id="counter-total">' + __('الإجمالي') + ': 0</span>'
        + '<span class="badge-counter badge-active" id="counter-active">' + __('المنظور') + ': 0</span>'
        + '<span class="badge-counter badge-missing" id="counter-missing">' + __('الغير موجود') + ': 0</span>'
        + '<span class="badge-counter badge-archived" id="counter-archived">' + __('مرحل') + ': 0</span>'
        + '</div>'
        + '<div class="header-center"></div>'
        + '<div class="actions-container">'
        + '<div class="dropdown">'
        + '<button class="btn btn-default btn-xs dropdown-toggle" id="mail-btn-actions" data-toggle="dropdown">'
        + '<i class="fa fa-cogs"></i> ' + __('إجراءات المحفظة البريدية') + ' <i class="fa fa-caret-down"></i></button>'
        + '<ul class="dropdown-menu dropdown-menu-right">'
        + '<li><a class="dropdown-item" id="action-fetch-from-archive" href="#"><i class="fa fa-envelope text-info"></i> ' + __('جلب من المحفظة البريدية') + '</a></li>'
        + '<li id="separator-print" role="separator"></li>'
        + '<li id="li-print" style="display:none;"><a class="dropdown-item" id="action-print" href="#"><i class="fa fa-print text-info"></i> ' + __('طباعة') + '</a></li>'
        + '<li id="li-print-all"><a class="dropdown-item" id="action-print-all" href="#"><i class="fa fa-print text-info"></i> ' + __('طباعة الكل') + '</a></li>'
        + '<li id="separator-edit-batch" role="separator" style="display:none;"></li>'
        + '<li id="li-edit-batch" style="display:none;"><a class="dropdown-item" id="action-edit-batch" href="#"><i class="fa fa-pencil text-warning"></i> ' + __('تعديل بيانات المحفظة') + '</a></li>'
        + '<li id="li-add-reply" style="display:none;"><a class="dropdown-item" id="action-add-reply" href="#"><i class="fa fa-reply text-info"></i> ' + __('إضافة رد') + '</a></li>'
        + '<li role="separator"></li>'
        + '<li id="li-fetch-mail-completed"><a class="dropdown-item" id="action-fetch-mail-completed" href="#"><i class="fa fa-search text-success"></i> ' + __('جلب الملفات المستكمِل إطلاعها') + '</a></li>'
        + '</ul></div>'
        + '<button class="btn btn-default btn-xs" id="btn-delete-archive" style="display:none;margin-right:4px;" title="' + __('حذف محفظة بريد غير مرحل') + '"><i class="fa fa-trash text-danger"></i> ' + __('حذف المحفظة') + '</button></div></div>'

        + '<div class="card glass-card sticky-top-panel">'
        + '<div class="sticky-row-container">'
        + '<div class="field-group"><label>' + __('رقم مرجع ملف المنازعات (Reference)') + '</label>'
        + '<div class="input-row">'
        + '<input type="text" id="mail-reference-input" class="form-control" placeholder="' + __('أدخل رقم المرجع واضغط Enter للإضافة...') + '">'
        + '<button class="btn-save-draft" id="action-save-draft"><i class="fa fa-save"></i> ' + __('حفظ كمسودة') + '</button>'
        + '<button class="btn-post-batch" id="mail-btn-post"><i class="fa fa-paper-plane"></i> ' + __('ترحيل المحفظة البريدية') + '</button>'
        + '</div></div></div></div>'

        + '<div class="card glass-card">'
        + '<div class="table-responsive">'
        + '<table class="table table-bordered table-hover" id="editor-table">'
        + '<thead></tr>'
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
        + '<th class="sortable-header">' + __('رقم ملف التنفيذ') + ' <i class="fa fa-sort"></i></th>'
        + '<th class="sortable-header">' + __('حالة الملف') + ' <i class="fa fa-sort"></i></th>'
        + '<th class="sortable-header">' + __('حالة البريد') + ' <i class="fa fa-sort"></i></th>'
        + '<th class="sortable-header">' + __('رفع البريد') + ' <i class="fa fa-sort"></i></th>'
        + '<th class="sortable-header">' + __('تاريخ رفع البريد') + ' <i class="fa fa-sort"></i></th>'
        + '<th class="sortable-header">' + __('رد البريد') + ' <i class="fa fa-sort"></i></th>'
        + '<th class="sortable-header">' + __('تاريخ رد البريد') + ' <i class="fa fa-sort"></i></th>'
        + '<th class="sortable-header">' + __('الملاحظات') + ' <i class="fa fa-sort"></i></th>'
        + '<th class="sortable-header">' + __('المحفظة البريدية') + ' <i class="fa fa-sort"></i></th>'
        + '<th class="sticky-col-left th-actions">' + __('إجراءات') + '</th>'
        + '</tr></thead>'
        + '<tbody id="mail-results-body">'
        + '<tr id="empty-row"><td colspan="20" class="text-center text-muted">' + __('لا توجد سجلات بريد حالياً. ابدأ بإدخال المرجع للبحث.') + '</td>'
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

frappe.pages['dispute-mail-editor'].on_page_load = function (wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __('محرر البريد لملفات المنازعات | Dispute Mail Editor'),
        single_column: true
    });

    // تحميل حالات البريد أولاً، ثم بناء الواجهة
    frappe.call({
        method: 'judicial_files.judicial_files.page.dispute_mail_editor.dispute_mail_editor.get_mail_statuses',
        callback: function (r) {
            if (r.message) {
                DME.State.mail_statuses = r.message;
            }
            $(page.body).html(DME.UI_TEMPLATE());
            DME.Events.setup(page);
        }
    });
};