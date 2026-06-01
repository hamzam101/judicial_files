from __future__ import annotations

import json
from typing import Any

import frappe
from frappe.utils import today

from judicial_files.judicial_files.utils import validate_execution_file_status

BATCH_STATUS_DRAFT = "Draft"
BATCH_STATUS_POSTED = "Posted"
DISPUTE_FILE_TYPE = "منازعات"


# ---------------------------------------------------------------------------
# Dispute File API
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_dispute_file(reference: str) -> dict | None:
    """
    يجلب بيانات ملف منازعات أساسية (بدون سجلات البريد).
    """
    try:
        file_data = frappe.db.get_value(
            "Dispute File",
            {"reference": reference},
            [
                "name", "reference", "file_number", "year",
                "petitioner", "respondent", "judge",
                "secretary", "current_secretary",
                "execution_file_no",
                "status",
            ],
            as_dict=True,
        )
        if not file_data:
            return None

        return file_data
    except Exception as e:
        frappe.log_error(
            message=frappe.get_traceback(),
            title="Dispute Mail Editor Get Error",
        )
        return None


@frappe.whitelist()
def search_dispute_files(
    file_number: str | None = None,
    year: str | None = None,
    petitioner: str | None = None,
    respondent: str | None = None,
) -> list[dict]:
    """
    يبحث عن ملفات منازعات بمعايير جزئية.
    """
    try:
        filters: dict[str, Any] = {}
        if file_number:
            filters["file_number"] = ["like", f"%{file_number}%"]
        if year:
            filters["year"] = year
        if petitioner:
            filters["petitioner"] = ["like", f"%{petitioner}%"]
        if respondent:
            filters["respondent"] = ["like", f"%{respondent}%"]

        if not filters:
            return []

        return frappe.db.get_all(
            "Dispute File",
            filters=filters,
            fields=[
                "name", "reference", "file_number", "year",
                "petitioner", "respondent", "judge",
                "secretary", "current_secretary",
                "execution_file_no",
                "status",
            ],
            limit=15,
        )
    except Exception as e:
        frappe.log_error(
            message=frappe.get_traceback(),
            title="Dispute Mail Editor Search Error",
        )
        return []


@frappe.whitelist()
def get_mail_statuses() -> list[dict]:
    """يجلب جميع حالات البريد من Judicial Mail Status."""
    try:
        return frappe.get_all("Judicial Mail Status", fields=["mail_status"], order_by="mail_status")
    except Exception as e:
        frappe.log_error(
            message=frappe.get_traceback(),
            title="Get Mail Statuses Error",
        )
        return []


# ---------------------------------------------------------------------------
# Mail Batch API
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_draft_batches() -> list[dict]:
    """يجلب كل محافظ البريد المسودة (Draft)."""
    try:
        return _get_batches_with_extras(
            BATCH_STATUS_DRAFT,
            date_field="creation_date",
            order_by="modified desc",
        )
    except Exception as e:
        frappe.log_error(
            message=frappe.get_traceback(),
            title="Get Draft Mail Batches Error",
        )
        return []


@frappe.whitelist()
def get_posted_batches() -> list[dict]:
    """يجلب كل محافظ البريد المرحلة (Posted)."""
    try:
        return _get_batches_with_extras(
            BATCH_STATUS_POSTED,
            date_field="posting_date",
            order_by="posting_date desc",
        )
    except Exception as e:
        frappe.log_error(
            message=frappe.get_traceback(),
            title="Get Posted Mail Batches Error",
        )
        return []


def _get_batches_with_extras(status: str, date_field: str, order_by: str) -> list[dict]:
    """يجلب المحافظ البريدية."""
    try:
        return frappe.get_all(
            "Judicial Mail Batch",
            filters={"status": status, "file_type": DISPUTE_FILE_TYPE},
            fields=["name", "title", "status", date_field, "description"],
            order_by=order_by,
        )
    except Exception:
        return []


