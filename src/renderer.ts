type Priority = import('./shared').Priority;
type Project = import('./shared').Project;
type Task = import('./shared').Task;
type Workspace = import('./shared').Workspace;
type CriterionFields = import('./shared').CriterionFields;
type TaskKind = import('./shared').TaskKind;
type ProjectKind = import('./shared').ProjectKind;
type ReleaseStatus = import('./shared').ReleaseStatus;
type TaskStatus = import('./shared').TaskStatus;
type HqApi = import('./shared').HqApi;
type View = 'inbox' | 'projects' | 'ideas' | 'research' | number;
type EditorMode = { kind: 'project'; id: number | null } | { kind: 'task'; id: number | null };

interface Window {
  hq: HqApi;
}

const deleteReleaseDialog = document.querySelector<HTMLDialogElement>('#delete-release-dialog')!;
const deleteReleaseDescription = document.querySelector<HTMLElement>('#delete-release-description')!;
const deleteReleaseError = document.querySelector<HTMLElement>('#delete-release-error')!;
const confirmDeleteRelease = document.querySelector<HTMLButtonElement>('#confirm-delete-release')!;
const cancelDeleteRelease = document.querySelector<HTMLButtonElement>('#cancel-delete-release')!;
const releaseDialog = document.querySelector<HTMLDialogElement>('#release-dialog')!;
const releaseForm = document.querySelector<HTMLFormElement>('#release-form')!;
const releaseStatus = document.querySelector<HTMLSelectElement>('#release-status')!;
const releaseDue = document.querySelector<HTMLInputElement>('#release-due')!;
const releaseVersion = document.querySelector<HTMLInputElement>('#release-version')!;
const releaseTitle = document.querySelector<HTMLElement>('#release-dialog-title')!;
const saveRelease = document.querySelector<HTMLButtonElement>('#save-release')!;
const releaseError = document.querySelector<HTMLElement>('#release-error')!;
const publishDialog = document.querySelector<HTMLDialogElement>('#publish-dialog')!;
const publishDescription = document.querySelector<HTMLElement>('#publish-description')!;
const publishError = document.querySelector<HTMLElement>('#publish-error')!;
const confirmPublish = document.querySelector<HTMLButtonElement>('#confirm-publish')!;
const publishedVersion = document.querySelector<HTMLElement>('#published-version')!;
const deleteDialog = document.querySelector<HTMLDialogElement>('#delete-dialog')!;
const deleteTitle = document.querySelector<HTMLElement>('#delete-title')!;
const deleteDescription = document.querySelector<HTMLElement>('#delete-description')!;
const deleteError = document.querySelector<HTMLElement>('#delete-error')!;
const confirmDelete = document.querySelector<HTMLButtonElement>('#confirm-delete')!;
const cancelDelete = document.querySelector<HTMLButtonElement>('#cancel-delete')!;
const details = document.querySelector<HTMLElement>('#details')!;
const targetVersionField = document.querySelector<HTMLSelectElement>('#entry-target-version')!;
const criteriaField = document.querySelector<HTMLElement>('#entry-criteria')!;
const descriptionField = document.querySelector<HTMLTextAreaElement>('#entry-description')!;
const dueField = document.querySelector<HTMLInputElement>('#entry-due')!;
const statusField = document.querySelector<HTMLSelectElement>('#entry-status')!;
const predecessorDialog = document.querySelector<HTMLDialogElement>('#predecessor-dialog')!;
const predecessorProject = document.querySelector<HTMLSelectElement>('#predecessor-project')!;
const predecessorTask = document.querySelector<HTMLSelectElement>('#predecessor-task')!;
const confirmPredecessor = document.querySelector<HTMLButtonElement>('#confirm-predecessor')!;
const predecessorEmpty = document.querySelector<HTMLElement>('#predecessor-empty')!;
const predecessorField = document.querySelector<HTMLElement>('#entry-predecessors')!;
const sidebarNav = document.querySelector<HTMLElement>('#navigation')!;
const main = document.querySelector<HTMLElement>('#main')!;
const content = document.querySelector<HTMLElement>('#content')!;
const notice = document.querySelector<HTMLElement>('#notice')!;
const editor = document.querySelector<HTMLDialogElement>('#editor')!;
const form = document.querySelector<HTMLFormElement>('#editor-form')!;
const titleField = document.querySelector<HTMLInputElement>('#entry-title')!;
const priorityField = document.querySelector<HTMLSelectElement>('#entry-priority')!;
const projectDueField = document.querySelector<HTMLInputElement>('#entry-project-due')!;
const projectDueConflictBox = document.querySelector<HTMLElement>('#project-due-conflicts')!;
const projectKindField = document.querySelector<HTMLSelectElement>('#entry-project-kind')!;
const projectField = document.querySelector<HTMLSelectElement>('#entry-project')!;
const editorFields = document.querySelector<HTMLFieldSetElement>('#editor-fields')!;
const editorError = document.querySelector<HTMLElement>('#editor-error')!;
const saveButton = document.querySelector<HTMLButtonElement>('#save-entry')!;
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
  if (details.hidden) return;
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
let detailsDrag: { pointerId: number; startX: number; startWidth: number } | null = null;
detailsResize.addEventListener('pointerdown', event => {
  if (event.button !== 0 || detailsDrag) return;
  detailsDrag = { pointerId: event.pointerId, startX: event.clientX, startWidth: details.getBoundingClientRect().width };
  detailsResize.setPointerCapture(event.pointerId);
  document.body.classList.add('resizing-sidebar');
  event.preventDefault();
});
detailsResize.addEventListener('pointermove', event => {
  if (detailsDrag?.pointerId === event.pointerId) setDetailsWidth(detailsDrag.startWidth + detailsDrag.startX - event.clientX);
});
function endDetailsDrag(event: PointerEvent): void {
  if (detailsDrag?.pointerId !== event.pointerId) return;
  detailsDrag = null;
  document.body.classList.remove('resizing-sidebar');
  if (detailsResize.hasPointerCapture(event.pointerId)) detailsResize.releasePointerCapture(event.pointerId);
}
detailsResize.addEventListener('pointerup', endDetailsDrag);
detailsResize.addEventListener('pointercancel', endDetailsDrag);
detailsResize.addEventListener('lostpointercapture', endDetailsDrag);
detailsResize.addEventListener('focus', syncDetailsResize);
detailsResize.addEventListener('keydown', event => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  setDetailsWidth(details.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? 10 : -10));
});
function setSidebarWidth(width: number): void {
  const minimum = parseFloat(getComputedStyle(shell).getPropertyValue('--sidebar-min'));
  shell.style.setProperty('--sidebar-width', `${Math.max(minimum, width)}px`);
  syncSidebarResize();
  syncDetailsResize();
}
let sidebarDrag: { pointerId: number; startX: number; startWidth: number } | null = null;
sidebarResize.addEventListener('pointerdown', event => {
  if (event.button !== 0 || sidebarDrag) return;
  sidebarDrag = { pointerId: event.pointerId, startX: event.clientX, startWidth: sidebar.getBoundingClientRect().width };
  sidebarResize.setPointerCapture(event.pointerId);
  document.body.classList.add('resizing-sidebar');
  event.preventDefault();
});
sidebarResize.addEventListener('pointermove', event => {
  if (sidebarDrag?.pointerId === event.pointerId) setSidebarWidth(sidebarDrag.startWidth + event.clientX - sidebarDrag.startX);
});
function endSidebarDrag(event: PointerEvent): void {
  if (sidebarDrag?.pointerId !== event.pointerId) return;
  sidebarDrag = null;
  document.body.classList.remove('resizing-sidebar');
  if (sidebarResize.hasPointerCapture(event.pointerId)) sidebarResize.releasePointerCapture(event.pointerId);
}
sidebarResize.addEventListener('pointerup', endSidebarDrag);
sidebarResize.addEventListener('pointercancel', endSidebarDrag);
sidebarResize.addEventListener('lostpointercapture', endSidebarDrag);
sidebarResize.addEventListener('focus', syncSidebarResize);
sidebarResize.addEventListener('keydown', event => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  setSidebarWidth(sidebar.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? -10 : 10));
});
window.addEventListener('resize', () => { syncSidebarResize(); syncDetailsResize(); });
syncSidebarResize();

