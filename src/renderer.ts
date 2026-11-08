type Priority = import('./shared').Priority;
type Project = import('./shared').Project;
type Task = import('./shared').Task;
type Workspace = import('./shared').Workspace;
type CriterionFields = import('./shared').CriterionFields;
type TaskKind = import('./shared').TaskKind;
type ProjectKind = import('./shared').ProjectKind;
type TaskStatus = import('./shared').TaskStatus;
type HqApi = import('./shared').HqApi;
type View = 'inbox' | 'projects' | 'ideas' | 'research' | number;
type EditorMode = { kind: 'project'; id: number | null } | { kind: 'task'; id: number | null; featureId?: number };

interface Window {
  hq: HqApi;
}

const releaseDialog = document.querySelector<HTMLDialogElement>('#release-dialog')!;
const releaseForm = document.querySelector<HTMLFormElement>('#release-form')!;
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
const featureTaskDialog = document.querySelector<HTMLDialogElement>('#feature-task-dialog')!;
const existingFeatureTask = document.querySelector<HTMLSelectElement>('#existing-feature-task')!;
const assignFeatureTask = document.querySelector<HTMLButtonElement>('#assign-feature-task')!;
const featureTaskError = document.querySelector<HTMLElement>('#feature-task-error')!;
const taskFeatureField = document.querySelector<HTMLSelectElement>('#entry-task-feature')!;
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
const projectKindField = document.querySelector<HTMLSelectElement>('#entry-project-kind')!;
const projectField = document.querySelector<HTMLSelectElement>('#entry-project')!;
const editorFields = document.querySelector<HTMLFieldSetElement>('#editor-fields')!;
const editorError = document.querySelector<HTMLElement>('#editor-error')!;
const saveButton = document.querySelector<HTMLButtonElement>('#save-entry')!;

