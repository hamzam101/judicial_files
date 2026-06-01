frappe.ui.form.on('Dispute File', {
	refresh: function (frm) {
		// No fields are hidden on load anymore, they just remain empty if null
	},

	setup: function (frm) {
		frm.set_query("judge", function () {
			return { filters: { "designation": "قاضي" } };
		});

		frm.set_query("secretary", function () {
			return { filters: { "designation": "أمين سر" } };
		});

		frm.set_query("execution_assistant", function () {
			return { filters: { "designation": "معاون تنفيذ" } };
		});

		frm.set_query("procedure_type", "judicial_procedures", function () {
			return { filters: { "file_type": "منازعات" } };
		});

		frm.set_query("guarantee_type", "judicial_procedures", function () {
			return { filters: { "file_type": "منازعات" } };
		});
	},

	entry_date: function (frm) {
		judicial_files.common.handle_entry_date(frm);
	},

	archive_date: function (frm) {
		judicial_files.common.handle_archive_date(frm);
	},

	judicial_file_category: function (frm) {
		handle_dispute_category(frm);
	},

	execution_file_no: function (frm) {
		handle_dispute_category(frm);
	}
});

function handle_dispute_category(frm) {
	if (!frm.doc.execution_file_no) return;

	if (frm.doc.judicial_file_category === "دعوى استحقاق") {
		frappe.db.get_doc("Execution File", frm.doc.execution_file_no)
			.then(execution_file => {
				const petitioner = execution_file.petitioner || "";
				const respondent = execution_file.respondent || "";

				// دمج المدعي والمدعى عليه ووضعهما في حقل المدعى عليه في المنازعات
				let merged_parties = [];
				if (petitioner) merged_parties.push(petitioner);
				if (respondent) merged_parties.push(respondent);

				frm.set_value("respondent", merged_parties.join(" - "));

				// ترك حقل المدعي فارغاً ليدخله المستخدم
				frm.set_value("petitioner", "");
			});
	} else {
		// السلوك الطبيعي: عكس الأطراف (المدعي يصبح مدعى عليه والعكس)
		frappe.db.get_value("Execution File", frm.doc.execution_file_no, ["petitioner", "respondent"])
			.then(r => {
				if (r.message) {
					frm.set_value("respondent", r.message.petitioner || "");
					frm.set_value("petitioner", r.message.respondent || "");
				}
			});
	}
}