@frappe.whitelist()
def load_batch_data(batch_name: str) -> dict | None:
    """يجلب بيانات محفظة بريد كاملة مع بنودها الداخلية."""
    try:
        if not frappe.db.exists("Judicial Mail Batch", batch_name):
            return None

        batch = frappe.get_doc("Judicial Mail Batch", batch_name)
        items = []
        for item in batch.dispute_items:
            items.append({
                "reference": item.get("reference"),
                "dispute_file": item.get("dispute_file"),
                "file_number": item.get("file_number"),
                "year": item.get("year"),
                "petitioner": item.get("petitioner"),
                "respondent": item.get("respondent"),
                "judge": item.get("judge"),
                "secretary": item.get("secretary"),
                "current_secretary": item.get("current_secretary"),
                "execution_file_no": item.get("execution_file_no"),
                "original_status": item.get("original_status"),
                "upload_mail": item.get("upload_mail"),
                "upload_mail_date": item.get("upload_mail_date"),
                "mail_returned": item.get("mail_returned"),
                "mail_returned_date": item.get("mail_returned_date"),
                "mail_status": item.get("mail_status"),
                "mail_notes": item.get("mail_notes"),
            })

        return {
            "name": batch.name,
            "title": batch.title,
            "description": batch.description or "",
            "status": batch.status,
            "items": items,
        }
    except Exception as e:
        frappe.log_error(
            message=frappe.get_traceback(),
            title="Load Mail Batch Data Error",
        )
        return None


@frappe.whitelist()
def delete_draft_batch(batch_name: str) -> dict:
    """حذف محفظة بريد مسودة (Draft فقط)."""
    try:
        if not frappe.db.exists("Judicial Mail Batch", batch_name):
            return {"success": False, "message": "المحفظة غير موجودة"}
        doc = frappe.get_doc("Judicial Mail Batch", batch_name)
        if doc.status != BATCH_STATUS_DRAFT:
            return {"success": False, "message": "لا يمكن حذف محفظة مرحلة"}
        frappe.delete_doc("Judicial Mail Batch", batch_name, ignore_permissions=True)
        frappe.db.commit()
        return {"success": True, "message": "تم الحذف بنجاح"}
    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(
            message=frappe.get_traceback(),
            title="Delete Mail Draft Batch Error",
        )
        return {"success": False, "message": str(e)}


@frappe.whitelist()
def update_batch_header(
    batch_name: str,
    title: str | None = None,
    description: str | None = None,
) -> dict:
    """تحديث بيانات رأس المحفظة البريدية دون تغيير الحالة."""
    try:
        if not frappe.db.exists("Judicial Mail Batch", batch_name):
            return {"success": False, "message": "المحفظة غير موجودة"}
        doc = frappe.get_doc("Judicial Mail Batch", batch_name)
        if title:
            doc.title = title
        if description is not None:
            doc.description = description
        doc.save(ignore_permissions=True)
        frappe.db.commit()
        return {"success": True, "message": "تم التحديث بنجاح", "batch_name": doc.name, "title": doc.title}
    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(
            message=frappe.get_traceback(),
            title="Update Mail Batch Header Error",
        )
        return {"success": False, "message": str(e)}


# ---------------------------------------------------------------------------
# دالة داخلية موحدة لحفظ محافظ البريد (Draft / Posted)
# ---------------------------------------------------------------------------

