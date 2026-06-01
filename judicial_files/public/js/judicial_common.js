frappe.provide("judicial_files.common");

/**
 * معالج موحد لتغيير تاريخ الورود
 */
judicial_files.common.handle_entry_date = async function (frm) {
	if (frm.doc.entry_date) {
		try {
			const hijri = await judicial_files.utils.get_hijri_date(frm.doc.entry_date);
			if (hijri) {
				frm.set_value("entry_date_hijri", hijri.date);
				frm.set_value("year", parseInt(hijri.year_short));

				// استدعاء الرقم التسلسلي التقديري إذا كان الملف جديداً
				if (frm.is_new()) {
					frappe.call({
						method: "judicial_files.judicial_files.utils.get_next_number",
						args: {
							doctype: frm.doc.doctype,
							year: hijri.year_short
						},
						callback: function (r) {
							if (r.message) {
								frm.set_value("file_number", r.message);
								frm.set_value("reference", `${hijri.year_short}-${r.message}`);
							}
						}
					});
				}
			}
		} catch (err) {
			frappe.msgprint(__("حدث خطأ أثناء حساب التاريخ الهجري."));
		}
	} else {
		frm.set_value("entry_date_hijri", null);
		frm.set_value("year", null);
		if (frm.is_new()) {
			frm.set_value("file_number", null);
			frm.set_value("reference", null);
		}
	}
};

/**
 * معالج موحد لتغيير تاريخ الأرشفة
 */
judicial_files.common.handle_archive_date = async function (frm) {
	if (frm.doc.archive_date) {
		try {
			const hijri = await judicial_files.utils.get_hijri_date(frm.doc.archive_date);
			if (hijri) {
				frm.set_value("archive_date_hijri", hijri.date);
				frm.set_value("archive_month_hijri", hijri.month_name);
				frm.set_value("archive_year_hijri", hijri.year.toString());
			}
		} catch (err) {
			frappe.msgprint(__("حدث خطأ أثناء حساب تاريخ الأرشفة الهجري."));
		}
	} else {
		frm.set_value("archive_date_hijri", null);
		frm.set_value("archive_month_hijri", null);
		frm.set_value("archive_year_hijri", null);
	}
};

/**
 * معالج موحد لإظهار وإخفاء حقول الأرشفة بناءً على حالة الملف
 */
judicial_files.common.toggle_archive_fields = function (frm) {
	const is_منظور = (frm.doc.status === "منظور");
	const fields = ["posting_type", "archive_date", "archive_date_hijri", "archive_month_hijri", "archive_year_hijri"];

	frm.toggle_display(fields, !is_منظور);

	// إذا كانت الحالة منظور، يتم مسح قيم الأرشفة لمنع البيانات القديمة
	if (is_منظور) {
		fields.forEach(f => {
			if (frm.doc[f]) frm.set_value(f, null);
		});
	}
};

/**
 * فلترة القاضي حسب التصنيف الوظيفي
 */
judicial_files.common.setup_judge_filter = function (frm, fieldname, table_name) {
	fieldname = fieldname || "judge";
	if (table_name) {
		frm.set_query(fieldname, table_name, function () {
			return { filters: { "designation": "قاضي" } };
		});
	} else {
		frm.set_query(fieldname, function () {
			return { filters: { "designation": "قاضي" } };
		});
	}
};

/**
 * فلترة معاون التنفيذ حسب التصنيف الوظيفي
 */
judicial_files.common.setup_assistant_filter = function (frm, fieldname) {
	fieldname = fieldname || "execution_assistant";
	frm.set_query(fieldname, function () {
		return { filters: { "designation": "معاون تنفيذ" } };
	});
};

/**
 * فلترة الإجراءات والضمانات حسب نوع الملف
 */
judicial_files.common.setup_procedure_filters = function (frm, file_type) {
	frm.set_query("procedure_type", "judicial_procedures", function () {
		return { filters: { "file_type": file_type } };
	});
	frm.set_query("guarantee_type", "judicial_procedures", function () {
		return { filters: { "file_type": file_type } };
	});
};
