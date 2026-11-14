import type { HistoryKind, Priority, Project, Release, ReleaseStatus, Task, TaskKind, Workspace } from '../shared.js';
import type { View } from './dialog-context.mjs';
import { createEntryEditor } from './entry-editor.mjs';
import { createReleaseEditor } from './release-editor.mjs';
import { errorMessage, escapeHtml, statusNames } from './view-format.mjs';

const details = document.querySelector<HTMLElement>('#details')!;
const sidebarNav = document.querySelector<HTMLElement>('#navigation')!;
const main = document.querySelector<HTMLElement>('#main')!;
const content = document.querySelector<HTMLElement>('#content')!;
const notice = document.querySelector<HTMLElement>('#notice')!;
const shell = document.querySelector<HTMLElement>('.shell')!;
const sidebar = document.querySelector<HTMLElement>('#sidebar')!;
const sidebarResize = document.querySelector<HTMLElement>('#sidebar-resize')!;
const detailsResize = document.querySelector<HTMLElement>('#details-resize')!;
function syncSidebarResize(): void {
    const layout = getComputedStyle(shell);
    const minimum = parseFloat(layout.getPropertyValue('--sidebar-min'));
    const reserved = details.hidden ? 240 : details.getBoundingClientRect().width + 160;
    sidebarResize.setAttribute('aria-valuemin', String(minimum));
    sidebarResize.setAttribute('aria-valuemax', String(Math.max(minimum, Math.floor(shell.getBoundingClientRect().width - reserved))));
    sidebarResize.setAttribute('aria-valuenow', String(Math.round(sidebar.getBoundingClientRect().width)));
}
function syncDetailsResize(): void {
    if (details.hidden)
        return;
    const minimum = parseFloat(getComputedStyle(shell).getPropertyValue('--details-min'));
    const maximum = Math.max(minimum, Math.floor(shell.getBoundingClientRect().width - sidebar.getBoundingClientRect().width - 160));
    detailsResize.setAttribute('aria-valuemin', String(minimum));
    detailsResize.setAttribute('aria-valuemax', String(maximum));
    detailsResize.setAttribute('aria-valuenow', String(Math.round(details.getBoundingClientRect().width)));
}
function setDetailsWidth(width: number): void {
    const minimum = parseFloat(getComputedStyle(shell).getPropertyValue('--details-min'));
    const maximum = Math.max(minimum, shell.getBoundingClientRect().width - sidebar.getBoundingClientRect().width - 160);
    shell.style.setProperty('--details-width', `${Math.max(minimum, Math.min(maximum, width))}px`);
    syncDetailsResize();
    syncSidebarResize();
}
let detailsDrag: {
    pointerId: number;
    startX: number;
    startWidth: number;
} | null = null;
detailsResize.addEventListener('pointerdown', event => {
    if (event.button !== 0 || detailsDrag)
        return;
    detailsDrag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: details.getBoundingClientRect().width
    };
    detailsResize.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing-sidebar');
    event.preventDefault();
});
detailsResize.addEventListener('pointermove', event => {
    if (detailsDrag?.pointerId === event.pointerId)
        setDetailsWidth(detailsDrag.startWidth + detailsDrag.startX - event.clientX);
});
function endDetailsDrag(event: PointerEvent): void {
    if (detailsDrag?.pointerId !== event.pointerId)
        return;
    detailsDrag = null;
    document.body.classList.remove('resizing-sidebar');
    if (detailsResize.hasPointerCapture(event.pointerId))
        detailsResize.releasePointerCapture(event.pointerId);
}
detailsResize.addEventListener('pointerup', endDetailsDrag);
detailsResize.addEventListener('pointercancel', endDetailsDrag);
detailsResize.addEventListener('lostpointercapture', endDetailsDrag);
detailsResize.addEventListener('focus', syncDetailsResize);
detailsResize.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
        return;
    event.preventDefault();
    setDetailsWidth(details.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? 10 : -10));
});
function setSidebarWidth(width: number): void {
    const minimum = parseFloat(getComputedStyle(shell).getPropertyValue('--sidebar-min'));
    shell.style.setProperty('--sidebar-width', `${Math.max(minimum, width)}px`);
    syncSidebarResize();
    syncDetailsResize();
}
let sidebarDrag: {
    pointerId: number;
    startX: number;
    startWidth: number;
} | null = null;
sidebarResize.addEventListener('pointerdown', event => {
    if (event.button !== 0 || sidebarDrag)
        return;
    sidebarDrag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: sidebar.getBoundingClientRect().width
    };
    sidebarResize.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing-sidebar');
    event.preventDefault();
});
sidebarResize.addEventListener('pointermove', event => {
    if (sidebarDrag?.pointerId === event.pointerId)
        setSidebarWidth(sidebarDrag.startWidth + event.clientX - sidebarDrag.startX);
});
function endSidebarDrag(event: PointerEvent): void {
    if (sidebarDrag?.pointerId !== event.pointerId)
        return;
    sidebarDrag = null;
    document.body.classList.remove('resizing-sidebar');
    if (sidebarResize.hasPointerCapture(event.pointerId))
        sidebarResize.releasePointerCapture(event.pointerId);
}
sidebarResize.addEventListener('pointerup', endSidebarDrag);
sidebarResize.addEventListener('pointercancel', endSidebarDrag);
sidebarResize.addEventListener('lostpointercapture', endSidebarDrag);
sidebarResize.addEventListener('focus', syncSidebarResize);
sidebarResize.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
        return;
    event.preventDefault();
    setSidebarWidth(sidebar.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? -10 : 10));
});
window.addEventListener('resize', () => {
    syncSidebarResize();
    syncDetailsResize();
});
syncSidebarResize();
const priorityNames: Record<Priority, string> = { high: 'Hoch', normal: 'Normal', low: 'Niedrig' };
let workspace: Workspace = { revision: 0, projects: [], tasks: [], subtasks: [], releases: [], history: [] };
let view: View = 'inbox';
let activeTab: TaskKind | 'releases' | 'history' = 'task';
const showCompleted = new Set<string>();
function visibilityKey(): string {
    return `${view}:${activeTab}`;
}
function visibilityButton(): string {
    const shown = showCompleted.has(visibilityKey());
    return `<button type="button" class="button secondary" data-action="toggle-completed" aria-pressed="${shown}">${shown ? 'Erledigte ausblenden' : 'Erledigte anzeigen'}</button>`;
}
let saving = false;
let selectedTaskId: number | null = null;
let selectedReleaseId: number | null = null;
const releaseStatusNames: Record<ReleaseStatus, string> = { planned: 'Geplant', in_progress: 'In Arbeit', paused: 'Pausiert', published: 'Veröffentlicht' };
let noticeTimer: number | undefined;
function addButton(action: string, label: string, style = 'primary'): string {
    return `<button type="button" class="button ${style}" data-action="${action}" aria-label="${label}" title="${label}">+</button>`;
}
function priorityBadge(priority: Priority, kind = 'Priorität'): string {
    return `<span class="priority ${priority}" aria-label="${kind} ${priorityNames[priority]}">${priorityNames[priority]}</span>`;
}
function navItem(target: View, name: string, count?: number): string {
    return `<button type="button" class="nav-button" data-view="${target}"${view === target ? ' aria-current="page"' : ''}>
    <span class="nav-marker" aria-hidden="true">${view === target ? '&gt;' : (typeof target === 'number' ? '└' : '·')}</span>
    <span class="nav-name">${escapeHtml(name)}</span>
    ${count === undefined ? '' : `<span class="nav-count" aria-label="${count} offen">${count}</span>`}
  </button>`;
}
function renderNavigation(): void {
    const inboxOpen = workspace.tasks.filter(task => task.projectId === null && !task.completed).length;
    sidebarNav.innerHTML = `
    <section class="nav-section" aria-labelledby="workspace-caption">
      <div class="nav-caption"><p class="eyebrow" id="workspace-caption">Arbeitsbereich</p></div>
      ${navItem('inbox', 'Posteingang', inboxOpen)}
      ${navItem('projects', 'Projekte')}
      ${navItem('ideas', 'Ideen')}
      ${navItem('research', 'Recherche')}
    </section>
    <section class="nav-section" aria-labelledby="projects-caption">
      <div class="nav-caption">
        <p class="eyebrow" id="projects-caption">Meine Projekte</p>
        <button type="button" class="button compact" data-action="new-project" aria-label="Neues Projekt" title="Neues Projekt">+</button>
      </div>
      ${workspace.projects.map(project => navItem(project.id, project.title, workspace.tasks.filter(task => task.projectId === project.id && !task.completed).length)).join('')}
    </section>`;
}
function pageHeading(title: string, path: string, description: string, actions: string, extra = ''): string {
    return `
    <div class="path"><span>~/hq</span><span aria-hidden="true">/</span><span class="path-current">${escapeHtml(path)}</span></div>
    <div class="page-head">
      <div class="prompt-heading">
        <span class="prompt-mark" aria-hidden="true">&gt;</span>
        <h1 tabindex="-1">${escapeHtml(title)}</h1>
        ${description ? `<p class="subtitle">${description}</p>` : ''}
        ${extra}
      </div>
      <div class="head-actions">${actions}</div>
    </div>`;
}
function emptyState(title: string, description: string, action: string): string {
    return `<div class="empty">
    <div class="empty-title"><span aria-hidden="true">//</span><strong>${title}</strong></div>
    <p>${description}</p>
    ${action}
  </div>`;
}
function taskRow(task: Task): string {
    const title = escapeHtml(task.title);
    const due = task.dueDate ? escapeHtml(task.dueDate.split('-').reverse().join('.')) : '–';
    return `<li class="task-row" data-completed="${task.completed}">
    <label class="check">
      <input type="checkbox" data-complete="${task.id}" aria-label="${title} erledigt"${task.completed ? ' checked' : ''}>
      <span class="check-glyph" aria-hidden="true"></span>
    </label>
    <button type="button" class="task-title task-open" data-action="show-task" data-id="${task.id}"><span class="task-title-text">${title}</span></button>
    <span class="task-status">${statusNames[task.status]}</span>
    ${priorityBadge(task.priority)}
    <span class="task-due">${due}</span>
    <button type="button" class="button compact" data-action="edit-task" data-id="${task.id}" aria-label="${title} bearbeiten">B</button>
  </li>`;
}
function taskPanel(project: Project | undefined): string {
    const projectId = project?.id ?? null;
    const kind: TaskKind = project?.kind === 'software' && activeTab !== 'releases' && activeTab !== 'history' ? activeTab : 'task';
    const tasks = workspace.tasks.filter(task => task.kind === kind && task.projectId === projectId && (showCompleted.has(visibilityKey()) || !task.completed));
    return `<section class="panel task-panel" aria-label="${kind === 'feature' ? 'Features' : kind === 'fix' ? 'Fixes' : 'Aufgaben'}">
    <div class="task-columns" aria-hidden="true"><span></span><span>Titel</span><span>Status</span><span>Priorität</span><span>Fälligkeit</span><span></span></div>
    ${tasks.length
        ? `<ul class="list">${tasks.map(task => taskRow(task)).join('')}</ul>`
        : emptyState(kind === 'feature' ? 'Noch keine Features' : kind === 'fix' ? 'Noch keine Fixes' : project ? 'Hier ist Platz für deine Aufgaben' : 'Dein Posteingang ist leer', kind === 'feature' ? 'Beschreibe eine neue Funktion für dieses Softwareprojekt.' : kind === 'fix' ? 'Halte einen Bugfix, ein Refactoring oder eine kleinere Änderung fest.' : project ? 'Halte den nächsten Schritt für dieses Projekt fest.' : 'Erfasse eine Aufgabe und ordne sie später einem Projekt zu.', addButton('new-task', kind === 'feature' ? 'Feature anlegen' : kind === 'fix' ? 'Fix anlegen' : 'Aufgabe erfassen', 'secondary'))}
  </section>`;
}
function releasePanel(project: Project): string {
    const releases = workspace.releases.filter(item => item.projectId === project.id && (showCompleted.has(visibilityKey()) || !item.published));
    return `<section class="panel release-panel" aria-label="Releases"><header class="panel-header"><span class="panel-meta">${releases.length} ${releases.length === 1 ? 'Release' : 'Releases'}</span></header>
    ${releases.length ? `<ul class="list">${releases.map(release => {
        const items = workspace.tasks.filter(task => task.releaseId === release.id);
        return `<li class="release-row"><div class="release-heading"><button type="button" class="release-open" data-action="show-release" data-id="${release.id}" aria-label="Release ${escapeHtml(release.version)} öffnen"><strong>${escapeHtml(release.version)}</strong> <span class="muted">${releaseStatusNames[release.status]}</span>${release.dueDate ? `<span class="release-due">Fällig am ${escapeHtml(release.dueDate.split('-').reverse().join('.'))}</span>` : ''}</button><div class="release-actions"><button type="button" class="button compact" data-action="edit-release" data-id="${release.id}" aria-label="Release ${escapeHtml(release.version)} bearbeiten" title="Release bearbeiten">B</button>${release.published ? '' : `<button type="button" class="button compact" data-action="publish-release" data-id="${release.id}" aria-label="Release ${escapeHtml(release.version)} veröffentlichen">Veröffentlichen</button>`}</div></div>${([["task", "Aufgaben"], ["feature", "Features"], ["fix", "Fixes"]] as const).map(([kind, label]) => `<section><h3>${label}</h3><ul class="detail-list">${items.filter(item => item.kind === kind).map(item => `<li><button type="button" class="detail-link" data-action="show-task" data-id="${item.id}">${escapeHtml(item.title)} · ${statusNames[item.status]}</button></li>`).join('') || '<li class="muted">Keine</li>'}</ul></section>`).join('')}</li>`;
    }).join('')}</ul>` : emptyState('Noch keine Releases', 'Plane eine Version für dieses Softwareprojekt.', addButton('new-release', 'Release anlegen', 'secondary'))}</section>`;
}
function projectRow(project: Project): string {
    const tasks = workspace.tasks.filter(task => task.projectId === project.id);
    const open = tasks.filter(task => !task.completed).length;
    return `<li><button type="button" class="project-row" data-view="${project.id}">
    <span class="project-marker" aria-hidden="true">/</span>
    <span><span class="project-title">${escapeHtml(project.title)}</span>
    <span class="project-meta">${open} offen · ${tasks.length - open} erledigt</span></span>
    ${priorityBadge(project.priority, 'Projektpriorität')}
    <span class="project-arrow" aria-hidden="true">&gt;</span>
  </button></li>`;
}
function render(): void {
    renderNavigation();
    renderDetails();
    if (view === 'ideas' || view === 'research') {
        const title = view === 'ideas' ? 'Ideen' : 'Recherche';
        content.innerHTML = pageHeading(title, title, 'in Entwicklung', '');
        return;
    }
    if (view === 'projects') {
        content.innerHTML = `
      ${pageHeading('Projekte', 'Projekte', '', addButton('new-project', 'Neues Projekt'))}
      <section class="panel" aria-labelledby="project-heading">
        <header class="panel-header">
          <h2 id="project-heading">Meine Projekte</h2>
          <span class="panel-meta">${workspace.projects.length} ${workspace.projects.length === 1 ? 'Projekt' : 'Projekte'}</span>
        </header>
        ${workspace.projects.length
            ? `<ul class="list">${workspace.projects.map(projectRow).join('')}</ul>`
            : emptyState('Noch keine Projekte', 'Lege ein Projekt für dein nächstes Vorhaben an.', addButton('new-project', 'Projekt anlegen', 'secondary'))}
      </section>`;
        return;
    }
    const project = workspace.projects.find(item => item.id === view);
    const editProject = project
        ? `<button type="button" class="button secondary" data-action="edit-project" data-id="${project.id}" aria-label="Projekt bearbeiten">B</button>`
        : '';
    const software = project?.kind === 'software';
    const tabs = project ? `<div class="overview-toolbar"><nav class="task-tabs" aria-label="Projektbereich"><button type="button" class="task-tab" data-action="tab-history" aria-pressed="${activeTab === 'history'}">Status</button><button type="button" class="task-tab" data-action="tab-task" aria-pressed="${activeTab === 'task'}">Aufgaben</button>${software ? `<button type="button" class="task-tab" data-action="tab-feature" aria-pressed="${activeTab === 'feature'}">Features</button><button type="button" class="task-tab" data-action="tab-fix" aria-pressed="${activeTab === 'fix'}">Fixes</button><button type="button" class="task-tab" data-action="tab-releases" aria-pressed="${activeTab === 'releases'}">Releases</button>` : ''}</nav>${activeTab === 'history' ? '' : visibilityButton()}</div>` : `<div class="overview-toolbar inbox-toolbar">${visibilityButton()}</div>`;
    content.innerHTML = `
    ${pageHeading(project?.title ?? 'Posteingang', project ? `Projekte / ${project.title}` : 'Posteingang', project ? (project.description ? escapeHtml(project.description).replaceAll('\n', '<br>') : 'Deine Aufgaben für dieses Projekt.') : '', editProject + (software && activeTab === 'releases' ? addButton('new-release', 'Neues Release') : addButton('new-task', software && activeTab === 'feature' ? 'Neues Feature' : software && activeTab === 'fix' ? 'Neuer Fix' : 'Neue Aufgabe')), project ? `<div class="project-priority"><span>Projektpriorität</span>${priorityBadge(project.priority, 'Projektpriorität')}</div>${project.dueDate ? `<div class="project-deadline">Projektfrist: ${escapeHtml(project.dueDate.split('-').reverse().join('.'))}</div>` : ''}` : '')}
    ${tabs}
    ${project && activeTab === 'history' ? historyPanel('project', project.id) : software && activeTab === 'releases' ? releasePanel(project!) : taskPanel(project)}`;
}
function historyPanel(kind: HistoryKind, id: number): string {
    const entries = (workspace.history ?? []).filter(entry => kind === 'project'
        ? entry.projectId === id && (!entry.manual || (entry.entityKind === 'project' && entry.entityId === id))
        : entry.entityKind === kind && entry.entityId === id);
    const rows = entries.map(entry => `<tr><td>${escapeHtml(new Date(entry.date).toLocaleString('de-DE'))}</td><td>${kind === 'project' && entry.entityKind !== 'project' ? escapeHtml(entry.entityTitle) + ' · ' : ''}${escapeHtml(entry.field)}</td><td>${escapeHtml(entry.oldValue ?? '–')}</td><td>${escapeHtml(entry.newValue ?? '–')}</td></tr>`).join('');
    return `<section class="history">${kind === 'project' ? '' : '<h3>Verlauf</h3>'}<div class="history-table"><table><thead><tr><th>Datum</th><th>Änderung</th><th>Alter Wert</th><th>Neuer Wert</th></tr></thead><tbody>${rows || '<tr><td colspan="4">Noch keine Meldungen</td></tr>'}</tbody></table></div></section>`;
}
function renderDetails(): void {
    const task = workspace.tasks.find(item => item.id === selectedTaskId);
    const release = workspace.releases.find(item => item.id === selectedReleaseId);
    details.hidden = !task && !release;
    detailsResize.hidden = details.hidden;
    details.setAttribute('aria-label', release ? 'Releasedetails' : 'Aufgabendetails');
    shell.classList.toggle('with-details', !!task || !!release);
    syncSidebarResize();
    syncDetailsResize();
    details.innerHTML = release ? renderReleaseDetails(release) : task ? renderTaskDetails(task) : '';
}