const priorityNames: Record<Priority, string> = { high: 'Hoch', normal: 'Normal', low: 'Niedrig' };
let workspace: Workspace = { projects: [], tasks: [], subtasks: [], releases: [] };
let view: View = 'inbox';
let activeTab: TaskKind | 'releases' = 'task';
let pendingReleaseId: number | null = null;
let editingReleaseId: number | null = null;
let editorPublishedReleaseId: number | null = null;
let editorTaskKind: TaskKind = 'task';
let editing: EditorMode | null = null;
let saving = false;
let selectedTaskId: number | null = null;
let selectedPredecessors = new Set<number>();
let draftCriteria: CriterionFields[] = [];
const statusNames: Record<TaskStatus, string> = { planned: 'Geplant', in_progress: 'In Arbeit', paused: 'Pausiert', done: 'Erledigt' };
function errorMessage(error: unknown): string { return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Der Vorgang konnte nicht gespeichert werden.'; }
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

function stat(label: string, value: number, color: string): string {
  return `<div class="stat"><dt>${label}</dt><dd class="${color}">${value}</dd></div>`;
}

function emptyState(title: string, description: string, action: string): string {
  return `<div class="empty">
    <div class="empty-title"><span aria-hidden="true">//</span><strong>${title}</strong></div>
    <p>${description}</p>
    ${action}
  </div>`;
}

function taskRow(task: Task, depth = 0, showProject = false): string {
  const title = escapeHtml(task.title);
  return `<li class="task-row" data-completed="${task.completed}">
    <label class="check">
      <input type="checkbox" data-complete="${task.id}" aria-label="${title} erledigt"${task.completed ? ' checked' : ''}>
      <span class="check-glyph" aria-hidden="true"></span>
    </label>
    <button type="button" class="task-title task-open${task.predecessorIds.length ? ' has-predecessor' : ''}" data-action="show-task" data-id="${task.id}">${'<span class="task-indent" aria-hidden="true"></span>'.repeat(depth)}${task.predecessorIds.length ? '<span class="dependency-marker" aria-label="Hat Vorgänger">↳</span>' : ''}<span class="task-title-text">${title}</span></button>
    <span class="task-meta">${showProject ? `<span class="task-project">${escapeHtml(workspace.projects.find(project => project.id === task.projectId)?.title ?? 'Posteingang')}</span>` : ''}<span class="task-status">${statusNames[task.status]}</span>${priorityBadge(task.priority)}${task.dueDate ? `<span class="task-due">${escapeHtml(task.dueDate.split('-').reverse().join('.'))}</span>` : ''}</span>
    <button type="button" class="button compact" data-action="edit-task" data-id="${task.id}" aria-label="${title} bearbeiten">B</button>
  </li>`;
}

// Prefer the most downstream visible predecessor, preserving chains when a task
// also links to an ancestor. Unrelated predecessors use due-date order.
function orderTaskTree(tasks: Task[]): Array<{ task: Task; depth: number }> {
  const sorted = tasks.map((task, index) => ({ task, index })).sort((a, b) => {
    if (a.task.dueDate === null && b.task.dueDate !== null) return 1;
    if (a.task.dueDate !== null && b.task.dueDate === null) return -1;
    return (a.task.dueDate ?? '').localeCompare(b.task.dueDate ?? '') || a.index - b.index;
  }).map(item => item.task);
  const order = new Map(sorted.map((task, index) => [task.id, index]));
  const byId = new Map(sorted.map(task => [task.id, task]));
  const isAncestor = (ancestor: number, descendant: number): boolean => {
    const pending = [...(byId.get(descendant)?.predecessorIds ?? [])];
    const visited = new Set<number>();
    while (pending.length) {
      const id = pending.pop()!;
      if (id === ancestor) return true;
      if (visited.has(id)) continue;
      visited.add(id);
      pending.push(...(byId.get(id)?.predecessorIds ?? []));
    }
    return false;
  };
  const children = new Map<number, Task[]>();
  const roots: Task[] = [];
  for (const task of sorted) {
    const visibleParents = task.predecessorIds.filter(id => order.has(id));
    visibleParents.sort((a, b) => order.get(a)! - order.get(b)!);
    if (visibleParents.length === 0) roots.push(task);
    else {
      const parent = visibleParents.find(candidate =>
        !visibleParents.some(other => other !== candidate && isAncestor(candidate, other))) ?? visibleParents[0];
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent)!.push(task);
    }
  }
  const result: Array<{ task: Task; depth: number }> = [];
  const pending = roots.slice().reverse().map(task => ({ task, depth: 0 }));
  const visited = new Set<number>();
  const traverse = () => {
    while (pending.length) {
      const current = pending.pop()!;
      if (visited.has(current.task.id)) continue;
      visited.add(current.task.id);
      result.push(current);
      const next = children.get(current.task.id) ?? [];
      for (let i = next.length - 1; i >= 0; i--) pending.push({ task: next[i], depth: current.depth + 1 });
    }
  };
  traverse();
  // Defensive fallback keeps malformed or cyclic data visible.
  for (const task of sorted) {
    if (!visited.has(task.id)) { pending.push({ task, depth: 0 }); traverse(); }
  }
  return result;
}

function taskPanel(project: Project | undefined): string {
  const projectId = project?.id ?? null;
  const kind: TaskKind = project?.kind === 'software' && activeTab !== 'releases' ? activeTab : 'task';
  const available = workspace.tasks.filter(task => task.kind === kind);
  const ownTasks = available.filter(task => task.projectId === projectId);
  const connected = new Set(ownTasks.map(task => task.id));
  const neighbors = new Map<number, number[]>();
  const addNeighbor = (id: number, neighbor: number) => {
    if (!neighbors.has(id)) neighbors.set(id, []);
    neighbors.get(id)!.push(neighbor);
  };
  const availableIds = new Set(available.map(task => task.id));
  for (const task of available) for (const predecessor of task.predecessorIds) {
    if (!availableIds.has(predecessor)) continue;
    addNeighbor(task.id, predecessor);
    addNeighbor(predecessor, task.id);
  }
  const pending = [...connected];
  while (pending.length) for (const neighbor of neighbors.get(pending.pop()!) ?? []) {
    if (!connected.has(neighbor)) { connected.add(neighbor); pending.push(neighbor); }
  }
  const tasks = available.filter(task => connected.has(task.id));
  const linkedCount = tasks.length - ownTasks.length;
  const open = ownTasks.filter(task => !task.completed);
  return `
    <dl class="stats">
      ${stat('Offen', open.length, 'accent-secondary')}
      ${stat('Hohe Priorität', open.filter(task => task.priority === 'high').length, 'accent-priority')}
      ${stat('Erledigt', ownTasks.length - open.length, 'accent-primary')}
    </dl>
    <section class="panel" aria-labelledby="task-heading">
      <header class="panel-header">
        <h2 id="task-heading">${kind === 'feature' ? 'Features' : kind === 'fix' ? 'Fixes' : 'Aufgaben'}</h2>
        <span class="panel-meta">${ownTasks.length} ${ownTasks.length === 1 ? 'Eintrag' : 'Einträge'}${linkedCount ? ` · ${linkedCount} verknüpft` : ''}</span>
      </header>
      ${tasks.length
        ? `<ul class="list">${orderTaskTree(tasks).map(({ task, depth }) => taskRow(task, depth, task.projectId !== projectId)).join('')}</ul>`
        : emptyState(kind === 'feature' ? 'Noch keine Features' : kind === 'fix' ? 'Noch keine Fixes' : project ? 'Hier ist Platz für deine Aufgaben' : 'Dein Posteingang ist leer',
          kind === 'feature' ? 'Beschreibe eine neue Funktion für dieses Softwareprojekt.' : kind === 'fix' ? 'Halte einen Bugfix, ein Refactoring oder eine kleinere Änderung fest.' : project ? 'Halte den nächsten Schritt für dieses Projekt fest.' : 'Erfasse eine Aufgabe und ordne sie später einem Projekt zu.',
          addButton('new-task', kind === 'feature' ? 'Feature anlegen' : kind === 'fix' ? 'Fix anlegen' : 'Aufgabe erfassen', 'secondary'))}
    </section>`;
}


