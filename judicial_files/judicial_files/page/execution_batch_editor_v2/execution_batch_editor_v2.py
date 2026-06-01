from __future__ import annotations

import json
from typing import Any

import frappe
from frappe.utils import today

from judicial_files.judicial_files.utils import validate_assistant, validate_execution_file_status

BATCH_STATUS_DRAFT = "Draft"
BATCH_STATUS_POSTED = "Posted"
EXECUTION_FILE_TYPE = "تنفيذ"


# ---------------------------------------------------------------------------
# Execution File API
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_execution_file(reference: str) -> dict | None:
    """
    يجلب بيانات ملف تنفيذ كامل بواسطة المرجع.
    تُستخدم في صفحة محرر الدفعات v2.
    """
    try:
        return frappe.db.get_value(
            "Execution File",
            {"reference": reference},
            [
                "name", "reference", "file_number", "year",
                "petitioner", "respondent", "judge",
                "execution_assistant", "current_execution_assistant",
                "status", "posting_type",
                "archive_date", "archive_year_hijri", "archive_month_hijri",
            ],
            as_dict=True,
        )
    except Exception as e:
        frappe.log_error(
            message=frappe.get_traceback(),
            title="Execution Batch Editor V2 Get Error",
        )
        return None


@frappe.whitelist()
def search_execution_files(
    file_number: str | None = None,
    year: str | None = None,
    petitioner: str | None = None,
    respondent: str | None = None,
) -> list[dict]:
    """
    يبحث عن ملفات تنفيذ بمعايير جزئية.
    تُستخدم عند حل الصفوف المفقودة (غير الموجودة).
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
            "Execution File",
            filters=filters,
            fields=[
                "name", "reference", "file_number", "year",
                "petitioner", "respondent", "judge",
                "execution_assistant", "current_execution_assistant",
                "status", "posting_type",
                "archive_date", "archive_year_hijri", "archive_month_hijri",
            ],
            limit=15,
        )
    except Exception as e:
        frappe.log_error(
            message=frappe.get_traceback(),
            title="Execution Batch Editor V2 Search Error",
        )
        return []


@frappe.whitelist()
def save_grid_changes(changes: str) -> bool:
    """
    يحفظ التعديلات السريعة من شبكة التحرير.
    يسمح فقط بتحديث: current_execution_assistant, status, posting_type, archive_date.
    يتخطى أي ملف حالته الأصلية غير 'منظور'.
    """
    try:
        records = json.loads(changes)
        for record in records:
            name = record.get("name")
            reference = record.get("reference")

            if name:
                doc = frappe.get_doc("Execution File", name)
            elif reference:
                existing_name = frappe.db.get_value("Execution File", {"reference": reference}, "name")
                if existing_name:
                    doc = frappe.get_doc("Execution File", existing_name)
                else:
                    doc = frappe.new_doc("Execution File")
                    doc.reference = reference
                    doc.entry_date = today()
            else:
                continue

            if not validate_execution_file_status(doc):
                continue

            doc.current_execution_assistant = validate_assistant(record.get("current_execution_assistant"))

            new_status = record.get("new_status")
            if new_status:
                doc.status = new_status

            doc.posting_type = record.get("posting_type")

            if record.get("archive_date") is not None:
                doc.archive_date = record.get("archive_date") or None

            doc.save(ignore_permissions=True)

        frappe.db.commit()
        return True
    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(
            message=frappe.get_traceback(),
            title="Execution Batch Editor V2 Save Error",
        )
        return False


# ---------------------------------------------------------------------------
# Archive Batch API
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_draft_batches() -> list[dict]:
    """يجلب كل محافظ الأرشيف المسودة (Draft)."""
    try:
        return _get_batches_with_extras(
            BATCH_STATUS_DRAFT,
            date_field="creation_date",
            order_by="modified desc",
        )
    except Exception as e:
        frappe.log_error(
            message=frappe.get_traceback(),
            title="Get Draft Batches Error",
        )
        return []


@frappe.whitelist()
def get_posted_batches() -> list[dict]:
    """يجلب كل محافظ الأرشيف المرحلة (Posted)."""
    try:
        return _get_batches_with_extras(
            BATCH_STATUS_POSTED,
            date_field="posting_date",
            order_by="posting_date desc",
        )
    except Exception as e:
        frappe.log_error(
            message=frappe.get_traceback(),
            title="Get Posted Batches Error",
        )
        return []


def _get_batches_with_extras(status: str, date_field: str, order_by: str) -> list[dict]:
    """يجلب المحافظ ويحاول إضافة الحقول الإضافية إن وُجدت في قاعدة البيانات."""
    try:
        return frappe.get_all(
            "Judicial Archive Batch",
            filters={"status": status, "file_type": EXECUTION_FILE_TYPE},
            fields=["name", "title", "status", date_field, "description", "archive_month_hijri", "archive_year_hijri"],
            order_by=order_by,
        )
    except Exception:
        # الأعمدة غير موجودة في قاعدة البيانات (لم يتم تشغيل bench migrate)
        return frappe.get_all(
            "Judicial Archive Batch",
            filters={"status": status, "file_type": EXECUTION_FILE_TYPE},
            fields=["name", "title", "status", date_field, "description"],
            order_by=order_by,
        )


@frappe.whitelist()
def load_batch_data(batch_name: str) -> dict | None:
    """يجلب بيانات محفظة كاملة مع بنودها الداخلية."""
    try:
        if not frappe.db.exists("Judicial Archive Batch", batch_name):
            return None

        batch = frappe.get_doc("Judicial Archive Batch", batch_name)
        items = []
        for item in batch.items:
            items.append({
                "reference": item.get("reference"),
                "execution_file": item.get("execution_file"),
                "file_number": item.get("file_number"),
                "year": item.get("year"),
                "petitioner": item.get("petitioner"),
                "respondent": item.get("respondent"),
                "judge": item.get("judge"),
                "original_assistant": item.get("original_assistant"),
                "current_assistant": item.get("current_assistant"),
                "original_status": item.get("original_status"),
                "new_status": item.get("new_status"),
                "posting_type": item.get("posting_type"),
                "archive_date": item.get("archive_date"),
                "archive_year_hijri": item.get("archive_year_hijri"),
                "archive_month_hijri": item.get("archive_month_hijri"),
            })

        return {
            "name": batch.name,
            "title": batch.title,
            "description": batch.description or "",
            "status": batch.status,
            "logo_emblem": batch.get("logo_emblem", "") or "",
            "header_text_image": batch.get("header_text_image", "") or "",
            "judge_name": batch.get("judge_name", "") or "",
            "archive_date": batch.get("archive_date", "") or "",
            "archive_date_hijri": batch.get("archive_date_hijri", "") or "",
            "archive_year_hijri": batch.get("archive_year_hijri", "") or "",
            "archive_month_hijri": batch.get("archive_month_hijri", "") or "",
            "items": items,
        }
    except Exception as e:
        frappe.log_error(
            message=frappe.get_traceback(),
            title="Load Batch Data Error",
        )
        return None


@frappe.whitelist()
def delete_draft_batch(batch_name: str) -> dict:
    """حذف محفظة أرشيف مسودة (Draft فقط)."""
    try:
        if not frappe.db.exists("Judicial Archive Batch", batch_name):
            return {"success": False, "message": "المحفظة غير موجودة"}
        doc = frappe.get_doc("Judicial Archive Batch", batch_name)
        if doc.status != BATCH_STATUS_DRAFT:
            return {"success": False, "message": "لا يمكن حذف محفظة مرحلة"}
        frappe.delete_doc("Judicial Archive Batch", batch_name, ignore_permissions=True)
        frappe.db.commit()
        return {"success": True, "message": "تم الحذف بنجاح"}
    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(
            message=frappe.get_traceback(),
            title="Delete Draft Batch Error",
        )
        return {"success": False, "message": str(e)}


@frappe.whitelist()
def update_batch_header(
    batch_name: str,
    title: str | None = None,
    description: str | None = None,
    logo_emblem: str | None = None,
    header_text_image: str | None = None,
    judge_name: str | None = None,
    archive_date: str | None = None,
    archive_date_hijri: str | None = None,
    archive_year_hijri: str | None = None,
    archive_month_hijri: str | None = None,
) -> dict:
    """تحديث بيانات رأس المحفظة دون تغيير الحالة."""
    try:
        if not frappe.db.exists("Judicial Archive Batch", batch_name):
            return {"success": False, "message": "المحفظة غير موجودة"}
        doc = frappe.get_doc("Judicial Archive Batch", batch_name)
        if title:
            doc.title = title
        if description is not None:
            doc.description = description
        if logo_emblem is not None:
            doc.logo_emblem = logo_emblem
        if header_text_image is not None:
            doc.header_text_image = header_text_image
        if judge_name is not None:
            doc.judge_name = judge_name
        if archive_date is not None:
            doc.archive_date = archive_date or None
        if archive_date_hijri is not None:
            doc.archive_date_hijri = archive_date_hijri or None
        if archive_year_hijri is not None:
            doc.archive_year_hijri = archive_year_hijri or None
        if archive_month_hijri is not None:
            doc.archive_month_hijri = archive_month_hijri
        doc.save(ignore_permissions=True)
        frappe.db.commit()
        return {"success": True, "message": "تم التحديث بنجاح", "batch_name": doc.name, "title": doc.title}
    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(
            message=frappe.get_traceback(),
            title="Update Batch Header Error",
        )
        return {"success": False, "message": str(e)}


# ---------------------------------------------------------------------------
# دالة داخلية موحدة لحفظ المحافظ (Draft / Posted)
# ---------------------------------------------------------------------------

def _save_batch(
    items: list[dict],
    is_post: bool = False,
    batch_name: str | None = None,
    title: str | None = None,
    description: str | None = None,
    logo_emblem: str | None = None,
    header_text_image: str | None = None,
    judge_name: str | None = None,
    archive_date: str | None = None,
    archive_date_hijri: str | None = None,
    archive_year_hijri: str | None = None,
    archive_month_hijri: str | None = None,
) -> dict:
    """
    دالة داخلية موحدة لحفظ أو ترحيل محفظة أرشيف.

    Args:
        items: بنود المحفظة من الجدول
        is_post: True = ترحيل نهائي (Posted), False = مسودة (Draft)
        batch_name: اسم المحفظة إن كانت موجودة مسبقاً
        باقي المعاملات: بيانات رأس المحفظة

    Returns:
        dict: نتيجة العملية مع batch_name و title
    """
    try:
        if batch_name and frappe.db.exists("Judicial Archive Batch", batch_name):
            doc = frappe.get_doc("Judicial Archive Batch", batch_name)
        else:
            if not title:
                return {"success": False, "message": "يجب إدخال عنوان للمحفظة الجديدة"}
            doc = frappe.new_doc("Judicial Archive Batch")
            doc.title = title
            doc.creation_date = today()
            doc.status = BATCH_STATUS_DRAFT
            doc.file_type = EXECUTION_FILE_TYPE

        # تحديث بيانات رأس المحفظة
        if title:
            doc.title = title
        if description is not None:
            doc.description = description
        if logo_emblem is not None:
            doc.logo_emblem = logo_emblem
        if header_text_image is not None:
            doc.header_text_image = header_text_image
        if judge_name is not None:
            doc.judge_name = judge_name
        if archive_date is not None:
            doc.archive_date = archive_date or None
        if archive_date_hijri is not None:
            doc.archive_date_hijri = archive_date_hijri or None
        if archive_year_hijri is not None:
            doc.archive_year_hijri = archive_year_hijri or None
        if archive_month_hijri is not None:
            doc.archive_month_hijri = archive_month_hijri

        if is_post:
            doc.status = BATCH_STATUS_POSTED
            doc.posting_date = today()

        # إعادة بناء البنود الداخلية
        doc.set("items", [])
        for r in items:
            doc.append("items", {
                "reference": r.get("reference"),
                "execution_file": r.get("execution_file") or r.get("name"),
                "file_number": r.get("file_number"),
                "year": r.get("year"),
                "petitioner": r.get("petitioner"),
                "respondent": r.get("respondent"),
                "judge": r.get("judge"),
                "original_assistant": r.get("original_assistant") or r.get("execution_assistant"),
                "current_assistant": r.get("current_assistant") or r.get("current_execution_assistant"),
                "original_status": r.get("original_status") or r.get("status"),
                "new_status": r.get("new_status"),
                "posting_type": r.get("posting_type"),
                "archive_date": r.get("archive_date"),
                "archive_year_hijri": r.get("archive_year_hijri"),
                "archive_month_hijri": r.get("archive_month_hijri"),
            })

        doc.save(ignore_permissions=True)

        # إذا كان ترحيلاً: تحديث ملفات التنفيذ الحية
        if is_post:
            for item in doc.items:
                exec_file_name = item.execution_file
                if not exec_file_name:
                    exec_file_name = frappe.db.get_value(
                        "Execution File", {"reference": item.reference}, "name"
                    )

                if exec_file_name:
                    exec_doc = frappe.get_doc("Execution File", exec_file_name)
                    if not validate_execution_file_status(exec_doc):
                        continue

                    exec_doc.current_execution_assistant = item.current_assistant
                    if item.new_status:
                        exec_doc.status = item.new_status
                    if item.posting_type:
                        exec_doc.posting_type = item.posting_type
                    if item.archive_date:
                        exec_doc.archive_date = item.archive_date
                    exec_doc.save(ignore_permissions=True)

        frappe.db.commit()
        return {"success": True, "batch_name": doc.name, "title": doc.title}

    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(
            message=frappe.get_traceback(),
            title="Save Batch Error",
        )
        return {"success": False, "message": str(e)}


# ---------------------------------------------------------------------------
# API العامة لحفظ المحافظ
# ---------------------------------------------------------------------------

@frappe.whitelist()
def save_batch_draft(
    batch_name: str | None = None,
    items: str | None = None,
    title: str | None = None,
    description: str | None = None,
    logo_emblem: str | None = None,
    header_text_image: str | None = None,
    judge_name: str | None = None,
    archive_date: str | None = None,
    archive_date_hijri: str | None = None,
    archive_year_hijri: str | None = None,
    archive_month_hijri: str | None = None,
) -> dict:
    """يحفظ محفظة كمسودة (دون تعديل ملفات التنفيذ الحية)."""
    records = json.loads(items) if items else []
    return _save_batch(
        items=records,
        is_post=False,
        batch_name=batch_name,
        title=title,
        description=description,
        logo_emblem=logo_emblem,
        header_text_image=header_text_image,
        judge_name=judge_name,
        archive_date=archive_date,
        archive_date_hijri=archive_date_hijri,
        archive_year_hijri=archive_year_hijri,
        archive_month_hijri=archive_month_hijri,
    )


@frappe.whitelist()
def post_batch_archive(
    batch_name: str | None = None,
    items: str | None = None,
    title: str | None = None,
    description: str | None = None,
    logo_emblem: str | None = None,
    header_text_image: str | None = None,
    judge_name: str | None = None,
    archive_date: str | None = None,
    archive_date_hijri: str | None = None,
    archive_year_hijri: str | None = None,
    archive_month_hijri: str | None = None,
) -> dict:
    """يرحّل المحفظة نهائياً ويحدّث ملفات التنفيذ الحية."""
    records = json.loads(items) if items else []
    return _save_batch(
        items=records,
        is_post=True,
        batch_name=batch_name,
        title=title,
        description=description,
        logo_emblem=logo_emblem,
        header_text_image=header_text_image,
        judge_name=judge_name,
        archive_date=archive_date,
        archive_date_hijri=archive_date_hijri,
        archive_year_hijri=archive_year_hijri,
        archive_month_hijri=archive_month_hijri,
    )


@frappe.whitelist()
def get_posting_types() -> list[dict]:
    """يجلب كل أنواع الترحيل من قاعدة البيانات."""
    try:
        return frappe.get_all("Posting Type", fields=["posting_type"], order_by="posting_type")
    except Exception as e:
        frappe.log_error(
            message=frappe.get_traceback(),
            title="Get Posting Types Error",
        )
        return []


@frappe.whitelist()
def get_execution_files_for_print(
    month: str | None = None,
    year: str | None = None,
    posting_type: str | None = None,
) -> list[dict]:
    """
    يجلب ملفات التنفيذ المرحلة للطباعة الموحّدة.
    يُستخدم من زر 'طباعة الكل' في صفحة محرر الدفعات.
    """
    try:
        conditions: list[str] = ["status != %s"]
        values: list[str | None] = ["منظور"]

        if month:
            conditions.append("archive_month_hijri = %s")
            values.append(month)
        if year:
            conditions.append("archive_year_hijri = %s")
            values.append(year)
        if posting_type:
            conditions.append("posting_type = %s")
            values.append(posting_type)

        where_clause = " AND ".join(conditions)

        data = frappe.db.sql(
            f"""
            SELECT
                current_execution_assistant,
                reference,
                file_number,
                year,
                petitioner,
                respondent,
                judge,
                execution_assistant,
                status,
                posting_type,
                archive_month_hijri,
                archive_date,
                archive_year_hijri,
                remarks
            FROM `tabExecution File`
            WHERE {where_clause}
            ORDER BY current_execution_assistant, reference
            """,
            values,
            as_dict=1,
        )

        return data
    except Exception as e:
        frappe.log_error(
            message=frappe.get_traceback(),
            title="Get Execution Files For Print Error",
        )
        return []