function renderReleaseDetails(release: Release): string {
    const items = workspace.tasks.filter(item => item.releaseId === release.id);
    const list = (kind: TaskKind) => {
        const matching = items.filter(item => item.kind === kind);
        return matching.length ? matching.map(item => `<li><button type="button" class="detail-link" data-action="show-task" data-id="${item.id}">${escapeHtml(item.title)} · ${statusNames[item.status]}</button></li>`).join('') : '<li class="muted">Keine</li>';
    };
    return `<header class="details-header"><div class="details-heading"><p class="eyebrow">Release</p><h2>${escapeHtml(release.version)}</h2></div><div class="details-actions"><button type="button" class="button compact" data-action="edit-release" data-id="${release.id}" aria-label="Release bearbeiten">B</button><button type="button" class="button compact" data-action="close-details" aria-label="Details schließen">×</button></div></header>
      <div class="details-body"><section><h3>Status</h3><p>${releaseStatusNames[release.status]}</p></section><section><h3>Fällig am</h3><p>${release.dueDate ? escapeHtml(release.dueDate.split('-').reverse().join('.')) : 'Kein Datum'}</p></section>
      <section><h3>Aufgaben</h3><ul class="detail-list">${list('task')}</ul></section><section><h3>Features</h3><ul class="detail-list">${list('feature')}</ul></section><section><h3>Fixes</h3><ul class="detail-list">${list('fix')}</ul></section>
      ${historyPanel('release', release.id)}
      ${release.published ? '' : `<button type="button" class="button secondary" data-action="publish-release" data-id="${release.id}">Veröffentlichen</button>`}
      </div>`;
}