function releasePanel(project: Project): string {
  const releases = workspace.releases.filter(item => item.projectId === project.id);
  return `<section class="panel" aria-labelledby="release-heading"><header class="panel-header"><h2 id="release-heading">Releases</h2><span class="panel-meta">${releases.length} ${releases.length === 1 ? 'Release' : 'Releases'}</span></header>
    ${releases.length ? `<ul class="list">${releases.map(release => {
      const items = workspace.tasks.filter(task => task.releaseId === release.id && task.kind !== 'task');
      return `<li class="release-row"><div class="release-heading"><div><strong>${escapeHtml(release.version)}</strong> <span class="muted">${release.published ? 'Veröffentlicht' : 'Geplant'}</span>${release.dueDate ? `<span class="release-due">Fällig am ${escapeHtml(release.dueDate.split('-').reverse().join('.'))}</span>` : ''}</div><div class="release-actions"><button type="button" class="button compact" data-action="edit-release" data-id="${release.id}" aria-label="Release ${escapeHtml(release.version)} bearbeiten" title="Release bearbeiten">B</button>${release.published ? '' : `<button type="button" class="button compact" data-action="publish-release" data-id="${release.id}" aria-label="Release ${escapeHtml(release.version)} veröffentlichen">Veröffentlichen</button>`}</div></div><ul class="detail-list">${items.length ? items.map(item => `<li><button type="button" class="detail-link" data-action="show-task" data-id="${item.id}">${item.kind === 'fix' ? 'Fix' : 'Feature'} · ${escapeHtml(item.title)} · ${statusNames[item.status]}</button></li>`).join('') : '<li class="muted">Keine Features oder Fixes zugeordnet</li>'}</ul></li>`;
    }).join('')}</ul>` : emptyState('Noch keine Releases', 'Plane eine Version für dieses Softwareprojekt.', addButton('new-release', 'Release anlegen', 'secondary'))}</section>`;
}
function updateReleaseOptions(show: boolean, selectedId: number | null): void {
  const projectId = projectField.value ? Number(projectField.value) : null;
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
  saveRelease.textContent = release ? 'Speichern' : 'Release anlegen';
  releaseError.hidden = true; releaseDialog.showModal(); releaseVersion.focus();
}
for (const id of ['close-release', 'cancel-release']) document.querySelector(`#${id}`)!.addEventListener('click', () => { if (!saving) releaseDialog.close(); });
releaseDialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
releaseForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (saving || typeof view !== 'number') return;
  const id = editingReleaseId;
  saving = true; saveRelease.disabled = true; releaseError.hidden = true;
  try { workspace = id === null ? await window.hq.createRelease(view, releaseVersion.value, releaseDue.value || null) : await window.hq.renameRelease(id, releaseVersion.value, releaseDue.value || null); releaseDialog.close(); render(); announce(id === null ? 'Release angelegt.' : 'Release gespeichert.'); }
  catch (error) { releaseError.textContent = errorMessage(error); releaseError.hidden = false; }
  finally { saving = false; saveRelease.disabled = false; }
});
function openPublishDialog(id: number): void {
  const release = workspace.releases.find(item => item.id === id && !item.published);
  if (!release) return;
  pendingReleaseId = id;
  publishDescription.textContent = `„${release.version}“ wird als veröffentlicht markiert und steht nicht mehr für neue Zuordnungen zur Verfügung.`;
  publishError.hidden = true; publishDialog.showModal();
  document.querySelector<HTMLButtonElement>('#cancel-publish')!.focus();
}
document.querySelector('#cancel-publish')!.addEventListener('click', () => { if (!saving) publishDialog.close(); });
publishDialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
confirmPublish.addEventListener('click', async () => {
  if (saving || pendingReleaseId === null) return;
  saving = true; confirmPublish.disabled = true; publishError.hidden = true;
  try { workspace = await window.hq.publishRelease(pendingReleaseId); publishDialog.close(); pendingReleaseId = null; render(); announce('Release veröffentlicht.'); }
  catch (error) { publishError.textContent = errorMessage(error); publishError.hidden = false; }
  finally { saving = false; confirmPublish.disabled = false; }
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
      project ? `<div class="project-priority"><span>Projektpriorität</span>${priorityBadge(project.priority, 'Projektpriorität')}</div>` : '')}
    ${tabs}
    ${software && activeTab === 'releases' ? releasePanel(project!) : taskPanel(project)}`;
}


function renderDetails(): void {
  const task = workspace.tasks.find(item => item.id === selectedTaskId);
  details.hidden = !task;
  document.querySelector('.shell')!.classList.toggle('with-details', !!task);
  if (!task) { details.innerHTML = ''; return; }
  const links = (ids: number[]) => workspace.tasks.filter(item => ids.includes(item.id)).map(item => `<li><button type="button" class="detail-link" data-action="show-task" data-id="${item.id}">${escapeHtml(item.title)} · ${statusNames[item.status]}</button></li>`).join('') || '<li class="muted">Keine</li>';
  const subtasks = workspace.subtasks.filter(item => item.taskId === task.id);
  const associated = workspace.tasks.filter(item => item.kind === 'task' && item.featureId === task.id);
  const assignedRelease = workspace.releases.find(item => item.id === task.releaseId);
  const project = workspace.projects.find(item => item.id === task.projectId);
  const feature = workspace.tasks.find(item => item.id === task.featureId && item.kind !== 'task');
  const availableFeatures = workspace.tasks.filter(item => item.projectId === task.projectId && item.kind !== 'task');
  const association = task.kind !== 'task'
    ? `<section><div class="association-header"><h3>Zugehörige Aufgaben</h3><button type="button" class="button compact" data-action="add-feature-task" aria-label="Aufgabe zu ${task.kind === 'fix' ? 'Fix' : 'Feature'} hinzufügen">+</button></div><ul class="detail-list">${associated.length ? associated.map(item => `<li><button type="button" class="detail-link" data-action="show-task" data-id="${item.id}">${escapeHtml(item.title)} · ${statusNames[item.status]}</button></li>`).join('') : '<li class="muted">Keine zugehörigen Aufgaben</li>'}</ul></section>`
    : project?.kind === 'software' ? `<section><h3>${feature?.kind === 'fix' ? 'Zugehöriger Fix' : 'Zugehöriges Feature oder Fix'}</h3>${feature ? `<p><button type="button" class="detail-link" data-action="show-task" data-id="${feature.id}">${escapeHtml(feature.title)}</button></p>` : '<p class="muted">Kein Feature oder Fix zugeordnet</p>'}<label class="field extra-field"><span>Zuordnung ändern oder lösen</span><select data-feature-assignment="${task.id}"><option value="">Kein Feature oder Fix</option>${availableFeatures.map(item => `<option value="${item.id}"${item.id === task.featureId ? ' selected' : ''}>${item.kind === 'fix' ? 'Fix · ' : 'Feature · '}${escapeHtml(item.title)}</option>`).join('')}</select></label></section>` : '';
  details.innerHTML = `<header class="details-header"><div class="details-heading"><p class="eyebrow">${task.kind === 'feature' ? 'Feature' : task.kind === 'fix' ? 'Fix' : 'Aufgabe'}</p><h2>${escapeHtml(task.title)}</h2></div><div class="details-actions"><button type="button" class="button compact" data-action="edit-task" data-id="${task.id}" aria-label="${task.kind === 'feature' ? 'Feature' : task.kind === 'fix' ? 'Fix' : 'Aufgabe'} bearbeiten">B</button><button type="button" class="button compact" data-action="close-details" aria-label="Details schließen">×</button></div></header>
    <div class="details-body"><section><h3>Beschreibung</h3><p class="description">${task.description ? escapeHtml(task.description) : 'Keine Beschreibung'}</p></section>
    ${task.kind !== 'task' ? `<section><h3>Zielversion</h3><p>${task.targetVersion ? escapeHtml(task.targetVersion) + (assignedRelease?.published ? ' (veröffentlicht)' : '') : 'Keine Zielversion'}</p></section><section><h3>Akzeptanzkriterien</h3><ul class="detail-list">${task.criteria.length ? task.criteria.map(criterion => `<li><label><input type="checkbox" data-criterion="${criterion.id}" ${criterion.completed ? 'checked' : ''}> ${escapeHtml(criterion.text)}</label></li>`).join('') : '<li class="muted">Keine Kriterien</li>'}</ul></section>` : ''}
    ${association}
    <section><h3>Status</h3><p>${statusNames[task.status]}</p></section><section><h3>Fällig am</h3><p>${task.dueDate ? escapeHtml(task.dueDate.split('-').reverse().join('.')) : 'Kein Datum'}</p></section>
    <section><h3>Unteraufgaben</h3><ul class="detail-list">${subtasks.map(item => `<li><label><input type="checkbox" data-subtask="${item.id}" ${item.completed ? 'checked' : ''}> ${escapeHtml(item.title)}</label></li>`).join('')}</ul>
    <form id="subtask-form" class="subtask-form"><label class="sr-only" for="subtask-title">Neue Unteraufgabe</label><input id="subtask-title" maxlength="120" required placeholder="Neue Unteraufgabe"><button class="button compact" type="submit" aria-label="Unteraufgabe anlegen">+</button></form></section>
    <section><h3>Vorgänger</h3><ul class="detail-list">${links(task.predecessorIds)}</ul></section><section><h3>Folgeaufgaben</h3><ul class="detail-list">${links(task.successorIds)}</ul></section>
    <button type="button" class="button danger" data-action="delete-task" data-id="${task.id}" aria-label="${task.kind === 'feature' ? 'Feature' : task.kind === 'fix' ? 'Fix' : 'Aufgabe'} löschen">Löschen</button></div>`;
}
details.addEventListener('submit', async event => {
  if (!(event.target instanceof HTMLFormElement) || event.target.id !== 'subtask-form' || selectedTaskId === null || saving) return;
  event.preventDefault();
  const input = document.querySelector<HTMLInputElement>('#subtask-title')!;
  saving = true;
  try { workspace = await window.hq.addSubtask(selectedTaskId, input.value); render(); document.querySelector<HTMLInputElement>('#subtask-title')?.focus(); }
  catch (error) { announce(errorMessage(error), true); }
  finally { saving = false; }
});


function openDeleteDialog(id: number): void {
  const task = workspace.tasks.find(item => item.id === id);
  if (!task) return;
  const kind = task.kind === 'feature' ? 'Feature' : task.kind === 'fix' ? 'Fix' : 'Aufgabe';
  deleteTitle.textContent = `${kind} löschen?`;
  deleteDescription.textContent = `„${task.title}“ wird endgültig gelöscht. Unteraufgaben${task.kind !== 'task' ? ', Akzeptanzkriterien und die Zuordnung zugehöriger Aufgaben' : ''} und Verknüpfungen werden entfernt. Verknüpfte Einträge bleiben erhalten.`;
  deleteError.hidden = true;
  deleteDialog.showModal();
  cancelDelete.focus();
}
cancelDelete.addEventListener('click', () => { if (!saving) deleteDialog.close(); });
deleteDialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
confirmDelete.addEventListener('click', async () => {
  if (saving || selectedTaskId === null) return;
  const task = workspace.tasks.find(item => item.id === selectedTaskId);
  if (!task) return;
  saving = true;
  confirmDelete.disabled = true;
  cancelDelete.disabled = true;
  deleteError.hidden = true;
  try {
    workspace = await window.hq.deleteTask(task.id);
    selectedTaskId = null;
    deleteDialog.close();
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
  const sourceFeature = mode.kind === 'task' && mode.featureId ? workspace.tasks.find(item => item.id === mode.featureId && item.kind !== 'task') : undefined;
  const currentProject = task ? task.projectId : sourceFeature ? sourceFeature.projectId : (typeof view === 'number' ? view : null);
  editorTaskKind = task?.kind ?? (isTask && !sourceFeature && activeTab !== 'releases' ? activeTab : 'task');
  const isFeature = isTask && editorTaskKind !== 'task';
  const isFix = isTask && editorTaskKind === 'fix';
  document.querySelector<HTMLElement>('#project-kind-field')!.hidden = isTask;
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
  updateEditorFeatures(isTask && !isFeature, task?.featureId ?? sourceFeature?.id ?? null);
  updateReleaseOptions(isFeature, task?.releaseId ?? null);
  saveButton.textContent = entry ? 'Speichern' : '+';
  saveButton.setAttribute('aria-label', entry ? 'Speichern' : (isFix ? 'Fix anlegen' : isFeature ? 'Feature anlegen' : isTask ? 'Aufgabe anlegen' : 'Projekt anlegen'));
  saveButton.title = entry ? 'Speichern' : (isFix ? 'Fix anlegen' : isFeature ? 'Feature anlegen' : isTask ? 'Aufgabe anlegen' : 'Projekt anlegen');
  editorError.hidden = true;
  editor.showModal();
  titleField.focus();
}




function updateEditorFeatures(show: boolean, selected: number | null): void {
  const projectId = projectField.value ? Number(projectField.value) : null;
  const project = workspace.projects.find(item => item.id === projectId);
  document.querySelector<HTMLElement>('#task-feature-field')!.hidden = !show || project?.kind !== 'software';
  const features = workspace.tasks.filter(item => item.kind !== 'task' && item.projectId === projectId);
  taskFeatureField.replaceChildren(new Option('Kein Feature oder Fix', ''), ...features.map(item => new Option(`${item.kind === 'fix' ? 'Fix' : 'Feature'} · ${item.title}`, String(item.id))));
  taskFeatureField.value = features.some(item => item.id === selected) ? String(selected) : '';
}
projectField.addEventListener('change', () => { updateEditorFeatures(editing?.kind === 'task' && editorTaskKind === 'task', null); updateReleaseOptions(editing?.kind === 'task' && editorTaskKind !== 'task', null); });
function openFeatureTaskDialog(): void {
  const feature = workspace.tasks.find(item => item.id === selectedTaskId && item.kind !== 'task');
  if (!feature) return;
  const tasks = workspace.tasks.filter(item => item.kind === 'task' && item.projectId === feature.projectId && item.featureId !== feature.id);
  existingFeatureTask.replaceChildren(new Option('Aufgabe auswählen', ''), ...tasks.map(item => {
    const assigned = workspace.tasks.find(candidate => candidate.id === item.featureId);
    return new Option(assigned ? `${item.title} (aktuell: ${assigned.title})` : item.title, String(item.id));
  }));
  existingFeatureTask.disabled = tasks.length === 0;
  assignFeatureTask.disabled = true;
  featureTaskError.hidden = true;
  featureTaskDialog.showModal();
}
existingFeatureTask.addEventListener('change', () => { assignFeatureTask.disabled = !existingFeatureTask.value; });
for (const id of ['close-feature-task', 'cancel-feature-task']) document.querySelector(`#${id}`)!.addEventListener('click', () => { if (!saving) featureTaskDialog.close(); });
featureTaskDialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
document.querySelector<HTMLButtonElement>('#new-feature-task')!.addEventListener('click', () => {
  if (saving || selectedTaskId === null) return;
  const featureId = selectedTaskId;
  featureTaskDialog.close();
  openEditor({kind:'task', id:null, featureId});
});
assignFeatureTask.addEventListener('click', async () => {
  if (saving || selectedTaskId === null || !existingFeatureTask.value) return;
  saving = true;
  assignFeatureTask.disabled = true;
  featureTaskError.hidden = true;
  try { workspace = await window.hq.assignFeature(Number(existingFeatureTask.value), selectedTaskId); featureTaskDialog.close(); render(); announce('Aufgabe zugeordnet.'); }
  catch (error) { featureTaskError.textContent = errorMessage(error); featureTaskError.hidden = false; }
  finally { saving = false; assignFeatureTask.disabled = !existingFeatureTask.value; }
});

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
    case 'tab-task': activeTab = 'task'; selectedTaskId = null; render(); break;
    case 'tab-feature': activeTab = 'feature'; selectedTaskId = null; render(); break;
    case 'tab-releases': activeTab = 'releases'; selectedTaskId = null; render(); break;
    case 'new-release': openReleaseDialog(); break;
    case 'edit-release': openReleaseDialog(Number(target.dataset.id)); break;
    case 'publish-release': openPublishDialog(Number(target.dataset.id)); break;
    case 'tab-fix': activeTab = 'fix'; selectedTaskId = null; render(); break;
    case 'add-feature-task': openFeatureTaskDialog(); break;
    case 'delete-task': openDeleteDialog(Number(target.dataset.id)); break;
    case 'show-task': selectedTaskId = Number(target.dataset.id); renderDetails(); break;
    case 'close-details': selectedTaskId = null; renderDetails(); break;
    case 'new-task': openEditor({ kind: 'task', id: null }); break;
    case 'edit-task': openEditor({ kind: 'task', id: Number(target.dataset.id) }); break;
    case 'new-project': openEditor({ kind: 'project', id: null }); break;
    case 'edit-project': openEditor({ kind: 'project', id: Number(target.dataset.id) }); break;
  }
});