const priorityNames: Record<Priority, string> = { high: 'Hoch', normal: 'Normal', low: 'Niedrig' };
let workspace: Workspace = { revision: 0, projects: [], tasks: [], subtasks: [], releases: [] };
let view: View = 'inbox';
let activeTab: TaskKind | 'releases' = 'task';
let pendingReleaseId: number | null = null;
let editingReleaseId: number | null = null;
let editorPublishedReleaseId: number | null = null;
let editorTaskKind: TaskKind = 'task';
let editing: EditorMode | null = null;
let saving = false;
let selectedTaskId: number | null = null;
let selectedReleaseId: number | null = null;
let pendingDeleteReleaseId: number | null = null;
let pendingDeleteTaskId: number | null = null;
let selectedPredecessors = new Set<number>();
let draftCriteria: CriterionFields[] = [];
const releaseStatusNames: Record<ReleaseStatus, string> = { planned: 'Geplant', in_progress: 'In Arbeit', paused: 'Pausiert', published: 'Veröffentlicht' };
const statusNames: Record<TaskStatus, string> = { planned: 'Geplant', in_progress: 'In Arbeit', paused: 'Pausiert', done: 'Erledigt' };
function errorMessage(error: unknown): string {
  const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : '';
  return message ? message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Der Vorgang konnte nicht gespeichert werden.';
}
let noticeTimer: number | undefined;

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

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
        <p class="subtitle">${description}</p>
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
  const kind: TaskKind = project?.kind === 'software' && activeTab !== 'releases' ? activeTab : 'task';
  const tasks = workspace.tasks.filter(task => task.kind === kind && task.projectId === projectId);
  return `<section class="panel task-panel" aria-label="${kind === 'feature' ? 'Features' : kind === 'fix' ? 'Fixes' : 'Aufgaben'}">
    <div class="task-columns" aria-hidden="true"><span></span><span>Titel</span><span>Status</span><span>Priorität</span><span>Fälligkeit</span><span></span></div>
    ${tasks.length
      ? `<ul class="list">${tasks.map(task => taskRow(task)).join('')}</ul>`
      : emptyState(kind === 'feature' ? 'Noch keine Features' : kind === 'fix' ? 'Noch keine Fixes' : project ? 'Hier ist Platz für deine Aufgaben' : 'Dein Posteingang ist leer',
        kind === 'feature' ? 'Beschreibe eine neue Funktion für dieses Softwareprojekt.' : kind === 'fix' ? 'Halte einen Bugfix, ein Refactoring oder eine kleinere Änderung fest.' : project ? 'Halte den nächsten Schritt für dieses Projekt fest.' : 'Erfasse eine Aufgabe und ordne sie später einem Projekt zu.',
        addButton('new-task', kind === 'feature' ? 'Feature anlegen' : kind === 'fix' ? 'Fix anlegen' : 'Aufgabe erfassen', 'secondary'))}
  </section>`;
}

