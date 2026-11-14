import type { HqApi, Workspace } from '../shared.js';

export type View = 'inbox' | 'projects' | 'ideas' | 'research' | number;

declare global {
    interface Window {
        hq: HqApi;
    }
}

export interface DialogContext {
    workspace: Workspace;
    readonly view: View;
    saving: boolean;
    render(): void;
    announce(message: string, error?: boolean): void;
    focusHeading(): void;
}