def _save_batch(
    items: list[dict],
    is_post: bool = False,
    batch_name: str | None = None,
    title: str | None = None,
    description: str | None = None,
) -> dict:
    """
    دالة داخلية موحدة لحفظ أو ترحيل محفظة بريد.

    Args:
        items: بنود المحفظة من الجدول
        is_post: True = ترحيل نهائي (Posted), False = مسودة (Draft)
        batch_name: اسم المحفظة إن كانت موجودة مسبقاً
        title: عنوان المحفظة
        description: وصف المحفظة

    Returns:
        dict: نتيجة العملية مع batch_name و title
    """
    try:
        if batch_name and frappe.db.exists("Judicial Mail Batch", batch_name):
            doc = frappe.get_doc("Judicial Mail Batch", batch_name)
        else:
            if not title:
                return {"success": False, "message": "يجب إدخال عنوان للمحفظة الجديدة"}
            doc = frappe.new_doc("Judicial Mail Batch")
            doc.title = title
            doc.creation_date = today()
            doc.status = BATCH_STATUS_DRAFT
            doc.file_type = DISPUTE_FILE_TYPE

        if title:
            doc.title = title
        if description is not None:
            doc.description = description

        if is_post:
            doc.status = BATCH_STATUS_POSTED
            doc.posting_date = today()
        elif doc.status == BATCH_STATUS_POSTED:
            doc.status = BATCH_STATUS_DRAFT

        # إعادة بناء البنود الداخلية
        doc.set("dispute_items", [])
        for r in items:
            doc.append("dispute_items", {
                "reference": r.get("reference"),
                "dispute_file": r.get("dispute_file") or r.get("name"),
                "file_number": r.get("file_number"),
                "year": r.get("year"),
                "petitioner": r.get("petitioner"),
                "respondent": r.get("respondent"),
                "judge": r.get("judge"),
                "secretary": r.get("secretary"),
                "current_secretary": r.get("current_secretary"),
                "execution_file_no": r.get("execution_file_no"),
                "original_status": r.get("original_status") or r.get("status"),
                "upload_mail": r.get("upload_mail"),
                "upload_mail_date": r.get("upload_mail_date"),
                "mail_returned": r.get("mail_returned"),
                "mail_returned_date": r.get("mail_returned_date"),
                "mail_status": r.get("mail_status"),
                "mail_notes": r.get("mail_notes"),
            })

        doc.save(ignore_permissions=True)

        # إذا كان ترحيلاً: إضافة/تحديث سجلات البريد في ملفات المنازعات الحية
        if is_post:
            for item in doc.dispute_items:
                dispute_file_name = item.dispute_file
                if not dispute_file_name:
                    dispute_file_name = frappe.db.get_value(
                        "Dispute File", {"reference": item.reference}, "name"
                    )

                if dispute_file_name:
                    dispute_doc = frappe.get_doc("Dispute File", dispute_file_name)

                    # هل يوجد سجل Mail Data سابق لهذه المحفظة؟
                    existing_mail_data = frappe.db.get_value(
                        "Mail Data",
                        {
                            "parent": dispute_file_name,
                            "parenttype": "Dispute File",
                            "parentfield": "mail_data",
                            "judicial_mail_batch": doc.name,
                        },
                        "name",
                    )

                    if existing_mail_data:
                        # المرحلة 2 — تحديث الرد في السجل الموجود
                        for row in dispute_doc.mail_data:
                            if row.name == existing_mail_data:
                                row.mail_returned = item.mail_returned
                                row.mail_returned_date = item.mail_returned_date
                                row.mail_status = item.mail_status
                                row.mail_notes = item.mail_notes
                                break
                    else:
                        # المرحلة 1 — إنشاء سجل بريد جديد مع رابط المحفظة
                        dispute_doc.append("mail_data", {
                            "upload_mail": item.upload_mail,
                            "upload_mail_date": item.upload_mail_date,
                            "mail_status": item.mail_status,
                            "mail_notes": item.mail_notes,
                            "judicial_mail_batch": doc.name,
                        })

                    dispute_doc.save(ignore_permissions=True)

        frappe.db.commit()
        return {"success": True, "batch_name": doc.name, "title": doc.title}

    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(
            message=frappe.get_traceback(),
            title="Save Mail Batch Error",
        )
        return {"success": False, "message": str(e)}


# ---------------------------------------------------------------------------
# API العامة لحفظ محافظ البريد
# ---------------------------------------------------------------------------

@frappe.whitelist()
def save_batch_draft(
    batch_name: str | None = None,
    items: str | None = None,
    title: str | None = None,
    description: str | None = None,
) -> dict:
    """يحفظ محفظة بريد كمسودة (دون تعديل ملفات المنازعات الحية)."""
    records = json.loads(items) if items else []
    return _save_batch(
        items=records,
        is_post=False,
        batch_name=batch_name,
        title=title,
        description=description,
    )


