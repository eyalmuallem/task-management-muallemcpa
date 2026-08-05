import {
    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut,
    updatePassword
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import {
    collection,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    getDocs,
    getDoc,
    onSnapshot,
    setDoc,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

import { auth, db, createEmployeeAuthAccount } from './firebase.js';
import {
    STATUS_LABELS,
    escapeHtml,
    truncate,
    formatDate,
    formatDateTime,
    firestoreDateToDate,
    sortTasks,
    isOverdue,
    latestProgressText
} from './utils.js';

const state = {
    currentUser: null,
    currentUserData: null,
    allUsers: [],
    allTasks: [],
    selectedEmployeeId: null,
    pendingAssignedEmployeeId: null,
    adminCalendarDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    employeeCalendarDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    unsubscribeTasks: null,
    unsubscribeUsers: null
};

const elements = {};
let toastTimer = null;

function cacheElements() {
    const ids = [
        'loadingScreen', 'loginScreen', 'mainApp', 'loginForm', 'loginError', 'email', 'password',
        'currentUserDisplay', 'adminView', 'employeeView', 'adminSummary', 'employeeSummary',
        'todoCount', 'inProgressCount', 'doneCount', 'todoTasks', 'inProgressTasks', 'doneTasks',
        'employeeTaskDirectory', 'employeeDirectoryView', 'employeeDetailView', 'employeeDetailTitle',
        'employeeDetailSubtitle', 'assignTaskToSelectedEmployee', 'empTodoCount', 'empInProgressCount',
        'empDoneCount', 'empTodoTasks', 'empInProgressTasks', 'empDoneTasks', 'employeesList',
        'allTasksList', 'taskSearchInput', 'taskStatusFilter', 'myTodoCount', 'myInProgressCount',
        'myDoneCount', 'myTodoTasks', 'myInProgressTasks', 'myDoneTasks', 'addEmployeeForm',
        'employeeName', 'employeeEmail', 'employeePassword', 'editEmployeeForm', 'editEmployeeId',
        'editEmployeeName', 'editEmployeeEmail', 'editEmployeeRole', 'editProfileForm', 'editProfileName',
        'editProfileEmail', 'editProfilePassword', 'addTaskForm', 'addTaskModalTitle', 'taskClientName',
        'taskTitle', 'taskDescription', 'taskDueDate', 'assignToGroup', 'assignToEmployee', 'editTaskForm',
        'editTaskId', 'editTaskClientName', 'editTaskTitle', 'editTaskDescription', 'editTaskStatus',
        'editTaskDueDate', 'editTaskNotes', 'progressNoteGroup', 'progressNotesClient', 'progressNotesTitle',
        'progressNotesContent', 'addCommentForm', 'commentTaskId', 'commentText',
        'adminCalendarFilter', 'adminCalendarEmployeeGroup', 'adminCalendarEmployee',
        'adminCalendarTitle', 'adminCalendarGrid', 'employeeCalendarTitle', 'employeeCalendarGrid',
        'taskRecurrenceGroup', 'taskRecurrence', 'editTaskRecurrenceGroup', 'editTaskRecurrence',
        'calendarDayTitle', 'calendarDayTasks', 'toast'
    ];

    ids.forEach((id) => {
        elements[id] = document.getElementById(id);
    });
}

function init() {
    cacheElements();
    bindStaticEvents();

    onAuthStateChanged(auth, async (user) => {
        cleanupSubscriptions();
        if (!user) {
            state.currentUser = null;
            state.currentUserData = null;
            showLoginScreen();
            return;
        }

        state.currentUser = user;
        try {
            await loadCurrentUserData();
            subscribeToData();
            showMainApp();
        } catch (error) {
            console.error('Failed to initialize authenticated user:', error);
            showToast('שגיאה בטעינת נתוני המשתמש', true);
            await signOut(auth);
        }
    });
}

function bindStaticEvents() {
    elements.loginForm.addEventListener('submit', handleLogin);
    elements.addEmployeeForm.addEventListener('submit', handleAddEmployee);
    elements.editEmployeeForm.addEventListener('submit', handleEditEmployee);
    elements.editProfileForm.addEventListener('submit', handleEditProfile);
    elements.addTaskForm.addEventListener('submit', handleAddTask);
    elements.editTaskForm.addEventListener('submit', handleEditTask);
    elements.addCommentForm.addEventListener('submit', handleAddComment);
    elements.taskSearchInput.addEventListener('input', renderAllTasks);
    elements.taskStatusFilter.addEventListener('change', renderAllTasks);
    elements.adminCalendarFilter.addEventListener('change', () => {
        updateAdminCalendarEmployeeVisibility();
        renderAdminCalendar();
    });
    elements.adminCalendarEmployee.addEventListener('change', renderAdminCalendar);

    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeTopModal();
    });

    document.querySelectorAll('.modal').forEach((modal) => {
        modal.addEventListener('click', (event) => {
            if (event.target === modal) closeModal(modal.id);
        });
    });

    elements.assignTaskToSelectedEmployee.addEventListener('click', () => {
        const employee = getUserById(state.selectedEmployeeId);
        if (employee) openAddTaskModal(employee.id, employee.name);
    });
}

async function loadCurrentUserData() {
    const userRef = doc(db, 'users', state.currentUser.uid);
    const userSnapshot = await getDoc(userRef);

    if (userSnapshot.exists()) {
        state.currentUserData = { id: state.currentUser.uid, ...userSnapshot.data() };
        return;
    }

    const usersSnapshot = await getDocs(collection(db, 'users'));
    const isFirstUser = usersSnapshot.empty;
    const isAdmin = isFirstUser || state.currentUser.email === 'admin@moalem.co.il';
    const userData = {
        email: state.currentUser.email,
        name: state.currentUser.email?.split('@')[0] || 'משתמש',
        role: isAdmin ? 'admin' : 'employee',
        createdAt: new Date().toISOString()
    };

    await setDoc(userRef, userData);
    state.currentUserData = { id: state.currentUser.uid, ...userData };
}

function subscribeToData() {
    state.unsubscribeUsers = onSnapshot(
        collection(db, 'users'),
        (snapshot) => {
            state.allUsers = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
            renderEverything();
        },
        (error) => {
            console.error('Users subscription failed:', error);
            showToast('לא ניתן לטעון את רשימת העובדים', true);
        }
    );

    state.unsubscribeTasks = onSnapshot(
        collection(db, 'tasks'),
        (snapshot) => {
            state.allTasks = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
            renderEverything();
        },
        (error) => {
            console.error('Tasks subscription failed:', error);
            showToast('לא ניתן לטעון את המשימות', true);
        }
    );
}

function cleanupSubscriptions() {
    if (state.unsubscribeTasks) state.unsubscribeTasks();
    if (state.unsubscribeUsers) state.unsubscribeUsers();
    state.unsubscribeTasks = null;
    state.unsubscribeUsers = null;
}

function showLoginScreen() {
    elements.loadingScreen.classList.add('hidden');
    elements.mainApp.classList.add('hidden');
    elements.loginScreen.classList.remove('hidden');
    elements.loginForm.reset();
}

