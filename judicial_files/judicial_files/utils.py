import frappe
from frappe.model.document import Document
from hijri_converter import Hijri, Gregorian
from datetime import datetime, date


# أسماء الأشهر الهجرية
HIJRI_MONTHS = [
	"محرم", "صفر", "ربيع الأول", "ربيع الآخر",
	"جمادى الأولى", "جمادى الآخرة", "رجب", "شعبان",
	"رمضان", "شوال", "ذو القعدة", "ذو الحجة",
]


# =============================================================================
# دوال مساعدة داخلية
# =============================================================================


def _parse_date(date_input):
	"""تحويل المدخل إلى كائن date"""
	if not date_input:
		return None
	if isinstance(date_input, str):
		return datetime.strptime(date_input, "%Y-%m-%d").date()
	if isinstance(date_input, datetime):
		return date_input.date()
	if isinstance(date_input, date):
		return date_input
	return None


# =============================================================================
# دوال التاريخ الهجري
# =============================================================================


def get_hijri_date(date_input):
	"""تحويل التاريخ الميلادي إلى هجري باستخدام مكتبة hijri-converter

	Args:
		date_input: تاريخ ميلادي (str بصيغة YYYY-MM-DD أو date أو datetime)

	Returns:
		dict: يحتوي day, month, month_name, year, year_short, date
		None: إذا كان المدخل فارغاً
	"""
	parsed = _parse_date(date_input)
	if not parsed:
		return None

	hijri = Gregorian(parsed.year, parsed.month, parsed.day).to_hijri()
	hijri_year = hijri.year

	return {
		"day": hijri.day,
		"month": hijri.month,
		"month_name": HIJRI_MONTHS[hijri.month - 1] if 1 <= hijri.month <= 12 else "غير معروف",
		"year": hijri_year,
		"year_short": str(hijri_year)[-2:],
		"date": f"{hijri.day}-{hijri.month}-{hijri_year}",
	}


@frappe.whitelist()
def convert_date_to_hijri(gregorian_date):
	"""API endpoint لتحويل التاريخ الميلادي إلى هجري — يُستدعى من JavaScript

	Args:
		gregorian_date: تاريخ ميلادي بصيغة YYYY-MM-DD

	Returns:
		dict: يحتوي day, month, month_name, year, year_short, date
	"""
	if not gregorian_date:
		return None

	return get_hijri_date(gregorian_date)


def get_hijri_year_short(date_input):
	"""للتوافق الخلفي (Backward Compatibility) — بعض الملفات القديمة تستورد هذه الدالة"""
	hijri = get_hijri_date(date_input)
	if not hijri:
		return None
	return hijri["year_short"]


# =============================================================================
# دوال حقول الملفات (موحدة بين تنفيذ ومنازعات)
# =============================================================================


def update_hijri_entry_fields(doc):
	"""حساب entry_date_hijri و year من entry_date"""
	if doc.entry_date:
		hijri = get_hijri_date(doc.entry_date)
		if hijri:
			doc.entry_date_hijri = hijri["date"]
			full_year = int(hijri["year"])
			doc.year = full_year % 100


def update_hijri_archive_fields(doc):
	"""حساب archive_date_hijri و archive_month_hijri و archive_year_hijri من archive_date"""
	if doc.archive_date:
		hijri = get_hijri_date(doc.archive_date)
		if hijri:
			doc.archive_date_hijri = hijri["date"]
			doc.archive_month_hijri = hijri["month_name"]
			doc.archive_year_hijri = str(hijri["year"])
	else:
		doc.archive_date_hijri = None
		doc.archive_month_hijri = None
		doc.archive_year_hijri = None


def clear_archive_fields(doc):
	"""تفريغ حقول الأرشفة إذا كانت حالة الملف 'منظور'"""
	if doc.status == "منظور":
		doc.posting_type = None
		doc.archive_date = None
		doc.archive_date_hijri = None
		doc.archive_month_hijri = None
		doc.archive_year_hijri = None


