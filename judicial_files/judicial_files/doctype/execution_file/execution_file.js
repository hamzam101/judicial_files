frappe.ui.form.on('Execution File', {
	refresh: function(frm) {
		judicial_files.common.toggle_archive_fields(frm);
	},

	setup: function(frm) {
		frm.set_query("judge", function() {
			return { filters: { "designation": "قاضي" } };
		});

		frm.set_query("execution_assistant", function() {
			return { filters: { "designation": "معاون تنفيذ" } };
		});

		frm.set_query("judge", "referrals", function() {
			return { filters: { "designation": "قاضي" } };
		});

		frm.set_query("procedure_type", "judicial_procedures", function() {
			return { filters: { "file_type": "تنفيذ" } };
		});

		frm.set_query("guarantee_type", "judicial_procedures", function() {
			return { filters: { "file_type": "تنفيذ" } };
		});
	},

	status: function(frm) {
		judicial_files.common.toggle_archive_fields(frm);
	},

	entry_date: function(frm) {
		judicial_files.common.handle_entry_date(frm);
	},

	archive_date: function(frm) {
		judicial_files.common.handle_archive_date(frm);
	}
});