document.addEventListener('change', async event => {
  const checkbox = event.target;
  if (checkbox instanceof HTMLSelectElement && checkbox.dataset.featureAssignment) {
    const taskId = Number(checkbox.dataset.featureAssignment);
    if (saving) { renderDetails(); return; }
    saving = true;
    checkbox.disabled = true;
    try { workspace = await window.hq.assignFeature(taskId, checkbox.value ? Number(checkbox.value) : null); render(); announce('Zuordnung gespeichert.'); }
    catch (error) { renderDetails(); announce(errorMessage(error), true); }
    finally { saving = false; checkbox.disabled = false; }
    return;
  }
  if (!(checkbox instanceof HTMLInputElement)) return;
  if (checkbox.dataset.criterion) {
    const checked = checkbox.checked;
    if (saving) { checkbox.checked = !checked; return; }
    saving = true;
    checkbox.disabled = true;
    try { workspace = await window.hq.completeCriterion(Number(checkbox.dataset.criterion), checked); render(); }
    catch (error) { checkbox.checked = !checked; announce(errorMessage(error), true); }
    finally { checkbox.disabled = false; saving = false; }
    return;
  }
  if (checkbox.dataset.subtask) {
    const checked = checkbox.checked;
    if (saving) { checkbox.checked = !checked; return; }
    saving = true;
    checkbox.disabled = true;
    try { workspace = await window.hq.completeSubtask(Number(checkbox.dataset.subtask), checked); render(); }
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
    workspace = await window.hq.completeTask(id, completed);
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
      workspace = await window.hq.saveProject(mode.id, { ...fields, kind: projectKindField.value as ProjectKind });
      editing = null;
      editor.close();
      const newProject = workspace.projects.find(project => !previousIds.has(project.id));
      showView(newProject?.id ?? view);
      announce(mode.id === null ? 'Projekt angelegt.' : 'Projekt gespeichert.');
    } else {
      workspace = await window.hq.saveTask(mode.id, { ...fields, kind: editorTaskKind, featureId: editorTaskKind === 'task' && taskFeatureField.value ? Number(taskFeatureField.value) : null, releaseId: editorTaskKind === 'task' ? null : targetVersionField.value === 'keep-published' ? editorPublishedReleaseId : targetVersionField.value ? Number(targetVersionField.value) : null, criteria: editorTaskKind !== 'task' ? draftCriteria : [], projectId, dueDate: dueField.value || null, status: statusField.value as TaskStatus, predecessorIds: [...selectedPredecessors] });
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
