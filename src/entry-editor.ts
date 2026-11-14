function createEntryEditor(context: DialogContext & {
    readonly activeTab: TaskKind | 'releases' | 'history';
    selectedTaskId: number | null;
    showView(target: View): void;
}) {
    const notes = createNoteEditor('#entry-notes', '#add-entry-note');

    const deleteDialog = document.querySelector<HTMLDialogElement>('#delete-dialog')!;
    const deleteTitle = document.querySelector<HTMLElement>('#delete-title')!;
    const deleteDescription = document.querySelector<HTMLElement>('#delete-description')!;
    const deleteError = document.querySelector<HTMLElement>('#delete-error')!;
    const confirmDelete = document.querySelector<HTMLButtonElement>('#confirm-delete')!;
    const cancelDelete = document.querySelector<HTMLButtonElement>('#cancel-delete')!;

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

    let editorPublishedReleaseId: number | null = null;
    let editorTaskKind: TaskKind = 'task';
    let editing: EditorMode | null = null;

    let pendingDeleteTaskId: number | null = null;
    let selectedPredecessors = new Set<number>();
    let draftCriteria: CriterionFields[] = [];
    let draftSubtasks: SubtaskFields[] = [];

    function updateReleaseOptions(show: boolean, selectedId: number | null): void {
        const projectId = projectField.value ? Number(projectField.value) : null;
        show = show && context.workspace.projects.some(project => project.id === projectId && project.kind === 'software');
        document.querySelector<HTMLElement>('#release-assignment-field')!.hidden = !show;
        const selected = context.workspace.releases.find(item => item.id === selectedId && item.projectId === projectId);
        const planned = context.workspace.releases.filter(item => item.projectId === projectId && !item.published);
        editorPublishedReleaseId = show && selected?.published ? selected.id : null;
        targetVersionField.replaceChildren(new Option('Keine Zielversion', ''), ...(editorPublishedReleaseId ? [new Option('Veröffentlichte Zuordnung beibehalten', 'keep-published')] : []), ...planned.map(item => new Option(item.version, String(item.id))));
        targetVersionField.value = editorPublishedReleaseId ? 'keep-published' : selected && !selected.published ? String(selected.id) : '';
        publishedVersion.hidden = !editorPublishedReleaseId;
        publishedVersion.textContent = editorPublishedReleaseId ? `Aktuelles Release: ${selected!.version} (veröffentlicht)` : '';
    }

    function openDeleteDialog(id: number): void {
        const task = context.workspace.tasks.find(item => item.id === id);
        if (!task)
            return;
        pendingDeleteTaskId = id;
        const kind = task.kind === 'feature' ? 'Feature' : task.kind === 'fix' ? 'Fix' : 'Aufgabe';
        deleteTitle.textContent = `${kind} löschen?`;
        deleteDescription.textContent = `„${task.title}“ wird endgültig gelöscht. Unteraufgaben${task.kind !== 'task' ? ', Akzeptanzkriterien' : ''} und Verknüpfungen werden entfernt. Verknüpfte Einträge bleiben erhalten.`;
        deleteError.hidden = true;
        deleteDialog.showModal();
        cancelDelete.focus();
    }
    cancelDelete.addEventListener('click', () => {
        if (!context.saving)
            deleteDialog.close();
    });
    deleteDialog.addEventListener('cancel', event => {
        if (context.saving)
            event.preventDefault();
    });
    confirmDelete.addEventListener('click', async () => {
        if (context.saving || pendingDeleteTaskId === null)
            return;
        const task = context.workspace.tasks.find(item => item.id === pendingDeleteTaskId);
        if (!task)
            return;
        context.saving = true;
        confirmDelete.disabled = true;
        cancelDelete.disabled = true;
        deleteError.hidden = true;
        try {
            context.workspace = await window.hq.deleteTask(task.id, context.workspace.revision);
            if (context.selectedTaskId === task.id)
                context.selectedTaskId = null;
            pendingDeleteTaskId = null;
            deleteDialog.close();
            editor.close();
            context.render();
            context.focusHeading();
            context.announce(task.kind === 'feature' ? 'Feature gelöscht.' : task.kind === 'fix' ? 'Fix gelöscht.' : 'Aufgabe gelöscht.');
        }
        catch (error) {
            deleteError.textContent = errorMessage(error);
            deleteError.hidden = false;
        }
        finally {
            context.saving = false;
            confirmDelete.disabled = false;
            cancelDelete.disabled = false;
        }
    });

    function openEditor(mode: EditorMode): void {
        editing = mode;
        notes.open(mode.kind, mode.id, context.workspace.history);
        const isTask = mode.kind === 'task';
        const task = isTask ? context.workspace.tasks.find(item => item.id === mode.id) : undefined;
        const entry = isTask ? task : context.workspace.projects.find(item => item.id === mode.id);
        const currentProject = task ? task.projectId : (typeof context.view === 'number' ? context.view : null);
        editorTaskKind = task?.kind ?? (isTask && context.activeTab !== 'releases' && context.activeTab !== 'history' ? context.activeTab : 'task');
        const isFeature = isTask && editorTaskKind !== 'task';
        const isFix = isTask && editorTaskKind === 'fix';
        document.querySelector<HTMLElement>('#project-kind-field')!.hidden = isTask;
        document.querySelector<HTMLElement>('#project-due-field')!.hidden = isTask;
        projectDueField.value = !isTask ? ((entry as Project | undefined)?.dueDate ?? '') : '';
        renderProjectDueConflicts();
        document.querySelector<HTMLElement>('#feature-fields')!.hidden = !isFeature;
        document.querySelector('#description-label')!.textContent = isFeature ? 'Beschreibung und Nutzen' : 'Beschreibung';
        draftCriteria = isFeature ? (task?.criteria ?? []).map(criterion => ({ ...criterion })) : [];
        renderCriteriaEditor();
        draftSubtasks = task ? context.workspace.subtasks.filter(subtask => subtask.taskId === task.id).map(({ id, title }) => ({ id, title })) : [];
        renderSubtaskEditor();
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
        projectField.replaceChildren(...(isFeature ? [] : [new Option('Posteingang', '')]), ...context.workspace.projects.filter(project => !isFeature || project.kind === 'software').map(project => new Option(project.title, String(project.id))));
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
    document.querySelector('#delete-entry')!.addEventListener('click', () => {
        if (!context.saving && editing?.kind === 'task' && editing.id !== null)
            openDeleteDialog(editing.id);
    });
    function projectDueConflicts(): Task[] {
        if (!editing || editing.kind !== 'project' || editing.id === null || !projectDueField.value)
            return [];
        const deadline = projectDueField.value;
        return context.workspace.tasks.filter(task => task.projectId === editing!.id && task.dueDate !== null && task.dueDate > deadline)
            .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!) || a.id - b.id);
    }
    function renderProjectDueConflicts(): void {
        const conflicts = projectDueConflicts();
        projectDueConflictBox.hidden = conflicts.length === 0;
        projectDueConflictBox.innerHTML = conflicts.length ? `<p>Diese Einträge sind nach der Projektfrist fällig. Schließe den Dialog und passe ihre Fälligkeiten an:</p><ul>${conflicts.map(task => `<li>${task.kind === 'feature' ? 'Feature' : task.kind === 'fix' ? 'Fix' : 'Aufgabe'}: ${escapeHtml(task.title)} · ${escapeHtml(task.dueDate!.split('-').reverse().join('.'))}</li>`).join('')}</ul>` : '';
    }
    projectDueField.addEventListener('input', renderProjectDueConflicts);
    projectDueField.addEventListener('change', renderProjectDueConflicts);
    projectField.addEventListener('change', () => {
        updateReleaseOptions(editing?.kind === 'task', null);
    });
    function renderCriteriaEditor(): void {
        criteriaField.innerHTML = draftCriteria.map((criterion, index) => `<div class="criterion-row"><label class="criterion-check"><input type="checkbox" data-criterion-check="${index}" ${criterion.completed ? 'checked' : ''} aria-label="Kriterium ${index + 1} erfüllt"></label><label class="criterion-text"><span class="sr-only">Akzeptanzkriterium ${index + 1}</span><input type="text" required maxlength="1000" data-criterion-text="${index}" value="${escapeHtml(criterion.text)}" placeholder="Prüfbares Kriterium"></label><button type="button" class="button compact" data-remove-criterion="${index}" aria-label="Kriterium ${index + 1} entfernen">−</button></div>`).join('');
    }
    const subtaskField = document.querySelector<HTMLElement>('#entry-subtasks')!;
    function renderSubtaskEditor(): void {
        subtaskField.innerHTML = draftSubtasks.map((subtask, index) => `<div class="criterion-row"><label class="criterion-text"><span class="sr-only">Unteraufgabe ${index + 1}</span><input type="text" required maxlength="120" data-subtask-text="${index}" value="${escapeHtml(subtask.title)}" placeholder="Unteraufgabe"></label><button type="button" class="button compact" data-remove-subtask="${index}" aria-label="Unteraufgabe ${index + 1} entfernen">−</button></div>`).join('');
    }
    document.querySelector<HTMLButtonElement>('#add-subtask')!.addEventListener('click', () => {
        draftSubtasks.push({ id: null, title: '' });
        renderSubtaskEditor();
        subtaskField.querySelector<HTMLInputElement>(`[data-subtask-text="${draftSubtasks.length - 1}"]`)?.focus();
    });
    subtaskField.addEventListener('input', event => {
        if (!(event.target instanceof HTMLInputElement) || event.target.dataset.subtaskText === undefined)
            return;
        const subtask = draftSubtasks[Number(event.target.dataset.subtaskText)];
        if (subtask)
            subtask.title = event.target.value;
    });
    subtaskField.addEventListener('click', event => {
        if (!(event.target instanceof Element))
            return;
        const button = event.target.closest<HTMLButtonElement>('[data-remove-subtask]');
        if (button) {
            draftSubtasks.splice(Number(button.dataset.removeSubtask), 1);
            renderSubtaskEditor();
        }
    });
    document.querySelector<HTMLButtonElement>('#add-criterion')!.addEventListener('click', () => {
        draftCriteria.push({ id: null, text: '', completed: false });
        renderCriteriaEditor();
        criteriaField.querySelector<HTMLInputElement>(`[data-criterion-text="${draftCriteria.length - 1}"]`)?.focus();
    });
    criteriaField.addEventListener('input', event => {
        if (!(event.target instanceof HTMLInputElement) || event.target.dataset.criterionText === undefined)
            return;
        const criterion = draftCriteria[Number(event.target.dataset.criterionText)];
        if (criterion)
            criterion.text = event.target.value;
    });
    criteriaField.addEventListener('change', event => {
        if (!(event.target instanceof HTMLInputElement) || event.target.dataset.criterionCheck === undefined)
            return;
        const criterion = draftCriteria[Number(event.target.dataset.criterionCheck)];
        if (criterion)
            criterion.completed = event.target.checked;
    });
    criteriaField.addEventListener('click', event => {
        if (!(event.target instanceof Element))
            return;
        const button = event.target.closest<HTMLButtonElement>('[data-remove-criterion]');
        if (button) {
            draftCriteria.splice(Number(button.dataset.removeCriterion), 1);
            renderCriteriaEditor();
        }
    });
    function renderSelectedPredecessors(): void {
        const selected = context.workspace.tasks.filter(task => selectedPredecessors.has(task.id));
        predecessorField.innerHTML = selected.length ? selected.map(task => {
            const project = context.workspace.projects.find(item => item.id === task.projectId);
            return `<div class="selected-predecessor"><span>${escapeHtml(task.title)} <span class="muted">· ${escapeHtml(project?.title ?? 'Posteingang')}</span></span><button type="button" class="button compact" data-remove-predecessor="${task.id}" aria-label="${escapeHtml(task.title)} als Vorgänger entfernen">−</button></div>`;
        }).join('') : '';
    }
    function updatePredecessorTasks(): void {
        const selectedProject = predecessorProject.value;
        const available = selectedProject === '' ? [] : context.workspace.tasks.filter(task => task.id !== editing?.id && !selectedPredecessors.has(task.id) &&
            (selectedProject === 'inbox' ? task.projectId === null : task.projectId === Number(selectedProject)));
        predecessorTask.replaceChildren(new Option('Aufgabe auswählen', ''), ...available.map(task => new Option(task.title, String(task.id))));
        predecessorTask.disabled = selectedProject === '' || available.length === 0;
        predecessorEmpty.hidden = selectedProject === '' || available.length > 0;
        confirmPredecessor.disabled = true;
    }
    document.querySelector<HTMLButtonElement>('#add-predecessor')!.addEventListener('click', () => {
        predecessorProject.replaceChildren(new Option('Projekt auswählen', ''), new Option('Posteingang', 'inbox'), ...context.workspace.projects.map(project => new Option(project.title, String(project.id))));
        updatePredecessorTasks();
        predecessorDialog.showModal();
        predecessorProject.focus();
    });
    predecessorProject.addEventListener('change', updatePredecessorTasks);
    predecessorTask.addEventListener('change', () => {
        confirmPredecessor.disabled = !predecessorTask.value;
    });
    for (const id of ['close-predecessor', 'cancel-predecessor'])
        document.querySelector(`#${id}`)!.addEventListener('click', () => predecessorDialog.close());
    predecessorField.addEventListener('click', event => {
        if (!(event.target instanceof Element))
            return;
        const button = event.target.closest<HTMLButtonElement>('[data-remove-predecessor]');
        if (button) {
            selectedPredecessors.delete(Number(button.dataset.removePredecessor));
            renderSelectedPredecessors();
        }
    });
    document.querySelector<HTMLFormElement>('#predecessor-form')!.addEventListener('submit', event => {
        event.preventDefault();
        if (!predecessorTask.value)
            return;
        selectedPredecessors.add(Number(predecessorTask.value));
        renderSelectedPredecessors();
        predecessorDialog.close();
    });

    for (const id of ['close-editor', 'cancel-editor']) {
        document.querySelector(`#${id}`)!.addEventListener('click', () => {
            if (!context.saving) {
                editing = null;
                editor.close();
            }
        });
    }
    editor.addEventListener('cancel', event => {
        if (context.saving)
            event.preventDefault();
        else
            editing = null;
    });
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!editor.open || !editing || context.saving)
            return;
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
        context.saving = true;
        editorFields.disabled = true;
        saveButton.disabled = true;
        editorError.hidden = true;
        try {
            if (mode.kind === 'project') {
                const previousIds = new Set(context.workspace.projects.map(project => project.id));
                context.workspace = await window.hq.saveProject(mode.id, { ...fields, kind: projectKindField.value as ProjectKind, dueDate: projectDueField.value || null }, context.workspace.revision, notes.draft);
                editing = null;
                editor.close();
                const newProject = context.workspace.projects.find(project => !previousIds.has(project.id));
                context.showView(newProject?.id ?? context.view);
                context.announce(mode.id === null ? 'Projekt angelegt.' : 'Projekt gespeichert.');
            }
            else {
                context.workspace = await window.hq.saveTask(mode.id, {
                    ...fields,
                    kind: editorTaskKind,
                    featureId: null,
                    releaseId: targetVersionField.value === 'keep-published' ? editorPublishedReleaseId : targetVersionField.value ? Number(targetVersionField.value) : null,
                    criteria: editorTaskKind !== 'task' ? draftCriteria : [],
                    subtasks: draftSubtasks,
                    projectId,
                    dueDate: dueField.value || null,
                    status: statusField.value as TaskStatus,
                    predecessorIds: [...selectedPredecessors]
                }, context.workspace.revision, notes.draft);
                editing = null;
                editor.close();
                context.render();
                context.focusHeading();
                const moved = (context.view === 'inbox' ? projectId !== null : projectId !== context.view);
                context.announce(mode.id === null ? (editorTaskKind === 'feature' ? 'Feature angelegt.' : editorTaskKind === 'fix' ? 'Fix angelegt.' : 'Aufgabe angelegt.') : moved ? 'Eintrag verschoben.' : 'Eintrag gespeichert.');
            }
        }
        catch (error) {
            editorError.textContent = errorMessage(error);
            editorError.hidden = false;
        }
        finally {
            context.saving = false;
            editorFields.disabled = false;
            saveButton.disabled = false;
        }
    });

    return { open: openEditor, openDelete: openDeleteDialog };
}
