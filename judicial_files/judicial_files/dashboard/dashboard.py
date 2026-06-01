import frappe
from frappe import _
from datetime import date, timedelta


@frappe.whitelist()
def get_file_stats():
    """File statistics by type and status."""
    execution_status = frappe.db.get_all(
        "Execution File", fields=["status", "count(*) as count"], group_by="status"
    )
    dispute_status = frappe.db.get_all(
        "Dispute File", fields=["status", "count(*) as count"], group_by="status"
    )

    return {
        "execution_files": frappe.db.count("Execution File"),
        "dispute_files": frappe.db.count("Dispute File"),
        "execution_by_status": execution_status,
        "dispute_by_status": dispute_status,
    }


@frappe.whitelist()
def get_workload_stats():
    """Workload distribution by judge, assistant, and secretary."""
    by_judge_exec = frappe.db.sql(
        """
        SELECT judge, COUNT(*) as count
        FROM `tabExecution File`
        GROUP BY judge ORDER BY count DESC LIMIT 10
    """,
        as_dict=1,
    )

    by_judge_dispute = frappe.db.sql(
        """
        SELECT judge, COUNT(*) as count
        FROM `tabDispute File`
        GROUP BY judge ORDER BY count DESC LIMIT 10
    """,
        as_dict=1,
    )

    by_assistant = frappe.db.sql(
        """
        SELECT current_execution_assistant, COUNT(*) as count
        FROM `tabExecution File`
        WHERE current_execution_assistant IS NOT NULL
        GROUP BY current_execution_assistant ORDER BY count DESC
    """,
        as_dict=1,
    )

    by_secretary = frappe.db.sql(
        """
        SELECT current_secretary, COUNT(*) as count
        FROM `tabDispute File`
        WHERE current_secretary IS NOT NULL
        GROUP BY current_secretary ORDER BY count DESC
    """,
        as_dict=1,
    )

    return {
        "by_judge_execution": by_judge_exec,
        "by_judge_dispute": by_judge_dispute,
        "by_assistant": by_assistant,
        "by_secretary": by_secretary,
    }


@frappe.whitelist()
def get_timeline_stats():
    """Monthly new files and archives for the last 12 months."""
    twelve_months_ago = date.today() - timedelta(days=365)

    monthly_new_exec = frappe.db.sql(
        """
        SELECT DATE_FORMAT(creation, '%%Y-%%m') as month, COUNT(*) as count
        FROM `tabExecution File`
        WHERE creation >= %s
        GROUP BY month ORDER BY month
    """,
        twelve_months_ago,
        as_dict=1,
    )

    monthly_new_dispute = frappe.db.sql(
        """
        SELECT DATE_FORMAT(creation, '%%Y-%%m') as month, COUNT(*) as count
        FROM `tabDispute File`
        WHERE creation >= %s
        GROUP BY month ORDER BY month
    """,
        twelve_months_ago,
        as_dict=1,
    )

    monthly_archived = frappe.db.sql(
        """
        SELECT DATE_FORMAT(archive_date, '%%Y-%%m') as month, COUNT(*) as count
        FROM `tabExecution File`
        WHERE archive_date IS NOT NULL AND archive_date >= %s
        GROUP BY month ORDER BY month
    """,
        twelve_months_ago,
        as_dict=1,
    )

    monthly_archived_dispute = frappe.db.sql(
        """
        SELECT DATE_FORMAT(archive_date, '%%Y-%%m') as month, COUNT(*) as count
        FROM `tabDispute File`
        WHERE archive_date IS NOT NULL AND archive_date >= %s
        GROUP BY month ORDER BY month
    """,
        twelve_months_ago,
        as_dict=1,
    )

    return {
        "monthly_new_execution": monthly_new_exec,
        "monthly_new_dispute": monthly_new_dispute,
        "monthly_archived_execution": monthly_archived,
        "monthly_archived_dispute": monthly_archived_dispute,
    }


@frappe.whitelist()
def get_mail_stats():
    """Mail status distribution."""
    return frappe.db.sql(
        """
        SELECT mail_status, COUNT(*) as count
        FROM `tabMail Data`
        GROUP BY mail_status ORDER BY count DESC
    """,
        as_dict=1,
    )


@frappe.whitelist()
def get_batch_stats():
    """Batch statistics (mail and archive)."""
    mail_batches = frappe.db.get_all(
        "Judicial Mail Batch", fields=["status", "count(*) as count"], group_by="status"
    )
    archive_batches = frappe.db.get_all(
        "Judicial Archive Batch",
        fields=["status", "count(*) as count"],
        group_by="status",
    )
    return {
        "mail_batches": mail_batches,
        "archive_batches": archive_batches,
    }


@frappe.whitelist()
def get_hearing_stats():
    """Upcoming and overdue hearings."""
    today = date.today()
    next_week = today + timedelta(days=7)

    upcoming = frappe.db.get_all(
        "Judicial Hearing",
        fields=["parent", "hearing_date", "next_hearing_date"],
        filters={"hearing_date": ["between", [today, next_week]]},
        limit=20,
    )

    overdue = frappe.db.get_all(
        "Judicial Hearing",
        fields=["parent", "next_hearing_date"],
        filters={"next_hearing_date": ["<", today]},
        limit=10,
    )

    return {
        "upcoming_hearings": upcoming,
        "overdue_hearings": overdue,
    }


@frappe.whitelist()
def get_all_dashboard_data():
    """Unified endpoint returning all statistics at once."""
    return {
        "file_stats": get_file_stats(),
        "workload": get_workload_stats(),
        "timeline": get_timeline_stats(),
        "mail_stats": get_mail_stats(),
        "batch_stats": get_batch_stats(),
        "hearing_stats": get_hearing_stats(),
    }