function releasePanel(project: Project): string {
  const releases = workspace.releases.filter(item => item.projectId === project.id);
  return `<section class="panel" aria-labelledby="release-heading"><header class="panel-header"><h2 id="release-heading">Releases</h2><span class="panel-meta">${releases.length} ${releases.length === 1 ? 'Release' : 'Releases'}</span></header>
    ${releases.length ? `<ul class="list">${releases.map(release => {
      const items = workspace.tasks.filter(task => task.releaseId === release.id);
      return `<li class="release-row"><div class="release-heading"><button type="button" class="release-open" data-action="show-release" data-id="${release.id}" aria-label="Release ${escapeHtml(release.version)} öffnen"><strong>${escapeHtml(release.version)}</strong> <span class="muted">${releaseStatusNames[release.status]}</span>${release.dueDate ? `<span class="release-due">Fällig am ${escapeHtml(release.dueDate.split('-').reverse().join('.'))}</span>` : ''}</button><div class="release-actions"><button type="button" class="button compact" data-action="edit-release" data-id="${release.id}" aria-label="Release ${escapeHtml(release.version)} bearbeiten" title="Release bearbeiten">B</button>${release.published ? '' : `<button type="button" class="button compact" data-action="publish-release" data-id="${release.id}" aria-label="Release ${escapeHtml(release.version)} veröffentlichen">Veröffentlichen</button>`}</div></div><ul class="detail-list">${items.length ? items.map(item => `<li><button type="button" class="detail-link" data-action="show-task" data-id="${item.id}">${item.kind === 'task' ? 'Aufgabe' : item.kind === 'fix' ? 'Fix' : 'Feature'} · ${escapeHtml(item.title)} · ${statusNames[item.status]}</button></li>`).join('') : '<li class="muted">Keine Aufgaben, Features oder Fixes zugeordnet</li>'}</ul></li>`;
    }).join('')}</ul>` : emptyState('Noch keine Releases', 'Plane eine Version für dieses Softwareprojekt.', addButton('new-release', 'Release anlegen', 'secondary'))}</section>`;
}
function updateReleaseOptions(show: boolean, selectedId: number | null): void {
  const projectId = projectField.value ? Number(projectField.value) : null;
  show = show && workspace.projects.some(project => project.id === projectId && project.kind === 'software');
  document.querySelector<HTMLElement>('#release-assignment-field')!.hidden = !show;
  const selected = workspace.releases.find(item => item.id === selectedId && item.projectId === projectId);
  const planned = workspace.releases.filter(item => item.projectId === projectId && !item.published);
  editorPublishedReleaseId = show && selected?.published ? selected.id : null;
  targetVersionField.replaceChildren(new Option('Keine Zielversion', ''), ...(editorPublishedReleaseId ? [new Option('Veröffentlichte Zuordnung beibehalten', 'keep-published')] : []), ...planned.map(item => new Option(item.version, String(item.id))));
  targetVersionField.value = editorPublishedReleaseId ? 'keep-published' : selected && !selected.published ? String(selected.id) : '';
  publishedVersion.hidden = !editorPublishedReleaseId;
  publishedVersion.textContent = editorPublishedReleaseId ? `Aktuelles Release: ${selected!.version} (veröffentlicht)` : '';
}
function openReleaseDialog(id: number | null = null): void {
  if (typeof view !== 'number' || workspace.projects.find(project => project.id === view)?.kind !== 'software') return;
  const release = id === null ? undefined : workspace.releases.find(item => item.id === id && item.projectId === view);
  if (id !== null && !release) return;
  editingReleaseId = id;
  releaseTitle.textContent = release ? 'Release bearbeiten' : 'Neues Release';
  releaseVersion.value = release?.version ?? '';
  releaseDue.value = release?.dueDate ?? '';
  document.querySelector<HTMLElement>('#release-status-field')!.hidden = !release;
  releaseStatus.value = release?.status ?? 'planned';
  saveRelease.textContent = release ? 'Speichern' : 'Release anlegen';
  document.querySelector<HTMLElement>('#delete-release-entry')!.hidden = !release;
  releaseError.hidden = true; releaseDialog.showModal(); releaseVersion.focus();
}
document.querySelector('#delete-release-entry')!.addEventListener('click', () => { if (!saving && editingReleaseId !== null) openDeleteReleaseDialog(editingReleaseId); });
for (const id of ['close-release', 'cancel-release']) document.querySelector(`#${id}`)!.addEventListener('click', () => { if (!saving) releaseDialog.close(); });
releaseDialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
releaseForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (saving || typeof view !== 'number') return;
  const id = editingReleaseId;
  saving = true; saveRelease.disabled = true; releaseError.hidden = true;
  try { workspace = id === null ? await window.hq.createRelease(view, releaseVersion.value, releaseDue.value || null, workspace.revision) : await window.hq.renameRelease(id, releaseVersion.value, releaseDue.value || null, releaseStatus.value as ReleaseStatus, workspace.revision); releaseDialog.close(); render(); announce(id === null ? 'Release angelegt.' : 'Release gespeichert.'); }
  catch (error) { releaseError.textContent = errorMessage(error); releaseError.hidden = false; }
  finally { saving = false; saveRelease.disabled = false; }
});
function openPublishDialog(id: number): void {
  const release = workspace.releases.find(item => item.id === id && !item.published);
  if (!release) return;
  pendingReleaseId = id;
  const open = workspace.tasks.filter(item => item.releaseId === id && item.status !== 'done');
  publishDescription.textContent = open.length ? `Diese Einträge blockieren die Veröffentlichung: ${open.map(item => `${item.kind === 'task' ? 'Aufgabe' : item.kind === 'fix' ? 'Fix' : 'Feature'}: ${item.title} (${statusNames[item.status]})`).join('; ')}.` : `„${release.version}“ wird als veröffentlicht markiert und steht nicht mehr für neue Zuordnungen zur Verfügung.`;
  publishError.hidden = true; publishDialog.showModal();
  document.querySelector<HTMLButtonElement>('#cancel-publish')!.focus();
}
document.querySelector('#cancel-publish')!.addEventListener('click', () => { if (!saving) publishDialog.close(); });
publishDialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
confirmPublish.addEventListener('click', async () => {
  if (saving || pendingReleaseId === null) return;
  saving = true; confirmPublish.disabled = true; publishError.hidden = true;
  try { workspace = await window.hq.publishRelease(pendingReleaseId, workspace.revision); publishDialog.close(); pendingReleaseId = null; render(); announce('Release veröffentlicht.'); }
  catch (error) { publishError.textContent = errorMessage(error); publishError.hidden = false; }
  finally { saving = false; confirmPublish.disabled = false; }
});


