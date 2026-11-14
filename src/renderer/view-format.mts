import type { TaskStatus } from '../shared.js';

export const statusNames: Record<TaskStatus, string> = { planned: 'Geplant', in_progress: 'In Arbeit', paused: 'Pausiert', done: 'Erledigt' };
export function errorMessage(error: unknown): string {
    const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : '';
    return message ? message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Der Vorgang konnte nicht gespeichert werden.';
}
export function escapeHtml(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