# =============================================================================
# دوال الترقيم التسلسلي
# =============================================================================


@frappe.whitelist(methods=["POST"])
def get_next_number(doctype, year):
	"""الحصول على الرقم التسلسلي التالي (تقديري) — يُستدعى عند فتح الشاشة"""
	if not doctype or not year:
		frappe.throw("يجب تحديد نوع الملف والسنة")

	allowed_doctypes = ["Execution File", "Dispute File"]
	if doctype not in allowed_doctypes:
		frappe.throw(f"نوع الملف غير مسموح: {doctype}")

	year = str(year).strip()
	if not year.isdigit():
		frappe.throw("السنة يجب أن تكون رقماً")

	last_number = frappe.db.sql(
		f"SELECT MAX(file_number) FROM `tab{doctype}` WHERE year = %s",
		(year,),
	)[0][0]

	return (last_number or 0) + 1


def generate_locked_number(doctype, year):
	"""توليد الرقم التسلسلي النهائي مع قفل لمنع التكرار — يُستدعى عند الحفظ"""
	year = str(year).strip()

	last_number = frappe.db.sql(
		f"SELECT MAX(file_number) FROM `tab{doctype}` WHERE year = %s FOR UPDATE",
		(year,),
	)[0][0]

	return (last_number or 0) + 1


def generate_file_reference(doc):
	"""توليد reference مع FOR UPDATE و retry loop لمنع التعارض"""
	if not doc.year:
		return

	max_retries = 5
	for attempt in range(max_retries):
		new_number = generate_locked_number(doc.doctype, doc.year)
		doc.file_number = new_number
		new_reference = f"{doc.year:02d}-{new_number}"
		doc.reference = new_reference

		if not frappe.db.exists(doc.doctype, {"reference": doc.reference}):
			break


def notify_reference_conflict(doc, original_ref):
	"""تخزين إشارة تغير الرقم في frappe.flags لعرض التنبيه بعد الحفظ"""
	if original_ref and original_ref != doc.reference:
		frappe.flags.reference_changed = {
			"old": original_ref,
			"new": doc.reference,
		}


# =============================================================================
# دوال التحقق
# =============================================================================


def validate_execution_file_status(doc):
	"""التحقق من أن حالة الملف الأصلية 'منظور' — يُستخدم في محرر الدفعات"""
	return doc.status == "منظور" if doc.status else True


def validate_assistant(assistant):
	"""التحقق من صحة معرف معاون التنفيذ في قاعدة البيانات"""
	if assistant and not frappe.db.exists("Judicial Employee", assistant):
		frappe.throw(f"معاون التنفيذ '{assistant}' غير موجود في قاعدة البيانات")
	return assistant


# =============================================================================
# كلاس BaseJudicialFile — الكلاس الأب لملفات التنفيذ والمنازعات
# =============================================================================


class BaseJudicialFile(Document):
	def before_insert(self):
		update_hijri_entry_fields(self)

		if self.year:
			original_ref = self.get("reference")
			generate_file_reference(self)
			notify_reference_conflict(self, original_ref)

	def after_insert(self):
		if frappe.flags.get("reference_changed"):
			change = frappe.flags.reference_changed
			frappe.msgprint(
				msg=f"""
				<div style="text-align:center; padding: 15px; border-radius: 5px; background-color: #fff3cd; color: #856404; border: 1px solid #ffeeba;">
				<h4 style="margin-top: 0;">⚠️ تم تغيير رقم الملف</h4>
				<b>الرقم القديم:</b> {change['old']}<br>
				<b>الرقم الجديد:</b> {change['new']}<br><br>
				<b>السبب:</b> تم حجز الرقم من قِبل مستخدم آخر أثناء إدخالك للبيانات.
				</div>
				""",
				title="تنبيه: تحديث تلقائي للرقم",
				indicator="orange",
				wide=True,
			)
			frappe.flags.reference_changed = None

	def validate(self):
		update_hijri_entry_fields(self)
		update_hijri_archive_fields(self)
		clear_archive_fields(self)