function openDeleteReleaseDialog(id: number): void {
  const release = workspace.releases.find(item => item.id === id);
  if (!release) return;
  pendingDeleteReleaseId = id;
  deleteReleaseDescription.textContent = `„${release.version}“ wird endgültig gelöscht. Zugeordnete Aufgaben, Features und Fixes bleiben erhalten, ihre Release-Zuordnung wird entfernt.`;
  deleteReleaseError.hidden = true;
  deleteReleaseDialog.showModal();
  cancelDeleteRelease.focus();
}
cancelDeleteRelease.addEventListener('click', () => { if (!saving) deleteReleaseDialog.close(); });
deleteReleaseDialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
confirmDeleteRelease.addEventListener('click', async () => {
  if (saving || pendingDeleteReleaseId === null) return;
  saving = true; confirmDeleteRelease.disabled = true; cancelDeleteRelease.disabled = true; deleteReleaseError.hidden = true;
  try {
    workspace = await window.hq.deleteRelease(pendingDeleteReleaseId, workspace.revision);
    pendingDeleteReleaseId = null; selectedReleaseId = null;
    deleteReleaseDialog.close(); releaseDialog.close(); render();
    content.querySelector('h1')?.focus({ preventScroll: true });
    announce('Release gelöscht.');
  } catch (error) { deleteReleaseError.textContent = errorMessage(error); deleteReleaseError.hidden = false; }
  finally { saving = false; confirmDeleteRelease.disabled = false; cancelDeleteRelease.disabled = false; }
});

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
      ${pageHeading('Projekte', 'Projekte', 'Plane Vorhaben und entscheide, was Vorrang hat.', addButton('new-project', 'Neues Projekt'))}
      <section class="panel" aria-labelledby="project-heading">
        <header class="panel-header">
          <h2 id="project-heading">Meine Projekte</h2>
          <span class="panel-meta">${workspace.projects.length} ${workspace.projects.length === 1 ? 'Projekt' : 'Projekte'}</span>
        </header>
        ${workspace.projects.length
          ? `<ul class="list">${workspace.projects.map(projectRow).join('')}</ul>`
          : emptyState('Noch keine Projekte', 'Lege ein Projekt für dein nächstes Vorhaben an.',
            addButton('new-project', 'Projekt anlegen', 'secondary'))}
      </section>`;
    return;
  }

  const project = workspace.projects.find(item => item.id === view);
  const editProject = project
    ? `<button type="button" class="button secondary" data-action="edit-project" data-id="${project.id}" aria-label="Projekt bearbeiten">B</button>`
    : '';
  const software = project?.kind === 'software';
  const tabs = software ? `<nav class="task-tabs" aria-label="Projektbereich"><button type="button" class="task-tab" data-action="tab-task" aria-pressed="${activeTab === 'task'}">Aufgaben</button><button type="button" class="task-tab" data-action="tab-feature" aria-pressed="${activeTab === 'feature'}">Features</button><button type="button" class="task-tab" data-action="tab-fix" aria-pressed="${activeTab === 'fix'}">Fixes</button><button type="button" class="task-tab" data-action="tab-releases" aria-pressed="${activeTab === 'releases'}">Releases</button></nav>` : '';
  content.innerHTML = `
    ${pageHeading(project?.title ?? 'Posteingang',
      project ? `Projekte / ${project.title}` : 'Posteingang',
      project ? (project.description ? escapeHtml(project.description).replaceAll('\n', '<br>') : 'Deine Aufgaben für dieses Projekt.') : 'Ein Ort für alle Aufgaben ohne Projekt.',
      editProject + (software && activeTab === 'releases' ? addButton('new-release', 'Neues Release') : addButton('new-task', software && activeTab === 'feature' ? 'Neues Feature' : software && activeTab === 'fix' ? 'Neuer Fix' : 'Neue Aufgabe')),
      project ? `<div class="project-priority"><span>Projektpriorität</span>${priorityBadge(project.priority, 'Projektpriorität')}</div>${project.dueDate ? `<div class="project-deadline">Projektfrist: ${escapeHtml(project.dueDate.split('-').reverse().join('.'))}</div>` : ''}` : '')}
    ${tabs}
    ${software && activeTab === 'releases' ? releasePanel(project!) : taskPanel(project)}`;
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
  if (release) {
    const items = workspace.tasks.filter(item => item.releaseId === release.id);
    const list = (kind: TaskKind) => {
      const matching = items.filter(item => item.kind === kind);
      return matching.length ? matching.map(item => `<li><button type="button" class="detail-link" data-action="show-task" data-id="${item.id}">${escapeHtml(item.title)} · ${statusNames[item.status]}</button></li>`).join('') : '<li class="muted">Keine</li>';
    };
    details.innerHTML = `<header class="details-header"><div class="details-heading"><p class="eyebrow">Release</p><h2>${escapeHtml(release.version)}</h2></div><div class="details-actions"><button type="button" class="button compact" data-action="edit-release" data-id="${release.id}" aria-label="Release bearbeiten">B</button><button type="button" class="button compact" data-action="close-details" aria-label="Details schließen">×</button></div></header>
      <div class="details-body"><section><h3>Status</h3><p>${releaseStatusNames[release.status]}</p></section><section><h3>Fällig am</h3><p>${release.dueDate ? escapeHtml(release.dueDate.split('-').reverse().join('.')) : 'Kein Datum'}</p></section>
      <section><h3>Aufgaben</h3><ul class="detail-list">${list('task')}</ul></section><section><h3>Features</h3><ul class="detail-list">${list('feature')}</ul></section><section><h3>Fixes</h3><ul class="detail-list">${list('fix')}</ul></section>
      ${release.published ? '' : `<button type="button" class="button secondary" data-action="publish-release" data-id="${release.id}">Veröffentlichen</button>`}
      </div>`;
    return;
  }
  if (!task) { details.innerHTML = ''; return; }
  const links = (ids: number[]) => workspace.tasks.filter(item => ids.includes(item.id)).map(item => `<li><button type="button" class="detail-link" data-action="show-task" data-id="${item.id}">${escapeHtml(item.title)} · ${statusNames[item.status]}</button></li>`).join('') || '<li class="muted">Keine</li>';
  const subtasks = workspace.subtasks.filter(item => item.taskId === task.id);
  const assignedRelease = workspace.releases.find(item => item.id === task.releaseId);
  const project = workspace.projects.find(item => item.id === task.projectId);
  details.innerHTML = `<header class="details-header"><div class="details-heading"><p class="eyebrow">${task.kind === 'feature' ? 'Feature' : task.kind === 'fix' ? 'Fix' : 'Aufgabe'}</p><h2>${escapeHtml(task.title)}</h2></div><div class="details-actions"><button type="button" class="button compact" data-action="edit-task" data-id="${task.id}" aria-label="${task.kind === 'feature' ? 'Feature' : task.kind === 'fix' ? 'Fix' : 'Aufgabe'} bearbeiten">B</button><button type="button" class="button compact" data-action="close-details" aria-label="Details schließen">×</button></div></header>
    <div class="details-body"><section><h3>Beschreibung</h3><p class="description">${task.description ? escapeHtml(task.description) : 'Keine Beschreibung'}</p></section>
    ${project?.kind === 'software' ? `<section><h3>Zielversion</h3><p>${task.targetVersion ? escapeHtml(task.targetVersion) + (assignedRelease?.published ? ' (veröffentlicht)' : '') : 'Keine Zielversion'}</p></section>` : ''}${task.kind !== 'task' ? `<section><h3>Akzeptanzkriterien</h3><ul class="detail-list">${task.criteria.length ? task.criteria.map(criterion => `<li><label><input type="checkbox" data-criterion="${criterion.id}" ${criterion.completed ? 'checked' : ''}> ${escapeHtml(criterion.text)}</label></li>`).join('') : '<li class="muted">Keine Kriterien</li>'}</ul></section>` : ''}
    <section><h3>Status</h3><p>${statusNames[task.status]}</p></section><section><h3>Fällig am</h3><p>${task.dueDate ? escapeHtml(task.dueDate.split('-').reverse().join('.')) : 'Kein Datum'}</p></section>
    <section><h3>Unteraufgaben</h3><ul class="detail-list">${subtasks.map(item => `<li><label><input type="checkbox" data-subtask="${item.id}" ${item.completed ? 'checked' : ''}> ${escapeHtml(item.title)}</label></li>`).join('')}</ul>
    <form id="subtask-form" class="subtask-form"><label class="sr-only" for="subtask-title">Neue Unteraufgabe</label><input id="subtask-title" maxlength="120" required placeholder="Neue Unteraufgabe"><button class="button compact" type="submit" aria-label="Unteraufgabe anlegen">+</button></form></section>
    <section><h3>Vorgänger</h3><ul class="detail-list">${links(task.predecessorIds)}</ul></section><section><h3>Folgeaufgaben</h3><ul class="detail-list">${links(task.successorIds)}</ul></section>
    </div>`;
}
details.addEventListener('submit', async event => {
  if (!(event.target instanceof HTMLFormElement) || event.target.id !== 'subtask-form' || selectedTaskId === null || saving) return;
  event.preventDefault();
  const input = document.querySelector<HTMLInputElement>('#subtask-title')!;
  saving = true;
  try { workspace = await window.hq.addSubtask(selectedTaskId, input.value, workspace.revision); render(); document.querySelector<HTMLInputElement>('#subtask-title')?.focus(); }
  catch (error) { announce(errorMessage(error), true); }
  finally { saving = false; }
});


function openDeleteDialog(id: number): void {
  const task = workspace.tasks.find(item => item.id === id);
  if (!task) return;
  pendingDeleteTaskId = id;
  const kind = task.kind === 'feature' ? 'Feature' : task.kind === 'fix' ? 'Fix' : 'Aufgabe';
  deleteTitle.textContent = `${kind} löschen?`;
  deleteDescription.textContent = `„${task.title}“ wird endgültig gelöscht. Unteraufgaben${task.kind !== 'task' ? ', Akzeptanzkriterien' : ''} und Verknüpfungen werden entfernt. Verknüpfte Einträge bleiben erhalten.`;
  deleteError.hidden = true;
  deleteDialog.showModal();
  cancelDelete.focus();
}
cancelDelete.addEventListener('click', () => { if (!saving) deleteDialog.close(); });
deleteDialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
confirmDelete.addEventListener('click', async () => {
  if (saving || pendingDeleteTaskId === null) return;
  const task = workspace.tasks.find(item => item.id === pendingDeleteTaskId);
  if (!task) return;
  saving = true;
  confirmDelete.disabled = true;
  cancelDelete.disabled = true;
  deleteError.hidden = true;
  try {
    workspace = await window.hq.deleteTask(task.id, workspace.revision);
    if (selectedTaskId === task.id) selectedTaskId = null;
    pendingDeleteTaskId = null;
    deleteDialog.close();
    editor.close();
    render();
    content.querySelector('h1')?.focus({ preventScroll: true });
    announce(task.kind === 'feature' ? 'Feature gelöscht.' : task.kind === 'fix' ? 'Fix gelöscht.' : 'Aufgabe gelöscht.');
  } catch (error) {
    deleteError.textContent = errorMessage(error);
    deleteError.hidden = false;
  } finally {
    saving = false;
    confirmDelete.disabled = false;
    cancelDelete.disabled = false;
  }
});

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
  noticeTimer = window.setTimeout(() => { notice.hidden = true; }, 4500);
}

function openEditor(mode: EditorMode): void {
  editing = mode;
  const isTask = mode.kind === 'task';
  const task = isTask ? workspace.tasks.find(item => item.id === mode.id) : undefined;
  const entry = isTask ? task : workspace.projects.find(item => item.id === mode.id);
  const currentProject = task ? task.projectId : (typeof view === 'number' ? view : null);
  editorTaskKind = task?.kind ?? (isTask && activeTab !== 'releases' ? activeTab : 'task');
  const isFeature = isTask && editorTaskKind !== 'task';
  const isFix = isTask && editorTaskKind === 'fix';
  document.querySelector<HTMLElement>('#project-kind-field')!.hidden = isTask;
  document.querySelector<HTMLElement>('#project-due-field')!.hidden = isTask;
  projectDueField.value = !isTask ? ((entry as Project | undefined)?.dueDate ?? '') : '';
  renderProjectDueConflicts();
  document.querySelector<HTMLElement>('#feature-fields')!.hidden = !isFeature;
  document.querySelector('#description-label')!.textContent = isFeature ? 'Beschreibung und Nutzen' : 'Beschreibung';

  draftCriteria = isFeature ? (task?.criteria ?? []).map(criterion => ({...criterion})) : [];
  renderCriteriaEditor();
  projectKindField.value = !isTask ? ((entry as Project | undefined)?.kind ?? 'normal') : 'normal';

  document.querySelector('#editor-label')!.textContent = isFix ? 'Fix' : isFeature ? 'Feature' : isTask ? 'Aufgabe' : 'Projekt';
  document.querySelector('#editor-title')!.textContent = isTask
    ? (isFix ? (entry ? 'Fix bearbeiten' : 'Neuer Fix') : isFeature ? (entry ? 'Feature bearbeiten' : 'Neues Feature') : (entry ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'))
    : (entry ? 'Projekt bearbeiten' : 'Neues Projekt');
  document.querySelector<HTMLElement>('#project-field')!.hidden = !isTask;
  titleField.value = entry?.title ?? '';
  titleField.placeholder = isFix ? 'Was soll behoben oder geändert werden?' : isFeature ? 'Welche Funktion soll hinzukommen?' : isTask ? 'Was steht an?' : 'Wie heißt dein Vorhaben?';
  priorityField.value = entry?.priority ?? 'normal';
  descriptionField.value = entry?.description ?? '';
  document.querySelector<HTMLElement>('#task-fields')!.hidden = !isTask;
  dueField.value = task?.dueDate ?? '';
  statusField.value = task?.status ?? 'planned';
  selectedPredecessors = new Set(task?.predecessorIds ?? []);
  renderSelectedPredecessors();
  projectField.replaceChildren(
    ...(isFeature ? [] : [new Option('Posteingang', '')]),
    ...workspace.projects.filter(project => !isFeature || project.kind === 'software').map(project => new Option(project.title, String(project.id))),
  );
  projectField.value = currentProject === null ? '' : String(currentProject);
  updateReleaseOptions(isTask, task?.releaseId ?? null);
  saveButton.textContent = entry ? 'Speichern' : '+';
  saveButton.setAttribute('aria-label', entry ? 'Speichern' : (isFix ? 'Fix anlegen' : isFeature ? 'Feature anlegen' : isTask ? 'Aufgabe anlegen' : 'Projekt anlegen'));
  saveButton.title = entry ? 'Speichern' : (isFix ? 'Fix anlegen' : isFeature ? 'Feature anlegen' : isTask ? 'Aufgabe anlegen' : 'Projekt anlegen');
  document.querySelector<HTMLElement>('#delete-entry')!.hidden = !task;
  editorError.hidden = true;
  editor.showModal();
  titleField.focus();
}





document.querySelector('#delete-entry')!.addEventListener('click', () => { if (!saving && editing?.kind === 'task' && editing.id !== null) openDeleteDialog(editing.id); });

function projectDueConflicts(): Task[] {
  if (!editing || editing.kind !== 'project' || editing.id === null || !projectDueField.value) return [];
  const deadline = projectDueField.value;
  return workspace.tasks.filter(task => task.projectId === editing!.id && task.dueDate !== null && task.dueDate > deadline)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!) || a.id - b.id);
}
function renderProjectDueConflicts(): void {
  const conflicts = projectDueConflicts();
  projectDueConflictBox.hidden = conflicts.length === 0;
  projectDueConflictBox.innerHTML = conflicts.length ? `<p>Diese Einträge sind nach der Projektfrist fällig. Schließe den Dialog und passe ihre Fälligkeiten an:</p><ul>${conflicts.map(task => `<li>${task.kind === 'feature' ? 'Feature' : task.kind === 'fix' ? 'Fix' : 'Aufgabe'}: ${escapeHtml(task.title)} · ${escapeHtml(task.dueDate!.split('-').reverse().join('.'))}</li>`).join('')}</ul>` : '';
}
projectDueField.addEventListener('input', renderProjectDueConflicts);
projectDueField.addEventListener('change', renderProjectDueConflicts);

projectField.addEventListener('change', () => { updateReleaseOptions(editing?.kind === 'task', null); });

function renderCriteriaEditor(): void {
  criteriaField.innerHTML = draftCriteria.map((criterion, index) => `<div class="criterion-row"><label class="criterion-check"><input type="checkbox" data-criterion-check="${index}" ${criterion.completed ? 'checked' : ''} aria-label="Kriterium ${index + 1} erfüllt"></label><label class="criterion-text"><span class="sr-only">Akzeptanzkriterium ${index + 1}</span><input type="text" required maxlength="1000" data-criterion-text="${index}" value="${escapeHtml(criterion.text)}" placeholder="Prüfbares Kriterium"></label><button type="button" class="button compact" data-remove-criterion="${index}" aria-label="Kriterium ${index + 1} entfernen">−</button></div>`).join('');
}
document.querySelector<HTMLButtonElement>('#add-criterion')!.addEventListener('click', () => {
  draftCriteria.push({id:null, text:'', completed:false});
  renderCriteriaEditor();
  criteriaField.querySelector<HTMLInputElement>(`[data-criterion-text="${draftCriteria.length - 1}"]`)?.focus();
});
criteriaField.addEventListener('input', event => {
  if (!(event.target instanceof HTMLInputElement) || event.target.dataset.criterionText === undefined) return;
  const criterion = draftCriteria[Number(event.target.dataset.criterionText)];
  if (criterion) criterion.text = event.target.value;
});
criteriaField.addEventListener('change', event => {
  if (!(event.target instanceof HTMLInputElement) || event.target.dataset.criterionCheck === undefined) return;
  const criterion = draftCriteria[Number(event.target.dataset.criterionCheck)];
  if (criterion) criterion.completed = event.target.checked;
});
criteriaField.addEventListener('click', event => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest<HTMLButtonElement>('[data-remove-criterion]');
  if (button) { draftCriteria.splice(Number(button.dataset.removeCriterion), 1); renderCriteriaEditor(); }
});

function renderSelectedPredecessors(): void {
  const selected = workspace.tasks.filter(task => selectedPredecessors.has(task.id));
  predecessorField.innerHTML = selected.length ? selected.map(task => {
    const project = workspace.projects.find(item => item.id === task.projectId);
    return `<div class="selected-predecessor"><span>${escapeHtml(task.title)} <span class="muted">· ${escapeHtml(project?.title ?? 'Posteingang')}</span></span><button type="button" class="button compact" data-remove-predecessor="${task.id}" aria-label="${escapeHtml(task.title)} als Vorgänger entfernen">−</button></div>`;
  }).join('') : '<span class="muted">Keine Vorgänger</span>';
}
function updatePredecessorTasks(): void {
  const selectedProject = predecessorProject.value;
  const available = selectedProject === '' ? [] : workspace.tasks.filter(task =>
    task.id !== editing?.id && !selectedPredecessors.has(task.id) &&
    (selectedProject === 'inbox' ? task.projectId === null : task.projectId === Number(selectedProject)));
  predecessorTask.replaceChildren(new Option('Aufgabe auswählen', ''), ...available.map(task => new Option(task.title, String(task.id))));
  predecessorTask.disabled = selectedProject === '' || available.length === 0;
  predecessorEmpty.hidden = selectedProject === '' || available.length > 0;
  confirmPredecessor.disabled = true;
}
document.querySelector<HTMLButtonElement>('#add-predecessor')!.addEventListener('click', () => {
  predecessorProject.replaceChildren(new Option('Projekt auswählen', ''), new Option('Posteingang', 'inbox'), ...workspace.projects.map(project => new Option(project.title, String(project.id))));
  updatePredecessorTasks();
  predecessorDialog.showModal();
  predecessorProject.focus();
});
predecessorProject.addEventListener('change', updatePredecessorTasks);
predecessorTask.addEventListener('change', () => { confirmPredecessor.disabled = !predecessorTask.value; });
for (const id of ['close-predecessor', 'cancel-predecessor']) document.querySelector(`#${id}`)!.addEventListener('click', () => predecessorDialog.close());
predecessorField.addEventListener('click', event => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest<HTMLButtonElement>('[data-remove-predecessor]');
  if (button) { selectedPredecessors.delete(Number(button.dataset.removePredecessor)); renderSelectedPredecessors(); }
});
document.querySelector<HTMLFormElement>('#predecessor-form')!.addEventListener('submit', event => {
  event.preventDefault();
  if (!predecessorTask.value) return;
  selectedPredecessors.add(Number(predecessorTask.value));
  renderSelectedPredecessors();
  predecessorDialog.close();
});