function showMainApp() {
    elements.loadingScreen.classList.add('hidden');
    elements.loginScreen.classList.add('hidden');
    elements.mainApp.classList.remove('hidden');
    elements.currentUserDisplay.textContent = `${state.currentUserData.name} · ${state.currentUserData.role === 'admin' ? 'מנהל' : 'עובד'}`;

    const isAdmin = state.currentUserData.role === 'admin';
    elements.adminView.classList.toggle('hidden', !isAdmin);
    elements.employeeView.classList.toggle('hidden', isAdmin);
    renderEverything();
}

function renderEverything() {
    if (!state.currentUserData) return;
    if (state.currentUserData.role === 'admin') {
        renderAdminSummary();
        renderTaskBoard();
        renderEmployeeTaskDirectory();
        renderEmployeesManagement();
        renderAllTasks();
        populateAdminCalendarEmployees();
        renderAdminCalendar();
        if (state.selectedEmployeeId) renderSelectedEmployeeDetail();
    } else {
        renderEmployeeBoard();
        renderEmployeeCalendar();
    }
}

function renderAdminSummary() {
    const todo = state.allTasks.filter((task) => task.status === 'todo').length;
    const inProgress = state.allTasks.filter((task) => task.status === 'in-progress').length;
    const overdue = state.allTasks.filter(isOverdue).length;
    const employees = state.allUsers.filter((user) => user.role === 'employee').length;
    elements.adminSummary.innerHTML = summaryCards([
        ['משימות לביצוע', todo],
        ['משימות בתהליך', inProgress],
        ['משימות באיחור', overdue],
        ['עובדים פעילים', employees]
    ]);
}

function renderEmployeeSummary() {
    const myTasks = state.allTasks.filter((task) => task.assignedTo === state.currentUser.uid);
    elements.employeeSummary.innerHTML = summaryCards([
        ['לביצוע', myTasks.filter((task) => task.status === 'todo').length],
        ['בתהליך', myTasks.filter((task) => task.status === 'in-progress').length],
        ['הושלמו', myTasks.filter((task) => task.status === 'done').length],
        ['באיחור', myTasks.filter(isOverdue).length]
    ]);
}

function summaryCards(items) {
    return items.map(([label, value]) => `
        <div class="summary-card">
            <span class="summary-card-value">${escapeHtml(value)}</span>
            <span class="summary-card-label">${escapeHtml(label)}</span>
        </div>
    `).join('');
}


const RECURRENCE_LABELS = {
    none: 'לא חזרתית',
    monthly: 'חוזרת כל חודש',
    bimonthly: 'חוזרת כל חודשיים'
};

function normalizeRecurrence(value) {
    return ['monthly', 'bimonthly'].includes(value) ? value : 'none';
}

function isRecurringTask(task) {
    return normalizeRecurrence(task?.recurrenceType) !== 'none';
}

function recurrenceLabel(task) {
    return RECURRENCE_LABELS[normalizeRecurrence(task?.recurrenceType)];
}

function recurrenceBadge(task) {
    return isRecurringTask(task)
        ? `<span class="badge badge-recurrence">${escapeHtml(recurrenceLabel(task))}</span>`
        : '';
}

function parseDateOnly(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
    const [year, month, day] = String(value).split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
}

function toDateOnlyString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, amount) {
    const result = new Date(date);
    result.setDate(result.getDate() + amount);
    return result;
}

function addMonthsClamped(dateValue, amount, preferredDay = null) {
    const source = typeof dateValue === 'string' ? parseDateOnly(dateValue) : new Date(dateValue);
    if (!source || Number.isNaN(source.getTime())) return '';
    const targetMonthStart = new Date(source.getFullYear(), source.getMonth() + amount, 1);
    const lastDay = new Date(targetMonthStart.getFullYear(), targetMonthStart.getMonth() + 1, 0).getDate();
    const desiredDay = Number(preferredDay) || source.getDate();
    targetMonthStart.setDate(Math.min(desiredDay, lastDay));
    return toDateOnlyString(targetMonthStart);
}

function monthIntervalForTask(task) {
    return normalizeRecurrence(task?.recurrenceType) === 'bimonthly' ? 2 : 1;
}

function calendarRangeForMonth(monthDate) {
    const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const last = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
    const start = addDays(first, -first.getDay());
    const end = addDays(last, 6 - last.getDay());
    return { first, last, start, end };
}

function getCalendarUrgency(dateString, completed = false) {
    if (completed) return 'completed';
    const date = parseDateOnly(dateString);
    if (!date) return 'future';
    const today = startOfDay(new Date());
    const diffDays = Math.round((startOfDay(date) - today) / 86400000);
    if (diffDays <= 0) return 'due';
    if (diffDays === 1) return 'tomorrow';
    return 'future';
}

function getTaskOccurrences(task, rangeStart, rangeEnd) {
    if (!task?.dueDate) return [];
    const rangeStartIso = toDateOnlyString(rangeStart);
    const rangeEndIso = toDateOnlyString(rangeEnd);
    const occurrences = new Map();
    const completedDates = Array.isArray(task.completedOccurrences)
        ? task.completedOccurrences.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value)))
        : [];

    completedDates.forEach((date) => {
        if (date >= rangeStartIso && date <= rangeEndIso) {
            occurrences.set(date, { task, date, completed: true });
        }
    });

    if (!isRecurringTask(task)) {
        if (task.dueDate >= rangeStartIso && task.dueDate <= rangeEndIso) {
            occurrences.set(task.dueDate, { task, date: task.dueDate, completed: task.status === 'done' });
        }
        return [...occurrences.values()];
    }

    const interval = monthIntervalForTask(task);
    let current = task.dueDate;
    let guard = 0;
    while (current && current < rangeStartIso && guard < 600) {
        current = addMonthsClamped(current, interval, task.recurrenceDay);
        guard += 1;
    }
    while (current && current <= rangeEndIso && guard < 720) {
        if (!occurrences.has(current)) occurrences.set(current, { task, date: current, completed: false });
        current = addMonthsClamped(current, interval, task.recurrenceDay);
        guard += 1;
    }
    return [...occurrences.values()];
}

function buildCalendarOccurrences(tasks, monthDate) {
    const range = calendarRangeForMonth(monthDate);
    return tasks
        .flatMap((task) => getTaskOccurrences(task, range.start, range.end))
        .sort((a, b) => {
            const dateDiff = a.date.localeCompare(b.date);
            if (dateDiff !== 0) return dateDiff;
            return String(a.task.title || '').localeCompare(String(b.task.title || ''), 'he');
        });
}

function populateAdminCalendarEmployees() {
    const employees = state.allUsers
        .filter((user) => user.role === 'employee')
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'he'));
    const previousValue = elements.adminCalendarEmployee.value;
    elements.adminCalendarEmployee.innerHTML = employees.length
        ? employees.map((employee) => `<option value="${escapeHtml(employee.id)}">${escapeHtml(employee.name || 'עובד ללא שם')}</option>`).join('')
        : '<option value="">אין עובדים</option>';
    if (employees.some((employee) => employee.id === previousValue)) {
        elements.adminCalendarEmployee.value = previousValue;
    }
    updateAdminCalendarEmployeeVisibility();
}

