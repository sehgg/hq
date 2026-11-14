import type { Workspace } from '../shared.js';
import { escapeHtml } from './view-format.mjs';

export function createPredecessorPicker(getWorkspace: () => Workspace) {
    const predecessorDialog = document.querySelector<HTMLDialogElement>('#predecessor-dialog')!;
    const predecessorProject = document.querySelector<HTMLSelectElement>('#predecessor-project')!;
    const predecessorTask = document.querySelector<HTMLSelectElement>('#predecessor-task')!;
    const confirmPredecessor = document.querySelector<HTMLButtonElement>('#confirm-predecessor')!;
    const predecessorEmpty = document.querySelector<HTMLElement>('#predecessor-empty')!;
    const predecessorField = document.querySelector<HTMLElement>('#entry-predecessors')!;

    let entryId: number | null = null;
    let selectedPredecessors = new Set<number>();

    function renderSelectedPredecessors(): void {
        const { tasks, projects } = getWorkspace();
        const selected = tasks.filter(task => selectedPredecessors.has(task.id));
        predecessorField.innerHTML = selected.map(task => {
            const project = projects.find(item => item.id === task.projectId);
            return `<div class="selected-predecessor"><span>${escapeHtml(task.title)} <span class="muted">· ${escapeHtml(project?.title ?? 'Posteingang')}</span></span><button type="button" class="button compact" data-remove-predecessor="${task.id}" aria-label="${escapeHtml(task.title)} als Vorgänger entfernen">−</button></div>`;
        }).join('');
    }
    function updatePredecessorTasks(): void {
        const selectedProject = predecessorProject.value;
        const available = selectedProject === '' ? [] : getWorkspace().tasks.filter(task => task.id !== entryId && !selectedPredecessors.has(task.id) &&
            (selectedProject === 'inbox' ? task.projectId === null : task.projectId === Number(selectedProject)));
        predecessorTask.replaceChildren(new Option('Aufgabe auswählen', ''), ...available.map(task => new Option(task.title, String(task.id))));
        predecessorTask.disabled = selectedProject === '' || available.length === 0;
        predecessorEmpty.hidden = selectedProject === '' || available.length > 0;
        confirmPredecessor.disabled = true;
    }
    document.querySelector<HTMLButtonElement>('#add-predecessor')!.addEventListener('click', () => {
        predecessorProject.replaceChildren(new Option('Projekt auswählen', ''), new Option('Posteingang', 'inbox'), ...getWorkspace().projects.map(project => new Option(project.title, String(project.id))));
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

    return {
        reset(id: number | null, selectedIds: number[]): void {
            entryId = id;
            selectedPredecessors = new Set(selectedIds);
            renderSelectedPredecessors();
        },
        getSelectedIds(): number[] {
            return [...selectedPredecessors];
        },
    };
}