function renderTaskDetails(task: Task): string {
    const links = (ids: number[]) => workspace.tasks.filter(item => ids.includes(item.id)).map(item => `<li><button type="button" class="detail-link" data-action="show-task" data-id="${item.id}">${escapeHtml(item.title)} · ${statusNames[item.status]}</button></li>`).join('') || '<li class="muted">Keine</li>';
    const subtasks = workspace.subtasks.filter(item => item.taskId === task.id);
    const assignedRelease = workspace.releases.find(item => item.id === task.releaseId);
    const project = workspace.projects.find(item => item.id === task.projectId);
    return `<header class="details-header"><div class="details-heading"><p class="eyebrow">${task.kind === 'feature' ? 'Feature' : task.kind === 'fix' ? 'Fix' : 'Aufgabe'}</p><h2>${escapeHtml(task.title)}</h2></div><div class="details-actions"><button type="button" class="button compact" data-action="edit-task" data-id="${task.id}" aria-label="${task.kind === 'feature' ? 'Feature' : task.kind === 'fix' ? 'Fix' : 'Aufgabe'} bearbeiten">B</button><button type="button" class="button compact" data-action="close-details" aria-label="Details schließen">×</button></div></header>
    <div class="details-body"><section><h3>Beschreibung</h3><p class="description">${task.description ? escapeHtml(task.description) : 'Keine Beschreibung'}</p></section>
    ${task.criteria.length ? `<section><h3>Akzeptanzkriterien</h3><ul class="detail-list">${task.criteria.map(criterion => `<li><label><input type="checkbox" data-criterion="${criterion.id}" ${criterion.completed ? 'checked' : ''}> ${escapeHtml(criterion.text)}</label></li>`).join('')}</ul></section>` : ''}
    <div class="details-metadata"><section><h3>Fällig am</h3><p>${task.dueDate ? escapeHtml(task.dueDate.split('-').reverse().join('.')) : 'Kein Datum'}</p></section><section><h3>Status</h3><p>${statusNames[task.status]}</p></section>${project?.kind === 'software' ? `<section><h3>Zielversion</h3><p>${task.targetVersion ? escapeHtml(task.targetVersion) + (assignedRelease?.published ? ' (veröffentlicht)' : '') : 'Keine Zielversion'}</p></section>` : ''}</div>
    <section><h3>Unteraufgaben</h3><ul class="detail-list">${subtasks.map(item => `<li><label><input type="checkbox" data-subtask="${item.id}" ${item.completed ? 'checked' : ''}> ${escapeHtml(item.title)}</label></li>`).join('')}</ul>
    </section>
    <section><h3>Vorgänger</h3><ul class="detail-list">${links(task.predecessorIds)}</ul></section><section><h3>Folgeaufgaben</h3><ul class="detail-list">${links(task.successorIds)}</ul></section>
    ${historyPanel('task', task.id)}
    </div>`;
}
function showView(target: View): void {
    view = target;
    activeTab = 'task';
    selectedTaskId = null;
    selectedReleaseId = null;
    render();
    main.scrollTop = 0;
    content.querySelector('h1')?.focus({ preventScroll: true });
}
function announce(message: string, error = false): void {
    window.clearTimeout(noticeTimer);
    notice.dataset.error = String(error);
    notice.textContent = message;
    notice.hidden = false;
    noticeTimer = window.setTimeout(() => {
        notice.hidden = true;
    }, 4500);
}
const dialogContext = {
    get workspace() { return workspace; },
    set workspace(value: Workspace) { workspace = value; },
    get view() { return view; },
    get activeTab() { return activeTab; },
    get saving() { return saving; },
    set saving(value: boolean) { saving = value; },
    get selectedTaskId() { return selectedTaskId; },
    set selectedTaskId(value: number | null) { selectedTaskId = value; },
    get selectedReleaseId() { return selectedReleaseId; },
    set selectedReleaseId(value: number | null) { selectedReleaseId = value; },
    showView,
    render,
    announce,
    focusHeading() { content.querySelector('h1')?.focus({ preventScroll: true }); },
};
const entryEditor = createEntryEditor(dialogContext);
const releaseEditor = createReleaseEditor(dialogContext);

