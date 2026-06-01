import frappe
from judicial_files.judicial_files.utils import BaseJudicialFile

class DisputeFile(BaseJudicialFile):
	def validate(self):
		# استدعاء دالة validate من الكلاس الأب لحساب تواريخ الأرشفة والورود
		super().validate()

		# حماية خلفية: منطق الأطراف بناءً على فئة الملف
		if self.execution_file_no:
			execution_file = frappe.db.get_value(
				"Execution File", 
				self.execution_file_no, 
				["petitioner", "respondent"], 
				as_dict=True
			)
			if execution_file:
				if self.judicial_file_category == "دعوى استحقاق":
					parties = []
					if execution_file.petitioner:
						parties.append(execution_file.petitioner)
					if execution_file.respondent:
						parties.append(execution_file.respondent)
					
					# دمج الأطراف وتخزينها في المدعى عليه
					if parties:
						self.respondent = " - ".join(parties)
						
					# تفريغ المدعي إذا لم يكن قد تم تعبئته يدوياً من قبل
					if self.is_new() and not self.get_db_value("petitioner"):
						self.petitioner = None
				else:
					# السلوك الطبيعي: عكس الأطراف
					self.respondent = execution_file.petitioner
					self.petitioner = execution_file.respondent