function updateAdminCalendarEmployeeVisibility() {
    const showEmployee = elements.adminCalendarFilter.value === 'employee';
    elements.adminCalendarEmployeeGroup.classList.toggle('hidden', !showEmployee);
}

function getAdminCalendarTasks() {
    const employeeIds = new Set(state.allUsers.filter((user) => user.role === 'employee').map((user) => user.id));
    const filter = elements.adminCalendarFilter.value;
    if (filter === 'all-employees') {
        return state.allTasks.filter((task) => employeeIds.has(task.assignedTo));
    }
    if (filter === 'employee') {
        return state.allTasks.filter((task) => task.assignedTo === elements.adminCalendarEmployee.value);
    }
    return state.allTasks.filter((task) => employeeIds.has(task.assignedTo) && task.createdBy === state.currentUser.uid);
}

function renderAdminCalendar() {
    if (!elements.adminCalendarGrid || state.currentUserData?.role !== 'admin') return;
    renderCalendar({
        monthDate: state.adminCalendarDate,
        tasks: getAdminCalendarTasks(),
        grid: elements.adminCalendarGrid,
        title: elements.adminCalendarTitle,
        target: 'admin',
        showEmployee: true
    });
}

function renderEmployeeCalendar() {
    if (!elements.employeeCalendarGrid || state.currentUserData?.role === 'admin') return;
    const tasks = state.allTasks.filter((task) => task.assignedTo === state.currentUser.uid);
    renderCalendar({
        monthDate: state.employeeCalendarDate,
        tasks,
        grid: elements.employeeCalendarGrid,
        title: elements.employeeCalendarTitle,
        target: 'employee',
        showEmployee: false
    });
}

function renderCalendar({ monthDate, tasks, grid, title, target, showEmployee }) {
    const range = calendarRangeForMonth(monthDate);
    const occurrences = buildCalendarOccurrences(tasks, monthDate);
    const byDate = new Map();
    occurrences.forEach((occurrence) => {
        const list = byDate.get(occurrence.date) || [];
        list.push(occurrence);
        byDate.set(occurrence.date, list);
    });

    title.textContent = monthDate.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
    const todayIso = toDateOnlyString(new Date());
    const cells = [];
    for (let cursor = new Date(range.start); cursor <= range.end; cursor = addDays(cursor, 1)) {
        const dateString = toDateOnlyString(cursor);
        const dayOccurrences = byDate.get(dateString) || [];
        const visible = dayOccurrences.slice(0, 3);
        const outside = cursor.getMonth() !== monthDate.getMonth();
        cells.push(`
            <div class="calendar-day${outside ? ' outside-month' : ''}${dateString === todayIso ? ' today' : ''}">
                <div class="calendar-day-header">
                    <span class="calendar-day-number">${cursor.getDate()}</span>
                    ${dateString === todayIso ? '<span class="calendar-today-label">היום</span>' : ''}
                </div>
                <div class="calendar-events">
                    ${visible.map((occurrence) => renderCalendarEvent(occurrence, showEmployee)).join('')}
                    ${dayOccurrences.length > 3 ? `<button type="button" class="calendar-more" data-action="open-calendar-day" data-calendar-target="${target}" data-date="${dateString}">עוד ${dayOccurrences.length - 3} משימות</button>` : ''}
                </div>
            </div>
        `);
    }
    grid.innerHTML = cells.join('');
}

function renderCalendarEvent(occurrence, showEmployee) {
    const { task, date, completed } = occurrence;
    const urgency = getCalendarUrgency(date, completed);
    const employee = getUserById(task.assignedTo);
    const sourceText = task.createdBy === task.assignedTo ? 'משימה אישית' : 'משימה שהוקצתה';
    const secondary = showEmployee
        ? employee?.name || 'עובד לא ידוע'
        : sourceText;
    return `
        <button type="button" class="calendar-event urgency-${urgency}" data-action="calendar-open-task" data-task-id="${escapeHtml(task.id)}" data-occurrence-date="${escapeHtml(date)}" title="${escapeHtml(task.clientName || 'ללא לקוח')} — ${escapeHtml(task.title || 'משימה ללא כותרת')}">
            <span class="calendar-event-title">${escapeHtml(truncate(task.title || 'משימה ללא כותרת', 34))}</span>
            <span class="calendar-event-meta">${escapeHtml(secondary)}${isRecurringTask(task) ? ` · ${escapeHtml(recurrenceLabel(task))}` : ''}</span>
        </button>
    `;
}

function changeCalendarMonth(target, offset) {
    const key = target === 'admin' ? 'adminCalendarDate' : 'employeeCalendarDate';
    const current = state[key];
    state[key] = new Date(current.getFullYear(), current.getMonth() + offset, 1);
    target === 'admin' ? renderAdminCalendar() : renderEmployeeCalendar();
}

function resetCalendarMonth(target) {
    const now = new Date();
    const value = new Date(now.getFullYear(), now.getMonth(), 1);
    if (target === 'admin') {
        state.adminCalendarDate = value;
        renderAdminCalendar();
    } else {
        state.employeeCalendarDate = value;
        renderEmployeeCalendar();
    }
}

function getCalendarTasksForTarget(target) {
    return target === 'admin'
        ? getAdminCalendarTasks()
        : state.allTasks.filter((task) => task.assignedTo === state.currentUser.uid);
}

function openCalendarDayModal(dateString, target) {
    const monthDate = parseDateOnly(dateString) || new Date();
    const occurrences = buildCalendarOccurrences(getCalendarTasksForTarget(target), monthDate)
        .filter((occurrence) => occurrence.date === dateString);
    elements.calendarDayTitle.textContent = formatDate(dateString, dateString);
    elements.calendarDayTasks.innerHTML = occurrences.length
        ? occurrences.map((occurrence) => {
            const employee = getUserById(occurrence.task.assignedTo);
            const urgency = getCalendarUrgency(occurrence.date, occurrence.completed);
            return `
                <article class="calendar-day-task urgency-border-${urgency}">
                    <div class="task-client">${escapeHtml(occurrence.task.clientName || 'ללא לקוח')}</div>
                    <div class="task-title">${escapeHtml(occurrence.task.title || 'משימה ללא כותרת')}</div>
                    <div class="task-meta">
                        ${employee ? `<span class="task-meta-item">${escapeHtml(employee.name)}</span>` : ''}
                        <span class="task-meta-item">${escapeHtml(formatDate(occurrence.date))}</span>
                        ${recurrenceBadge(occurrence.task)}
                        ${occurrence.completed ? '<span class="badge badge-done">הושלם</span>' : ''}
                    </div>
                    ${occurrence.task.description ? `<p class="task-description">${escapeHtml(truncate(occurrence.task.description, 160))}</p>` : ''}
                    <div class="task-actions">
                        <button type="button" class="btn btn-secondary btn-sm" data-action="calendar-open-task" data-task-id="${escapeHtml(occurrence.task.id)}">פתח משימה</button>
                    </div>
                </article>
            `;
        }).join('')
        : '<div class="empty-state">אין משימות ביום זה</div>';
    openModal('calendarDayModal');
}