@frappe.whitelist()
def post_batch_archive(
    batch_name: str | None = None,
    items: str | None = None,
    title: str | None = None,
    description: str | None = None,
) -> dict:
    """يرحّل المحفظة البريدية نهائياً ويُضيف سجلات البريد إلى ملفات المنازعات الحية."""
    records = json.loads(items) if items else []
    return _save_batch(
        items=records,
        is_post=True,
        batch_name=batch_name,
        title=title,
        description=description,
    )


# ---------------------------------------------------------------------------
# جلب الملفات المستكمِل إطلاعها
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_files_with_mail_status(file_status="منظور", target_mail_status="استكمال الاطلاع"):
    """
    جلب ملفات المنازعات التي أحدث سجل بريد مرسل لها حالته 'استكمال الإطلاع'

    Args:
        file_status (str): حالة ملف المنازعات المطلوبة (افتراضي: "منظور")
        target_mail_status (str): حالة البريد المطلوبة لأحدث سجل (افتراضي: "استكمال الإطلاع")

    Returns:
        list: قائمة بملفات المنازعات مع بيانات البريد المرتبطة بها
    """
    query = """
        SELECT
            f.name,
            f.reference,
            f.file_number,
            f.year,
            f.petitioner,
            f.respondent,
            f.judge,
            f.secretary,
            f.current_secretary,
            f.execution_file_no,
            f.status,
            m.mail_status,
            m.upload_mail,
            m.upload_mail_date,
            m.mail_returned,
            m.mail_returned_date,
            m.judicial_mail_batch,
            m.mail_notes
        FROM `tabDispute File` f
        INNER JOIN (
            SELECT
                parent,
                mail_status,
                upload_mail,
                upload_mail_date,
                mail_returned,
                mail_returned_date,
                judicial_mail_batch,
                mail_notes,
                ROW_NUMBER() OVER (
                    PARTITION BY parent
                    ORDER BY mail_returned_date DESC, creation DESC
                ) as rn
            FROM `tabMail Data`
            WHERE mail_returned_date IS NOT NULL
              AND mail_returned_date <= CURDATE()
        ) m ON m.parent = f.name AND m.rn = 1
        WHERE f.status = %s
          AND m.mail_status = %s
    """

    return frappe.db.sql(query, (file_status, target_mail_status), as_dict=True)


# ---------------------------------------------------------------------------
# جلب جميع ملفات المنازعات مع أحدث سجل بريد (بدون فلترة mail_status)
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_files_with_any_mail_status(file_status=None, mail_status=None):
    """
    جلب ملفات المنازعات التي لها أحدث سجل بريد، مع فلترة اختيارية حسب حالة الملف و/أو حالة البريد

    Args:
        file_status (str, optional): حالة ملف المنازعات للفلترة (افتراضي: None = الكل)
        mail_status (str, optional): حالة البريد للفلترة (افتراضي: None = الكل)

    Returns:
        list: قائمة بملفات المنازعات مع بيانات البريد المرتبطة بها
    """
    query = """
        SELECT
            f.name,
            f.reference,
            f.file_number,
            f.year,
            f.petitioner,
            f.respondent,
            f.judge,
            f.secretary,
            f.current_secretary,
            f.execution_file_no,
            f.status,
            m.mail_status,
            m.upload_mail,
            m.upload_mail_date,
            m.mail_returned,
            m.mail_returned_date,
            m.mail_notes
        FROM `tabDispute File` f
        INNER JOIN (
            SELECT
                parent,
                mail_status,
                upload_mail,
                upload_mail_date,
                mail_returned,
                mail_returned_date,
                mail_notes,
                ROW_NUMBER() OVER (
                    PARTITION BY parent
                    ORDER BY mail_returned_date DESC, creation DESC
                ) as rn
            FROM `tabMail Data`
            WHERE mail_returned_date IS NOT NULL
              AND mail_returned_date <= CURDATE()
        ) m ON m.parent = f.name AND m.rn = 1
        WHERE 1=1
    """
    params = {}
    if file_status:
        query += " AND f.status = %(file_status)s"
        params['file_status'] = file_status
    if mail_status:
        query += " AND m.mail_status = %(mail_status)s"
        params['mail_status'] = mail_status

    return frappe.db.sql(query, params, as_dict=1)