document.addEventListener('click', event => {
  if (!(event.target instanceof Element)) return;
  const target = event.target.closest<HTMLButtonElement>('button[data-view], button[data-action]');
  if (!target || saving) return;

  const destination = target.dataset.view;
  if (destination) {
    showView(destination === 'inbox' || destination === 'projects' || destination === 'ideas' || destination === 'research' ? destination : Number(destination));
    return;
  }

  switch (target.dataset.action) {
    case 'tab-task': activeTab = 'task'; selectedTaskId = null; selectedReleaseId = null; render(); break;
    case 'tab-feature': activeTab = 'feature'; selectedTaskId = null; selectedReleaseId = null; render(); break;
    case 'tab-releases': activeTab = 'releases'; selectedTaskId = null; selectedReleaseId = null; render(); break;
    case 'show-release': selectedTaskId = null; selectedReleaseId = Number(target.dataset.id); renderDetails(); break;
    case 'new-release': openReleaseDialog(); break;
    case 'edit-release': openReleaseDialog(Number(target.dataset.id)); break;
    case 'publish-release': openPublishDialog(Number(target.dataset.id)); break;
    case 'tab-fix': activeTab = 'fix'; selectedTaskId = null; selectedReleaseId = null; render(); break;
    case 'show-task': selectedReleaseId = null; selectedTaskId = Number(target.dataset.id); renderDetails(); break;
    case 'close-details': selectedTaskId = null; selectedReleaseId = null; renderDetails(); break;
    case 'new-task': openEditor({ kind: 'task', id: null }); break;
    case 'edit-task': openEditor({ kind: 'task', id: Number(target.dataset.id) }); break;
    case 'new-project': openEditor({ kind: 'project', id: null }); break;
    case 'edit-project': openEditor({ kind: 'project', id: Number(target.dataset.id) }); break;
  }
});