function renderTaskBoard() {
    const groups = groupTasksByStatus(state.allTasks);
    elements.todoCount.textContent = groups.todo.length;
    elements.inProgressCount.textContent = groups['in-progress'].length;
    elements.doneCount.textContent = groups.done.length;
    renderTaskList(elements.todoTasks, groups.todo, renderCompactTaskCard);
    renderTaskList(elements.inProgressTasks, groups['in-progress'], renderCompactTaskCard);
    renderTaskList(elements.doneTasks, groups.done, renderCompactTaskCard);
}

function renderEmployeeBoard() {
    const myTasks = state.allTasks.filter((task) => task.assignedTo === state.currentUser.uid);
    const groups = groupTasksByStatus(myTasks);
    elements.myTodoCount.textContent = groups.todo.length;
    elements.myInProgressCount.textContent = groups['in-progress'].length;
    elements.myDoneCount.textContent = groups.done.length;
    renderTaskList(elements.myTodoTasks, groups.todo, (task) => renderEmployeeTaskCard(task));
    renderTaskList(elements.myInProgressTasks, groups['in-progress'], (task) => renderEmployeeTaskCard(task));
    renderTaskList(elements.myDoneTasks, groups.done, (task) => renderEmployeeTaskCard(task));
    renderEmployeeSummary();
}

function groupTasksByStatus(tasks) {
    const sorted = sortTasks(tasks);
    return {
        todo: sorted.filter((task) => task.status === 'todo'),
        'in-progress': sorted.filter((task) => task.status === 'in-progress'),
        done: sorted.filter((task) => task.status === 'done')
    };
}

function renderTaskList(container, tasks, renderer) {
    container.innerHTML = tasks.length
        ? tasks.map(renderer).join('')
        : '<div class="empty-state">אין משימות בסטטוס זה</div>';
}

function renderCompactTaskCard(task) {
    const assignedUser = getUserById(task.assignedTo);
    const overdueText = isOverdue(task) ? ' · באיחור' : '';
    return `
        <article class="task-card clickable" data-action="edit-task" data-task-id="${escapeHtml(task.id)}">
            <div class="task-client">${escapeHtml(task.clientName || 'ללא לקוח')}</div>
            <div class="task-title">${escapeHtml(task.title || 'משימה ללא כותרת')}</div>
            <div class="task-meta">
                ${assignedUser ? `<span class="task-meta-item">${escapeHtml(assignedUser.name)}</span>` : ''}
                <span class="task-meta-item">יעד: ${escapeHtml(formatDate(task.dueDate))}${escapeHtml(overdueText)}</span>
                ${recurrenceBadge(task)}
            </div>
            ${task.description ? `<p class="task-description">${escapeHtml(truncate(task.description, 105))}</p>` : ''}
        </article>
    `;
}

function renderEmployeeTaskCard(task) {
    const canComplete = task.status !== 'done';
    const hasNotes = Boolean(String(task.notes || '').trim());
    const hasComments = Array.isArray(task.comments) && task.comments.length > 0;
    return `
        <article class="task-card">
            <div class="task-client">${escapeHtml(task.clientName || 'ללא לקוח')}</div>
            <div class="task-title">${escapeHtml(task.title || 'משימה ללא כותרת')}</div>
            <div class="task-meta">
                <span class="task-meta-item">יעד: ${escapeHtml(formatDate(task.dueDate))}</span>
                ${recurrenceBadge(task)}
                ${isOverdue(task) ? '<span class="badge badge-todo">באיחור</span>' : ''}
            </div>
            ${task.description ? `<p class="task-description">${escapeHtml(truncate(task.description, 120))}</p>` : ''}
            ${hasComments ? `<div class="progress-preview"><div class="progress-preview-title">הערת מנהל אחרונה</div><div class="progress-text">${escapeHtml(truncate(task.comments.at(-1)?.text, 120))}</div></div>` : ''}
            <div class="task-actions">
                ${canComplete ? `<button type="button" class="btn btn-primary btn-sm" data-action="complete-task" data-task-id="${escapeHtml(task.id)}">סיום משימה</button>` : ''}
                <button type="button" class="btn btn-secondary btn-sm" data-action="edit-task" data-task-id="${escapeHtml(task.id)}">ערוך ועדכן</button>
                ${hasNotes ? `<button type="button" class="btn btn-ghost btn-sm" data-action="view-progress" data-task-id="${escapeHtml(task.id)}">היסטוריית התקדמות</button>` : ''}
            </div>
        </article>
    `;
}

function renderEmployeeTaskDirectory() {
    const employees = state.allUsers.filter((user) => user.role === 'employee');
    if (!employees.length) {
        elements.employeeTaskDirectory.innerHTML = '<div class="empty-state">אין עובדים במערכת</div>';
        return;
    }

    elements.employeeTaskDirectory.innerHTML = employees
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'he'))
        .map((employee) => {
            const tasks = state.allTasks.filter((task) => task.assignedTo === employee.id);
            return `
                <article class="employee-overview-card" data-action="open-employee-detail" data-employee-id="${escapeHtml(employee.id)}">
                    <div class="employee-card-header">
                        <div>
                            <div class="employee-name">${escapeHtml(employee.name || 'עובד ללא שם')}</div>
                            <div class="employee-email">${escapeHtml(employee.email || '')}</div>
                        </div>
                        <span class="badge badge-muted">${tasks.length} משימות</span>
                    </div>
                    <div class="employee-stats">
                        <div class="employee-stat"><strong>${tasks.filter((task) => task.status === 'todo').length}</strong><span>לביצוע</span></div>
                        <div class="employee-stat"><strong>${tasks.filter((task) => task.status === 'in-progress').length}</strong><span>בתהליך</span></div>
                        <div class="employee-stat"><strong>${tasks.filter((task) => task.status === 'done').length}</strong><span>הושלם</span></div>
                    </div>
                </article>
            `;
        }).join('');
}

function openEmployeeDetail(employeeId) {
    state.selectedEmployeeId = employeeId;
    elements.employeeDirectoryView.classList.add('hidden');
    elements.employeeDetailView.classList.remove('hidden');
    renderSelectedEmployeeDetail();
}

function closeEmployeeDetail() {
    state.selectedEmployeeId = null;
    elements.employeeDetailView.classList.add('hidden');
    elements.employeeDirectoryView.classList.remove('hidden');
}

