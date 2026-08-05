export const STATUS_LABELS = {
    todo: 'לביצוע',
    'in-progress': 'בתהליך',
    done: 'הושלם'
};

export function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

export function truncate(value, maxLength = 100) {
    const text = String(value ?? '').trim();
    return text.length > maxLength ? `${text.slice(0, maxLength).trim()}…` : text;
}

export function formatDate(dateValue, fallback = 'ללא תאריך') {
    if (!dateValue) return fallback;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(dateValue))
        ? new Date(`${dateValue}T00:00:00`)
        : new Date(dateValue);
    return Number.isNaN(date.getTime()) ? fallback : date.toLocaleDateString('he-IL');
}

export function formatDateTime(dateValue, fallback = '') {
    if (!dateValue) return fallback;
    const date = new Date(dateValue);
    return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString('he-IL');
}

export function firestoreDateToDate(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function sortTasks(tasks) {
    const statusOrder = { todo: 0, 'in-progress': 1, done: 2 };
    return [...tasks].sort((a, b) => {
        const statusDiff = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
        if (statusDiff !== 0) return statusDiff;

        if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        if (a.dueDate) return -1;
        if (b.dueDate) return 1;

        const dateA = firestoreDateToDate(a.createdAt)?.getTime() ?? 0;
        const dateB = firestoreDateToDate(b.createdAt)?.getTime() ?? 0;
        return dateB - dateA;
    });
}

export function isOverdue(task) {
    if (!task?.dueDate || task.status === 'done') return false;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const dueDate = new Date(`${task.dueDate}T00:00:00`);
    return dueDate < startOfToday;
}

export function latestProgressText(notes) {
    const text = String(notes ?? '').trim();
    if (!text) return '';
    const chunks = text.split(/\n\n(?=\[)/).filter(Boolean);
    return chunks.at(-1)?.trim() ?? text;
}
