frappe.provide("judicial_files.utils");

/**
 * تحويل التاريخ الميلادي إلى هجري بالاتصال مع الخادم
 * @param {string} date_str - تاريخ ميلادي بصيغة YYYY-MM-DD
 * @returns {Promise<Object>} كائن يحتوي بيانات التاريخ الهجري
 */
judicial_files.utils.get_hijri_date = function (date_str) {
	if (!date_str) {
		return Promise.resolve(null);
	}

	return new Promise((resolve, reject) => {
		frappe.call({
			method: "judicial_files.judicial_files.utils.convert_date_to_hijri",
			args: { gregorian_date: date_str },
			callback: function (r) {
				if (r.message) {
					resolve(r.message);
				} else {
					resolve(null);
				}
			},
			error: function (err) {
				console.error("خطأ في التحويل الهجري:", err);
				reject(err);
			}
		});
	});
};