function renderSelectedEmployeeDetail() {
    const employee = getUserById(state.selectedEmployeeId);
    if (!employee) {
        closeEmployeeDetail();
        return;
    }

    const tasks = state.allTasks.filter((task) => task.assignedTo === employee.id);
    const groups = groupTasksByStatus(tasks);
    elements.employeeDetailTitle.textContent = `המשימות של ${employee.name}`;
    elements.employeeDetailSubtitle.textContent = `${tasks.length} משימות במערכת`;
    elements.empTodoCount.textContent = groups.todo.length;
    elements.empInProgressCount.textContent = groups['in-progress'].length;
    elements.empDoneCount.textContent = groups.done.length;
    renderTaskList(elements.empTodoTasks, groups.todo, renderManagerEmployeeTaskCard);
    renderTaskList(elements.empInProgressTasks, groups['in-progress'], renderManagerEmployeeTaskCard);
    renderTaskList(elements.empDoneTasks, groups.done, renderManagerEmployeeTaskCard);
}

function renderManagerEmployeeTaskCard(task) {
    const latestProgress = latestProgressText(task.notes);
    return `
        <article class="task-card">
            <div class="task-client">${escapeHtml(task.clientName || 'ללא לקוח')}</div>
            <div class="task-title">${escapeHtml(task.title || 'משימה ללא כותרת')}</div>
            <div class="task-meta">
                <span class="task-meta-item">יעד: ${escapeHtml(formatDate(task.dueDate))}</span>
                ${recurrenceBadge(task)}
                ${isOverdue(task) ? '<span class="badge badge-todo">באיחור</span>' : ''}
            </div>
            ${task.description ? `<p class="task-description">${escapeHtml(truncate(task.description, 115))}</p>` : ''}
            ${latestProgress ? `<div class="progress-preview"><div class="progress-preview-title">עדכון אחרון</div><div class="progress-text">${escapeHtml(truncate(latestProgress, 145))}</div></div>` : ''}
            <div class="task-actions">
                <button type="button" class="btn btn-primary btn-sm" data-action="view-progress" data-task-id="${escapeHtml(task.id)}">צפה בהערות התקדמות</button>
                <button type="button" class="btn btn-secondary btn-sm" data-action="comment-task" data-task-id="${escapeHtml(task.id)}">הוסף הערת מנהל</button>
                <button type="button" class="btn btn-ghost btn-sm" data-action="edit-task" data-task-id="${escapeHtml(task.id)}">ערוך משימה</button>
            </div>
        </article>
    `;
}

function renderEmployeesManagement() {
    const employees = state.allUsers.filter((user) => user.id !== state.currentUser.uid);
    if (!employees.length) {
        elements.employeesList.innerHTML = '<div class="empty-state">אין עובדים נוספים במערכת</div>';
        return;
    }

    elements.employeesList.innerHTML = employees
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'he'))
        .map((employee) => {
            const tasks = state.allTasks.filter((task) => task.assignedTo === employee.id);
            return `
                <article class="employee-card">
                    <div class="employee-card-header">
                        <div>
                            <div class="employee-name">${escapeHtml(employee.name || 'משתמש ללא שם')}</div>
                            <div class="employee-email">${escapeHtml(employee.email || '')}</div>
                        </div>
                        <span class="badge ${employee.role === 'admin' ? 'badge-done' : 'badge-muted'}">${employee.role === 'admin' ? 'מנהל' : 'עובד'}</span>
                    </div>
                    <div class="employee-stats">
                        <div class="employee-stat"><strong>${tasks.filter((task) => task.status === 'todo').length}</strong><span>לביצוע</span></div>
                        <div class="employee-stat"><strong>${tasks.filter((task) => task.status === 'in-progress').length}</strong><span>בתהליך</span></div>
                        <div class="employee-stat"><strong>${tasks.filter((task) => task.status === 'done').length}</strong><span>הושלם</span></div>
                    </div>
                    <div class="employee-actions">
                        ${employee.role === 'employee' ? `<button type="button" class="btn btn-primary btn-sm" data-action="open-employee-detail" data-employee-id="${escapeHtml(employee.id)}">צפה במשימות</button>` : ''}
                        ${employee.role === 'employee' ? `<button type="button" class="btn btn-secondary btn-sm" data-action="assign-task" data-employee-id="${escapeHtml(employee.id)}">הקצה משימה</button>` : ''}
                        <button type="button" class="btn btn-ghost btn-sm" data-action="edit-employee" data-employee-id="${escapeHtml(employee.id)}">ערוך</button>
                        <button type="button" class="btn btn-danger btn-sm" data-action="delete-employee" data-employee-id="${escapeHtml(employee.id)}">הסר</button>
                    </div>
                </article>
            `;
        }).join('');
}

function renderAllTasks() {
    if (!elements.taskSearchInput) return;
    const search = elements.taskSearchInput.value.trim().toLowerCase();
    const status = elements.taskStatusFilter.value;

    const tasks = sortTasks(state.allTasks).filter((task) => {
        if (status !== 'all' && task.status !== status) return false;
        if (!search) return true;
        const employee = getUserById(task.assignedTo);
        return [task.clientName, task.title, task.description, employee?.name]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(search));
    });

    elements.allTasksList.innerHTML = tasks.length
        ? tasks.map(renderDetailedTaskCard).join('')
        : '<div class="empty-state">לא נמצאו משימות התואמות לסינון</div>';
}