document.addEventListener('change', async event => {
  const checkbox = event.target;
  if (!(checkbox instanceof HTMLInputElement)) return;
  if (checkbox.dataset.criterion) {
    const checked = checkbox.checked;
    if (saving) { checkbox.checked = !checked; return; }
    saving = true;
    checkbox.disabled = true;
    try { workspace = await window.hq.completeCriterion(Number(checkbox.dataset.criterion), checked, workspace.revision); render(); }
    catch (error) { checkbox.checked = !checked; announce(errorMessage(error), true); }
    finally { checkbox.disabled = false; saving = false; }
    return;
  }
  if (checkbox.dataset.subtask) {
    const checked = checkbox.checked;
    if (saving) { checkbox.checked = !checked; return; }
    saving = true;
    checkbox.disabled = true;
    try { workspace = await window.hq.completeSubtask(Number(checkbox.dataset.subtask), checked, workspace.revision); render(); }
    catch (error) { checkbox.checked = !checked; announce(errorMessage(error), true); }
    finally { checkbox.disabled = false; saving = false; }
    return;
  }
  if (!checkbox.dataset.complete) return;
  if (saving) {
    checkbox.checked = !checkbox.checked;
    return;
  }

  const id = Number(checkbox.dataset.complete);
  const completed = checkbox.checked;
  saving = true;
  checkbox.disabled = true;
  try {
    workspace = await window.hq.completeTask(id, completed, workspace.revision);
    render();
    content.querySelector<HTMLInputElement>(`[data-complete="${id}"]`)?.focus({ preventScroll: true });
    announce(completed ? 'Aufgabe erledigt.' : 'Aufgabe wieder geöffnet.');
  } catch (error) {
    checkbox.checked = !completed;
    announce(errorMessage(error), true);
  } finally {
    checkbox.disabled = false;
    saving = false;
  }
});