document.addEventListener('click', event => {
    if (!(event.target instanceof Element))
        return;
    const target = event.target.closest<HTMLButtonElement>('button[data-view], button[data-action]');
    if (!target || saving)
        return;
    const destination = target.dataset.view;
    if (destination) {
        showView(destination === 'inbox' || destination === 'projects' || destination === 'ideas' || destination === 'research' ? destination : Number(destination));
        return;
    }
    switch (target.dataset.action) {
        case 'toggle-completed': {
            const key = visibilityKey();
            if (showCompleted.has(key))
                showCompleted.delete(key);
            else
                showCompleted.add(key);
            render();
            break;
        }
        case 'tab-history':
            activeTab = 'history';
            selectedTaskId = null;
            selectedReleaseId = null;
            render();
            break;
        case 'tab-task':
            activeTab = 'task';
            selectedTaskId = null;
            selectedReleaseId = null;
            render();
            break;
        case 'tab-feature':
            activeTab = 'feature';
            selectedTaskId = null;
            selectedReleaseId = null;
            render();
            break;
        case 'tab-releases':
            activeTab = 'releases';
            selectedTaskId = null;
            selectedReleaseId = null;
            render();
            break;
        case 'show-release':
            selectedTaskId = null;
            selectedReleaseId = Number(target.dataset.id);
            renderDetails();
            break;
        case 'new-release':
            releaseEditor.open();
            break;
        case 'edit-release':
            releaseEditor.open(Number(target.dataset.id));
            break;
        case 'publish-release':
            releaseEditor.openPublish(Number(target.dataset.id));
            break;
        case 'tab-fix':
            activeTab = 'fix';
            selectedTaskId = null;
            selectedReleaseId = null;
            render();
            break;
        case 'show-task':
            selectedReleaseId = null;
            selectedTaskId = Number(target.dataset.id);
            renderDetails();
            break;
        case 'close-details':
            selectedTaskId = null;
            selectedReleaseId = null;
            renderDetails();
            break;
        case 'new-task':
            entryEditor.open({ kind: 'task', id: null });
            break;
        case 'edit-task':
            entryEditor.open({ kind: 'task', id: Number(target.dataset.id) });
            break;
        case 'new-project':
            entryEditor.open({ kind: 'project', id: null });
            break;
        case 'edit-project':
            entryEditor.open({ kind: 'project', id: Number(target.dataset.id) });
            break;
    }
});
function completionAction(checkbox: HTMLInputElement) {
    const { criterion, subtask, complete } = checkbox.dataset;
    const hq = window.hq;
    if (criterion)
        return { id: Number(criterion), save: hq.completeCriterion, isTask: false };
    if (subtask)
        return { id: Number(subtask), save: hq.completeSubtask, isTask: false };
    if (complete)
        return { id: Number(complete), save: hq.completeTask, isTask: true };
}