function renderDetailedTaskCard(task) {
    const assignedUser = getUserById(task.assignedTo);
    const createdAt = firestoreDateToDate(task.createdAt);
    const comments = Array.isArray(task.comments) ? task.comments : [];
    return `
        <article class="detailed-task-card">
            <div class="task-card-header">
                <div>
                    <div class="task-client">${escapeHtml(task.clientName || 'ללא לקוח')}</div>
                    <div class="task-title">${escapeHtml(task.title || 'משימה ללא כותרת')}</div>
                </div>
                <span class="badge badge-${escapeHtml(task.status || 'todo')}">${escapeHtml(STATUS_LABELS[task.status] || 'לא ידוע')}</span>
            </div>
            <div class="task-meta">
                ${assignedUser ? `<span class="task-meta-item">עובד: ${escapeHtml(assignedUser.name)}</span>` : ''}
                <span class="task-meta-item">יעד: ${escapeHtml(formatDate(task.dueDate, 'לא הוגדר'))}</span>
                ${recurrenceBadge(task)}
                ${createdAt ? `<span class="task-meta-item">נוצר: ${escapeHtml(createdAt.toLocaleDateString('he-IL'))}</span>` : ''}
                ${isOverdue(task) ? '<span class="badge badge-todo">באיחור</span>' : ''}
            </div>
            ${task.description ? `<p class="task-description">${escapeHtml(task.description)}</p>` : ''}
            ${task.notes ? `<div class="progress-preview"><div class="progress-preview-title">עדכון התקדמות אחרון</div><div class="progress-text">${escapeHtml(latestProgressText(task.notes))}</div></div>` : ''}
            ${comments.length ? `
                <div class="comment-section">
                    <div class="comment-section-title">הערות מנהל</div>
                    ${comments.slice(-3).map((comment) => `
                        <div class="comment">
                            <div class="comment-header">
                                <span class="comment-author">${escapeHtml(comment.authorName || 'מנהל')}</span>
                                <span class="comment-date">${escapeHtml(formatDateTime(comment.date))}</span>
                            </div>
                            <div class="comment-text">${escapeHtml(comment.text || '')}</div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
            <div class="task-actions">
                ${task.notes ? `<button type="button" class="btn btn-primary btn-sm" data-action="view-progress" data-task-id="${escapeHtml(task.id)}">צפה בהערות התקדמות</button>` : ''}
                <button type="button" class="btn btn-secondary btn-sm" data-action="edit-task" data-task-id="${escapeHtml(task.id)}">ערוך</button>
                ${state.currentUserData.role === 'admin' ? `<button type="button" class="btn btn-ghost btn-sm" data-action="comment-task" data-task-id="${escapeHtml(task.id)}">הוסף הערה</button>` : ''}
                <button type="button" class="btn btn-danger btn-sm" data-action="delete-task" data-task-id="${escapeHtml(task.id)}">מחק</button>
            </div>
        </article>
    `;
}

async function handleLogin(event) {
    event.preventDefault();
    setFormBusy(elements.loginForm, true);
    elements.loginError.classList.add('hidden');

    try {
        await signInWithEmailAndPassword(auth, elements.email.value.trim(), elements.password.value);
    } catch (error) {
        console.error('Login failed:', error);
        const message = ['auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential'].includes(error.code)
            ? 'אימייל או סיסמה שגויים'
            : error.code === 'auth/invalid-email'
                ? 'כתובת האימייל אינה תקינה'
                : 'שגיאה בהתחברות למערכת';
        elements.loginError.textContent = message;
        elements.loginError.classList.remove('hidden');
    } finally {
        setFormBusy(elements.loginForm, false);
    }
}

async function handleAddEmployee(event) {
    event.preventDefault();
    setFormBusy(elements.addEmployeeForm, true);

    const name = elements.employeeName.value.trim();
    const email = elements.employeeEmail.value.trim();
    const password = elements.employeePassword.value;

    try {
        const user = await createEmployeeAuthAccount(email, password);
        await setDoc(doc(db, 'users', user.uid), {
            name,
            email,
            role: 'employee',
            createdAt: serverTimestamp()
        });
        closeModal('addEmployeeModal');
        elements.addEmployeeForm.reset();
        showToast('העובד נוסף בהצלחה');
    } catch (error) {
        console.error('Could not add employee:', error);
        const message = error.code === 'auth/email-already-in-use'
            ? 'האימייל כבר קיים ב-Firebase Authentication'
            : error.code === 'auth/weak-password'
                ? 'הסיסמה חייבת לכלול לפחות 6 תווים'
                : 'שגיאה בהוספת העובד';
        showToast(message, true);
    } finally {
        setFormBusy(elements.addEmployeeForm, false);
    }
}

async function handleEditEmployee(event) {
    event.preventDefault();
    setFormBusy(elements.editEmployeeForm, true);
    try {
        await updateDoc(doc(db, 'users', elements.editEmployeeId.value), {
            name: elements.editEmployeeName.value.trim(),
            role: elements.editEmployeeRole.value
        });
        closeModal('editEmployeeModal');
        showToast('פרטי העובד עודכנו');
    } catch (error) {
        console.error('Could not edit employee:', error);
        showToast('שגיאה בעדכון פרטי העובד', true);
    } finally {
        setFormBusy(elements.editEmployeeForm, false);
    }
}

async function handleEditProfile(event) {
    event.preventDefault();
    setFormBusy(elements.editProfileForm, true);
    const name = elements.editProfileName.value.trim();
    const password = elements.editProfilePassword.value;

    try {
        await updateDoc(doc(db, 'users', state.currentUser.uid), { name });
        if (password) await updatePassword(state.currentUser, password);
        state.currentUserData.name = name;
        elements.currentUserDisplay.textContent = `${name} · ${state.currentUserData.role === 'admin' ? 'מנהל' : 'עובד'}`;
        closeModal('editProfileModal');
        elements.editProfileForm.reset();
        showToast(password ? 'השם והסיסמה עודכנו' : 'השם עודכן');
    } catch (error) {
        console.error('Could not edit profile:', error);
        const message = error.code === 'auth/requires-recent-login'
            ? 'לשינוי הסיסמה יש להתנתק ולהתחבר מחדש'
            : 'שגיאה בעדכון הפרופיל';
        showToast(message, true);
    } finally {
        setFormBusy(elements.editProfileForm, false);
    }
}

async function handleAddTask(event) {
    event.preventDefault();
    const isEmployee = state.currentUserData.role === 'employee';
    const recurrenceType = isEmployee ? normalizeRecurrence(elements.taskRecurrence.value) : 'none';
    const dueDate = elements.taskDueDate.value;
    if (recurrenceType !== 'none' && !dueDate) {
        showToast('למשימה חזרתית חובה להגדיר תאריך יעד ראשון', true);
        elements.taskDueDate.focus();
        return;
    }

    setFormBusy(elements.addTaskForm, true);
    const assignedTo = state.currentUserData.role === 'admin'
        ? elements.assignToEmployee.value || state.currentUser.uid
        : state.currentUser.uid;

    try {
        await addDoc(collection(db, 'tasks'), {
            clientName: elements.taskClientName.value.trim(),
            title: elements.taskTitle.value.trim(),
            description: elements.taskDescription.value.trim(),
            dueDate,
            status: 'todo',
            assignedTo,
            createdBy: state.currentUser.uid,
            createdAt: serverTimestamp(),
            notes: '',
            comments: [],
            recurrenceType,
            recurrenceDay: recurrenceType === 'none' ? null : Number(dueDate.slice(-2)),
            completedOccurrences: []
        });
        closeModal('addTaskModal');
        elements.addTaskForm.reset();
        state.pendingAssignedEmployeeId = null;
        showToast(recurrenceType === 'none' ? 'המשימה נוצרה בהצלחה' : 'המשימה החזרתית נוצרה בהצלחה');
    } catch (error) {
        console.error('Could not add task:', error);
        showToast('שגיאה ביצירת המשימה', true);
    } finally {
        setFormBusy(elements.addTaskForm, false);
    }
}


async function handleEditTask(event) {
    event.preventDefault();
    const taskId = elements.editTaskId.value;
    const task = getTaskById(taskId);
    if (!task) return;

    const canEditRecurrence = state.currentUserData.role === 'employee'
        && task.assignedTo === state.currentUser.uid
        && task.createdBy === state.currentUser.uid;
    const recurrenceType = canEditRecurrence
        ? normalizeRecurrence(elements.editTaskRecurrence.value)
        : normalizeRecurrence(task.recurrenceType);
    const dueDate = elements.editTaskDueDate.value;
    if (recurrenceType !== 'none' && !dueDate) {
        showToast('למשימה חזרתית חובה להגדיר תאריך יעד', true);
        elements.editTaskDueDate.focus();
        return;
    }

    setFormBusy(elements.editTaskForm, true);
    try {
        const requestedStatus = elements.editTaskStatus.value;
        const updateData = {
            clientName: elements.editTaskClientName.value.trim(),
            title: elements.editTaskTitle.value.trim(),
            description: elements.editTaskDescription.value.trim(),
            status: requestedStatus,
            dueDate
        };

        if (canEditRecurrence) updateData.recurrenceType = recurrenceType;
        if (recurrenceType !== 'none' && dueDate) updateData.recurrenceDay = Number(dueDate.slice(-2));

        const newNote = elements.editTaskNotes.value.trim();
        if (newNote) {
            const timestamp = new Date().toLocaleString('he-IL');
            const existingNotes = String(task.notes || '').trim();
            const noteEntry = `[${timestamp}] ${state.currentUserData.name}: ${newNote}`;
            updateData.notes = existingNotes ? `${existingNotes}

${noteEntry}` : noteEntry;
        }

        if (recurrenceType !== 'none' && requestedStatus === 'done') {
            const completedOccurrences = Array.isArray(task.completedOccurrences) ? [...task.completedOccurrences] : [];
            if (dueDate && !completedOccurrences.includes(dueDate)) completedOccurrences.push(dueDate);
            updateData.completedOccurrences = completedOccurrences;
            updateData.dueDate = addMonthsClamped(dueDate, recurrenceType === 'bimonthly' ? 2 : 1, updateData.recurrenceDay || task.recurrenceDay);
            updateData.status = 'todo';
            updateData.completedAt = serverTimestamp();
        } else if (requestedStatus === 'done' && task.status !== 'done') {
            updateData.completedAt = serverTimestamp();
        }

        await updateDoc(doc(db, 'tasks', taskId), updateData);
        closeModal('editTaskModal');
        showToast(recurrenceType !== 'none' && requestedStatus === 'done'
            ? `המחזור הושלם. היעד הבא: ${formatDate(updateData.dueDate)}`
            : 'המשימה עודכנה');
    } catch (error) {
        console.error('Could not update task:', error);
        showToast('שגיאה בעדכון המשימה', true);
    } finally {
        setFormBusy(elements.editTaskForm, false);
    }
}


async function handleAddComment(event) {
    event.preventDefault();
    const task = getTaskById(elements.commentTaskId.value);
    if (!task) return;

    setFormBusy(elements.addCommentForm, true);
    try {
        const comments = Array.isArray(task.comments) ? [...task.comments] : [];
        comments.push({
            id: `comment-${Date.now()}`,
            authorId: state.currentUser.uid,
            authorName: state.currentUserData.name,
            text: elements.commentText.value.trim(),
            date: new Date().toISOString()
        });
        await updateDoc(doc(db, 'tasks', task.id), { comments });
        closeModal('addCommentModal');
        elements.addCommentForm.reset();
        showToast('ההערה נוספה למשימה');
    } catch (error) {
        console.error('Could not add comment:', error);
        showToast('שגיאה בהוספת ההערה', true);
    } finally {
        setFormBusy(elements.addCommentForm, false);
    }
}

async function completeTask(taskId) {
    const task = getTaskById(taskId);
    if (!task) return;
    const recurring = isRecurringTask(task) && task.dueDate;
    const message = recurring
        ? 'לסמן את המחזור הנוכחי כהושלם ולהעביר את המשימה למועד הבא?'
        : 'לסמן את המשימה כהושלמה?';
    if (!window.confirm(message)) return;
    try {
        if (recurring) {
            const completedOccurrences = Array.isArray(task.completedOccurrences) ? [...task.completedOccurrences] : [];
            if (!completedOccurrences.includes(task.dueDate)) completedOccurrences.push(task.dueDate);
            const nextDueDate = addMonthsClamped(task.dueDate, monthIntervalForTask(task), task.recurrenceDay);
            await updateDoc(doc(db, 'tasks', taskId), {
                status: 'todo',
                dueDate: nextDueDate,
                completedOccurrences,
                completedAt: serverTimestamp()
            });
            showToast(`המחזור הושלם. היעד הבא: ${formatDate(nextDueDate)}`);
        } else {
            await updateDoc(doc(db, 'tasks', taskId), {
                status: 'done',
                completedAt: serverTimestamp()
            });
            showToast('המשימה סומנה כהושלמה');
        }
    } catch (error) {
        console.error('Could not complete task:', error);
        showToast('שגיאה בסיום המשימה', true);
    }
}


async function deleteTask(taskId) {
    if (!window.confirm('למחוק את המשימה לצמיתות?')) return;
    try {
        await deleteDoc(doc(db, 'tasks', taskId));
        showToast('המשימה נמחקה');
    } catch (error) {
        console.error('Could not delete task:', error);
        showToast('שגיאה במחיקת המשימה', true);
    }
}

async function deleteEmployee(employeeId) {
    const employee = getUserById(employeeId);
    if (!employee) return;
    if (!window.confirm(`להסיר את ${employee.name} ואת כל המשימות שלו מהמערכת?`)) return;

    try {
        const employeeTasks = state.allTasks.filter((task) => task.assignedTo === employeeId);
        await Promise.all(employeeTasks.map((task) => deleteDoc(doc(db, 'tasks', task.id))));
        await deleteDoc(doc(db, 'users', employeeId));
        if (state.selectedEmployeeId === employeeId) closeEmployeeDetail();
        showToast('העובד והמשימות שלו הוסרו מהמערכת');
    } catch (error) {
        console.error('Could not delete employee:', error);
        showToast('שגיאה בהסרת העובד', true);
    }
}

function handleDocumentClick(event) {
    const adminTab = event.target.closest('[data-admin-tab]');
    if (adminTab) {
        switchAdminTab(adminTab.dataset.adminTab);
        return;
    }

    const employeeTab = event.target.closest('[data-employee-tab]');
    if (employeeTab) {
        switchEmployeeTab(employeeTab.dataset.employeeTab);
        return;
    }

    const closeButton = event.target.closest('[data-close-modal]');
    if (closeButton) {
        closeModal(closeButton.dataset.closeModal);
        return;
    }

    const actionElement = event.target.closest('[data-action]');
    if (!actionElement) return;
    const action = actionElement.dataset.action;

    const actions = {
        logout: () => signOut(auth),
        'open-profile': openProfileModal,
        'open-add-employee': () => openModal('addEmployeeModal'),
        'open-add-task': () => openAddTaskModal(),
        'back-to-employees': closeEmployeeDetail,
        'open-employee-detail': () => {
            switchAdminTab('employee-tasks');
            openEmployeeDetail(actionElement.dataset.employeeId);
        },
        'assign-task': () => {
            const employee = getUserById(actionElement.dataset.employeeId);
            if (employee) openAddTaskModal(employee.id, employee.name);
        },
        'edit-employee': () => openEditEmployeeModal(actionElement.dataset.employeeId),
        'delete-employee': () => deleteEmployee(actionElement.dataset.employeeId),
        'edit-task': () => openEditTaskModal(actionElement.dataset.taskId),
        'complete-task': () => completeTask(actionElement.dataset.taskId),
        'delete-task': () => deleteTask(actionElement.dataset.taskId),
        'comment-task': () => openCommentModal(actionElement.dataset.taskId),
        'view-progress': () => openProgressNotesModal(actionElement.dataset.taskId),
        'calendar-prev': () => changeCalendarMonth(actionElement.dataset.calendarTarget, -1),
        'calendar-next': () => changeCalendarMonth(actionElement.dataset.calendarTarget, 1),
        'calendar-today': () => resetCalendarMonth(actionElement.dataset.calendarTarget),
        'open-calendar-day': () => openCalendarDayModal(actionElement.dataset.date, actionElement.dataset.calendarTarget),
        'calendar-open-task': () => {
            closeModal('calendarDayModal');
            openEditTaskModal(actionElement.dataset.taskId);
        }
    };

    actions[action]?.();
}

function switchAdminTab(tabName) {
    document.querySelectorAll('[data-admin-tab]').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.adminTab === tabName);
    });

    const map = {
        board: 'boardTab',
        calendar: 'adminCalendarTab',
        'employee-tasks': 'employeeTasksTab',
        employees: 'employeesTab',
        'all-tasks': 'allTasksTab'
    };

    document.querySelectorAll('#adminView .tab-content').forEach((content) => content.classList.remove('active'));
    document.getElementById(map[tabName])?.classList.add('active');
    if (tabName !== 'employee-tasks') closeEmployeeDetail();
}

