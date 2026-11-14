import type { ReleaseStatus } from '../shared.js';
import type { DialogContext } from './dialog-context.mjs';
import { createNoteEditor } from './note-editor.mjs';
import { errorMessage, statusNames } from './view-format.mjs';

export function createReleaseEditor(context: DialogContext & { selectedReleaseId: number | null }) {
    const notes = createNoteEditor('#release-notes', '#add-release-note');

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

    let pendingReleaseId: number | null = null;
    let editingReleaseId: number | null = null;

    let pendingDeleteReleaseId: number | null = null;

    function openReleaseDialog(id: number | null = null): void {
        if (typeof context.view !== 'number' || context.workspace.projects.find(project => project.id === context.view)?.kind !== 'software')
            return;
        const release = id === null ? undefined : context.workspace.releases.find(item => item.id === id && item.projectId === context.view);
        if (id !== null && !release)
            return;
        editingReleaseId = id;
        notes.open('release', id, context.workspace.history);
        releaseTitle.textContent = release ? 'Release bearbeiten' : 'Neues Release';
        releaseVersion.value = release?.version ?? '';
        releaseDue.value = release?.dueDate ?? '';
        document.querySelector<HTMLElement>('#release-status-field')!.hidden = !release;
        releaseStatus.value = release?.status ?? 'planned';
        saveRelease.textContent = release ? 'Speichern' : 'Release anlegen';
        document.querySelector<HTMLElement>('#delete-release-entry')!.hidden = !release;
        releaseError.hidden = true;
        releaseDialog.showModal();
        releaseVersion.focus();
    }
    document.querySelector('#delete-release-entry')!.addEventListener('click', () => {
        if (!context.saving && editingReleaseId !== null)
            openDeleteReleaseDialog(editingReleaseId);
    });
    for (const id of ['close-release', 'cancel-release'])
        document.querySelector(`#${id}`)!.addEventListener('click', () => {
            if (!context.saving)
                releaseDialog.close();
        });
    releaseDialog.addEventListener('cancel', event => {
        if (context.saving)
            event.preventDefault();
    });
    async function saveReleaseChanges(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (context.saving || typeof context.view !== 'number')
            return;
        const id = editingReleaseId;
        context.saving = true;
        saveRelease.disabled = true;
        releaseError.hidden = true;
        try {
            context.workspace = id === null ? await window.hq.createRelease(context.view, releaseVersion.value, releaseDue.value || null, context.workspace.revision, notes.draft) : await window.hq.renameRelease(id, releaseVersion.value, releaseDue.value || null, releaseStatus.value as ReleaseStatus, context.workspace.revision, notes.draft);
            releaseDialog.close();
            context.render();
            context.announce(id === null ? 'Release angelegt.' : 'Release gespeichert.');
        }
        catch (error) {
            releaseError.textContent = errorMessage(error);
            releaseError.hidden = false;
        }
        finally {
            context.saving = false;
            saveRelease.disabled = false;
        }
    }
    releaseForm.addEventListener('submit', saveReleaseChanges);
    function openPublishDialog(id: number): void {
        const release = context.workspace.releases.find(item => item.id === id && !item.published);
        if (!release)
            return;
        pendingReleaseId = id;
        const open = context.workspace.tasks.filter(item => item.releaseId === id && item.status !== 'done');
        publishDescription.textContent = open.length ? `Diese Einträge blockieren die Veröffentlichung: ${open.map(item => `${item.kind === 'task' ? 'Aufgabe' : item.kind === 'fix' ? 'Fix' : 'Feature'}: ${item.title} (${statusNames[item.status]})`).join('; ')}.` : `„${release.version}“ wird als veröffentlicht markiert und steht nicht mehr für neue Zuordnungen zur Verfügung.`;
        publishError.hidden = true;
        publishDialog.showModal();
        document.querySelector<HTMLButtonElement>('#cancel-publish')!.focus();
    }
    document.querySelector('#cancel-publish')!.addEventListener('click', () => {
        if (!context.saving)
            publishDialog.close();
    });
    publishDialog.addEventListener('cancel', event => {
        if (context.saving)
            event.preventDefault();
    });
    async function publishRelease(): Promise<void> {
        if (context.saving || pendingReleaseId === null)
            return;
        context.saving = true;
        confirmPublish.disabled = true;
        publishError.hidden = true;
        try {
            context.workspace = await window.hq.publishRelease(pendingReleaseId, context.workspace.revision);
            publishDialog.close();
            pendingReleaseId = null;
            context.render();
            context.announce('Release veröffentlicht.');
        }
        catch (error) {
            publishError.textContent = errorMessage(error);
            publishError.hidden = false;
        }
        finally {
            context.saving = false;
            confirmPublish.disabled = false;
        }
    }
    confirmPublish.addEventListener('click', publishRelease);
    function openDeleteReleaseDialog(id: number): void {
        const release = context.workspace.releases.find(item => item.id === id);
        if (!release)
            return;
        pendingDeleteReleaseId = id;
        deleteReleaseDescription.textContent = `„${release.version}“ wird endgültig gelöscht. Zugeordnete Aufgaben, Features und Fixes bleiben erhalten, ihre Release-Zuordnung wird entfernt.`;
        deleteReleaseError.hidden = true;
        deleteReleaseDialog.showModal();
        cancelDeleteRelease.focus();
    }
    cancelDeleteRelease.addEventListener('click', () => {
        if (!context.saving)
            deleteReleaseDialog.close();
    });
    deleteReleaseDialog.addEventListener('cancel', event => {
        if (context.saving)
            event.preventDefault();
    });
    async function deleteRelease(): Promise<void> {
        if (context.saving || pendingDeleteReleaseId === null)
            return;
        context.saving = true;
        confirmDeleteRelease.disabled = true;
        cancelDeleteRelease.disabled = true;
        deleteReleaseError.hidden = true;
        try {
            context.workspace = await window.hq.deleteRelease(pendingDeleteReleaseId, context.workspace.revision);
            pendingDeleteReleaseId = null;
            context.selectedReleaseId = null;
            deleteReleaseDialog.close();
            releaseDialog.close();
            context.render();
            context.focusHeading();
            context.announce('Release gelöscht.');
        }
        catch (error) {
            deleteReleaseError.textContent = errorMessage(error);
            deleteReleaseError.hidden = false;
        }
        finally {
            context.saving = false;
            confirmDeleteRelease.disabled = false;
            cancelDeleteRelease.disabled = false;
        }
    }
    confirmDeleteRelease.addEventListener('click', deleteRelease);

    return { open: openReleaseDialog, openPublish: openPublishDialog };
}