document.addEventListener('change', async event => {
    const checkbox = event.target;
    if (!(checkbox instanceof HTMLInputElement))
        return;
    const action = completionAction(checkbox);
    if (!action)
        return;

    const completed = checkbox.checked;
    if (saving) {
        checkbox.checked = !completed;
        return;
    }

    saving = true;
    checkbox.disabled = true;
    try {
        workspace = await action.save(action.id, completed, workspace.revision);
        render();
        if (action.isTask) {
            content.querySelector<HTMLInputElement>(`[data-complete="${action.id}"]`)?.focus({ preventScroll: true });
            announce(completed ? 'Aufgabe erledigt.' : 'Aufgabe wieder geöffnet.');
        }
    }
    catch (error) {
        checkbox.checked = !completed;
        announce(errorMessage(error), true);
    }
    finally {
        checkbox.disabled = false;
        saving = false;
    }
});
void window.hq.read().then(data => {
    workspace = data;
    render();
}).catch(() => {
    content.innerHTML = '<p role="alert">Der Arbeitsbereich konnte nicht geladen werden. Starte HQ erneut.</p>';
}).finally(() => {
    main.setAttribute('aria-busy', 'false');
});
// Do not replace a draft or a newer local result with a concurrent read.
function canRefreshWorkspace(): boolean {
    const active = document.activeElement;
    return !saving && !document.querySelector('dialog[open]') && !(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement);
}
window.setInterval(() => {
    if (!canRefreshWorkspace())
        return;
    void window.hq.read().then(data => {
        if (canRefreshWorkspace() && data.revision > workspace.revision) {
            workspace = data;
            render();
        }
    }).catch(() => { });
}, 2000);