function switchEmployeeTab(tabName) {
    document.querySelectorAll('[data-employee-tab]').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.employeeTab === tabName);
    });
    document.querySelectorAll('#employeeView .employee-tab-content').forEach((content) => content.classList.remove('active'));
    document.getElementById(tabName === 'calendar' ? 'employeeCalendarTab' : 'employeeBoardTab')?.classList.add('active');
    if (tabName === 'calendar') renderEmployeeCalendar();
}

function openAddTaskModal(employeeId = null, employeeName = '') {
    elements.addTaskForm.reset();
    state.pendingAssignedEmployeeId = employeeId;
    elements.addTaskModalTitle.textContent = employeeId ? `משימה חדשה ל${employeeName}` : 'משימה חדשה';

    if (state.currentUserData.role === 'admin') {
        elements.assignToGroup.classList.remove('hidden');
        elements.taskRecurrenceGroup.classList.add('hidden');
        elements.taskRecurrence.value = 'none';
        const employees = state.allUsers.filter((user) => user.role === 'employee');
        elements.assignToEmployee.innerHTML = [
            `<option value="${escapeHtml(state.currentUser.uid)}">עבורי</option>`,
            ...employees.map((employee) => `<option value="${escapeHtml(employee.id)}">${escapeHtml(employee.name)}</option>`)
        ].join('');
        elements.assignToEmployee.value = employeeId || state.currentUser.uid;
    } else {
        elements.assignToGroup.classList.add('hidden');
        elements.taskRecurrenceGroup.classList.remove('hidden');
        elements.taskRecurrence.value = 'none';
    }

    openModal('addTaskModal');
    elements.taskClientName.focus();
}