for (const id of ['close-editor', 'cancel-editor']) {
  document.querySelector(`#${id}`)!.addEventListener('click', () => {
    if (!saving) {
      editing = null;
      editor.close();
    }
  });
}

editor.addEventListener('cancel', event => {
  if (saving) event.preventDefault();
  else editing = null;
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!editor.open || !editing || saving) return;
  const title = titleField.value.trim();
  if (!title) {
    editorError.textContent = 'Gib einen Namen ein.';
    editorError.hidden = false;
    titleField.focus();
    return;
  }

  if (editing.kind === 'project' && projectDueConflicts().length) {
    renderProjectDueConflicts();
    editorError.textContent = 'Passe zuerst die Fälligkeiten der aufgeführten Einträge an.';
    editorError.hidden = false;
    projectDueField.focus();
    return;
  }
  const fields = { title, priority: priorityField.value as Priority, description: descriptionField.value };
  const mode = editing;
  const projectId = projectField.value ? Number(projectField.value) : null;
  saving = true;
  editorFields.disabled = true;
  saveButton.disabled = true;
  editorError.hidden = true;
  try {
    if (mode.kind === 'project') {
      const previousIds = new Set(workspace.projects.map(project => project.id));
      workspace = await window.hq.saveProject(mode.id, { ...fields, kind: projectKindField.value as ProjectKind, dueDate: projectDueField.value || null }, workspace.revision);
      editing = null;
      editor.close();
      const newProject = workspace.projects.find(project => !previousIds.has(project.id));
      showView(newProject?.id ?? view);
      announce(mode.id === null ? 'Projekt angelegt.' : 'Projekt gespeichert.');
    } else {
      workspace = await window.hq.saveTask(mode.id, { ...fields, kind: editorTaskKind, featureId: null, releaseId: targetVersionField.value === 'keep-published' ? editorPublishedReleaseId : targetVersionField.value ? Number(targetVersionField.value) : null, criteria: editorTaskKind !== 'task' ? draftCriteria : [], projectId, dueDate: dueField.value || null, status: statusField.value as TaskStatus, predecessorIds: [...selectedPredecessors] }, workspace.revision);
      editing = null;
      editor.close();
      render();
      content.querySelector('h1')?.focus({ preventScroll: true });
      const moved = (view === 'inbox' ? projectId !== null : projectId !== view);
      announce(mode.id === null ? (editorTaskKind === 'feature' ? 'Feature angelegt.' : editorTaskKind === 'fix' ? 'Fix angelegt.' : 'Aufgabe angelegt.') : moved ? 'Eintrag verschoben.' : 'Eintrag gespeichert.');
    }
  } catch (error) {
    editorError.textContent = errorMessage(error);
    editorError.hidden = false;
  } finally {
    saving = false;
    editorFields.disabled = false;
    saveButton.disabled = false;
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
  if (!canRefreshWorkspace()) return;
  void window.hq.read().then(data => {
    if (canRefreshWorkspace() && data.revision > workspace.revision) { workspace = data; render(); }
  }).catch(() => {});
}, 2000);
