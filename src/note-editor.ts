function createNoteEditor(container: string, button: string) {
    let draftNotes: NoteFields[] = [];
    let draftNoteKind: HistoryKind = 'task';
    const noteContainer = document.querySelector<HTMLElement>(container)!;
    function openNotes(kind: HistoryKind, id: number | null, history: Workspace['history']): void {
        draftNoteKind = kind;
        draftNotes = (history ?? []).filter(entry => entry.manual && entry.entityKind === kind && entry.entityId === id).map(entry => ({ id: entry.id, text: entry.newValue ?? '' }));
        renderNotes();
    }
    function renderNotes(): void {
        noteContainer.innerHTML = draftNotes.map((note, index) => `<div class="criterion-row"><label class="criterion-text"><span class="sr-only">Meldung ${index + 1}</span><textarea required maxlength="10000" data-note-text="${index}">${escapeHtml(note.text)}</textarea></label>${draftNoteKind === 'project' || note.id === null ? `<button type="button" class="button compact" data-remove-note="${index}" aria-label="Meldung ${index + 1} entfernen">−</button>` : ''}</div>`).join('');
    }
    document.querySelector(button)!.addEventListener('click', () => {
        draftNotes.push({ id: null, text: '' });
        renderNotes();
    });
    noteContainer.addEventListener('input', event => {
        if (!(event.target instanceof HTMLTextAreaElement) || event.target.dataset.noteText === undefined)
            return;
        const note = draftNotes[Number(event.target.dataset.noteText)];
        if (note)
            note.text = event.target.value;
    });
    noteContainer.addEventListener('click', event => {
        if (!(event.target instanceof Element))
            return;
        const button = event.target.closest<HTMLButtonElement>('[data-remove-note]');
        if (button) {
            draftNotes.splice(Number(button.dataset.removeNote), 1);
            renderNotes();
        }
    });
    return { open: openNotes, get draft() { return draftNotes; } };
}