function openEditTaskModal(taskId) {
    const task = getTaskById(taskId);
    if (!task) return;
    elements.editTaskForm.reset();
    elements.editTaskId.value = task.id;
    elements.editTaskClientName.value = task.clientName || '';
    elements.editTaskTitle.value = task.title || '';
    elements.editTaskDescription.value = task.description || '';
    elements.editTaskStatus.value = task.status || 'todo';
    elements.editTaskDueDate.value = task.dueDate || '';
    elements.editTaskNotes.value = '';
    elements.editTaskRecurrence.value = normalizeRecurrence(task.recurrenceType);

    const isAssignedEmployee = task.assignedTo === state.currentUser.uid;
    const canEditRecurrence = state.currentUserData.role === 'employee'
        && isAssignedEmployee
        && task.createdBy === state.currentUser.uid;
    elements.editTaskRecurrenceGroup.classList.toggle('hidden', !canEditRecurrence);
    elements.progressNoteGroup.classList.toggle('hidden', state.currentUserData.role !== 'employee' || !isAssignedEmployee);
    openModal('editTaskModal');
}

function openEditEmployeeModal(employeeId) {
    const employee = getUserById(employeeId);
    if (!employee) return;
    elements.editEmployeeId.value = employee.id;
    elements.editEmployeeName.value = employee.name || '';
    elements.editEmployeeEmail.value = employee.email || '';
    elements.editEmployeeRole.value = employee.role || 'employee';
    openModal('editEmployeeModal');
}

function openProfileModal() {
    elements.editProfileForm.reset();
    elements.editProfileName.value = state.currentUserData.name || '';
    elements.editProfileEmail.value = state.currentUserData.email || state.currentUser.email || '';
    openModal('editProfileModal');
}

function openCommentModal(taskId) {
    const task = getTaskById(taskId);
    if (!task) return;
    elements.addCommentForm.reset();
    elements.commentTaskId.value = taskId;
    openModal('addCommentModal');
}

function openProgressNotesModal(taskId) {
    const task = getTaskById(taskId);
    if (!task) return;
    const comments = Array.isArray(task.comments) ? task.comments : [];
    elements.progressNotesClient.textContent = task.clientName || 'ללא לקוח';
    elements.progressNotesTitle.textContent = task.title || 'הערות התקדמות';

    const notesHtml = String(task.notes || '').trim()
        ? `<section class="progress-note-block"><h4>עדכוני העובד</h4><p>${escapeHtml(task.notes)}</p></section>`
        : '<section class="progress-note-block"><h4>עדכוני העובד</h4><p>טרם נכתבו עדכוני התקדמות למשימה זו.</p></section>';

    const commentsHtml = comments.length
        ? `<section class="progress-note-block"><h4>הערות מנהל</h4>${comments.map((comment) => `
            <div class="comment">
                <div class="comment-header">
                    <span class="comment-author">${escapeHtml(comment.authorName || 'מנהל')}</span>
                    <span class="comment-date">${escapeHtml(formatDateTime(comment.date))}</span>
                </div>
                <div class="comment-text">${escapeHtml(comment.text || '')}</div>
            </div>
        `).join('')}</section>`
        : '';

    elements.progressNotesContent.innerHTML = notesHtml + commentsHtml;
    openModal('progressNotesModal');
}

function openModal(modalId) {
    document.getElementById(modalId)?.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal(modalId) {
    document.getElementById(modalId)?.classList.remove('active');
    if (!document.querySelector('.modal.active')) document.body.style.overflow = '';
}

function closeTopModal() {
    const activeModals = [...document.querySelectorAll('.modal.active')];
    const topModal = activeModals.at(-1);
    if (topModal) closeModal(topModal.id);
}

function setFormBusy(form, busy) {
    const submitButton = form.querySelector('[type="submit"]');
    if (submitButton) submitButton.disabled = busy;
}

function showToast(message, isError = false) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.toggle('error', isError);
    elements.toast.classList.add('visible');
    toastTimer = window.setTimeout(() => elements.toast.classList.remove('visible'), 3200);
}

function getUserById(userId) {
    return state.allUsers.find((user) => user.id === userId) || null;
}

function getTaskById(taskId) {
    return state.allTasks.find((task) => task.id === taskId) || null;
}

init();
