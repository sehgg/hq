import type { DatabaseSync } from 'node:sqlite';
import type { HistoryKind, Workspace } from '../shared';

export function recordChanges(db: DatabaseSync, before: Workspace, after: Workspace): void {
    const insert = db.prepare('INSERT INTO history (entity_kind,entity_id,project_id,entity_title,field,old_value,new_value) VALUES (?,?,?,?,?,?,?)');
    const emit = (kind: HistoryKind, id: number, projectId: number | null, name: string, field: string, oldValue: string | null, newValue: string | null) => {
        insert.run(kind, id, projectId, name, field, oldValue, newValue);
    };
    const value = (item: unknown): string | null => {
        if (item === null || item === undefined || item === '')
            return null;
        if (Array.isArray(item))
            return item.length ? JSON.stringify(item) : null;
        return String(item);
    };
    function compare<T extends { id: number; name: string; projectId: number | null }>(
        kind: HistoryKind, oldItems: T[], newItems: T[], fields: [keyof T, string][],
        skipField?: (key: keyof T, old: T, next: T) => boolean,
    ): void {
        const ids = new Set([...oldItems.map(item => item.id), ...newItems.map(item => item.id)]);
        for (const id of ids) {
            const old = oldItems.find(item => item.id === id);
            const next = newItems.find(item => item.id === id);
            const item = next ?? old!;
            const { name, projectId } = item;
            const record = (field: string, previous: string | null, current: string | null) => {
                emit(kind, id, projectId, name, field, previous, current);
                if (kind === 'task' && old && next && old.projectId !== next.projectId && old.projectId !== null)
                    emit('project', old.projectId, old.projectId, name, `${name} · ${field}`, previous, current);
            };
            if (!old || !next) {
                record(next ? 'Erstellt' : 'Gelöscht', old ? name : null, next ? name : null);
                continue;
            }
            for (const [key, label] of fields) {
                if (skipField?.(key, old, next))
                    continue;
                const previous = value(old[key]), current = value(next[key]);
                if (previous !== current)
                    record(label, previous, current);
            }
        }
    }
    const projects = ({ projects }: Workspace) => projects.map(project => ({ ...project, name: project.title, projectId: project.id }));
    const releases = ({ releases }: Workspace) => releases.map(release => ({ ...release, name: release.version }));
    compare('project', projects(before), projects(after), [['title', 'Titel'], ['description', 'Beschreibung'], ['priority', 'Priorität'], ['kind', 'Projekttyp'], ['dueDate', 'Fälligkeit']]);
    compare('release', releases(before), releases(after), [['version', 'Version'], ['dueDate', 'Fälligkeit'], ['status', 'Status']]);
    const existingTaskIds = new Set(before.tasks.map(task => task.id));
    const childChanges = (label: string, oldChildren: {
        id: number;
        taskId: number;
        text: string;
        completed: boolean;
    }[], newChildren: {
        id: number;
        taskId: number;
        text: string;
        completed: boolean;
    }[]) => {
        for (const id of new Set([...oldChildren.map(child => child.id), ...newChildren.map(child => child.id)])) {
            const old = oldChildren.find(child => child.id === id), next = newChildren.find(child => child.id === id);
            const child = next ?? old!;
            const task = after.tasks.find(item => item.id === child.taskId) ?? before.tasks.find(item => item.id === child.taskId);
            if (!task || !existingTaskIds.has(child.taskId))
                continue;
            const format = (entry: typeof child | undefined) => entry ? `${entry.text} (${entry.completed ? 'erledigt' : 'offen'})` : null;
            if (format(old) !== format(next))
                emit('task', task.id, task.projectId, task.title, label, format(old), format(next));
        }
    };
    childChanges('Unteraufgabe', before.subtasks.map(s => ({ ...s, text: s.title })), after.subtasks.map(s => ({ ...s, text: s.title })));
    const criteria = (workspace: Workspace) => workspace.tasks.flatMap(task => task.criteria.map(criterion => ({ ...criterion, id: criterion.id!, taskId: task.id })));
    childChanges('Akzeptanzkriterium', criteria(before), criteria(after));
    const tasks = (workspace: Workspace) => workspace.tasks.map(task => ({
        ...task,
        name: task.title,
        projectName: workspace.projects.find(project => project.id === task.projectId)?.title ? `${workspace.projects.find(project => project.id === task.projectId)!.title} (#${task.projectId})` : (task.projectId === null ? 'Posteingang' : String(task.projectId)),
        releaseName: workspace.releases.find(release => release.id === task.releaseId)?.version ?? null,
        predecessorIds: task.predecessorIds.filter(id => existingTaskIds.has(id)).sort((a, b) => a - b),
        successorIds: task.successorIds.filter(id => existingTaskIds.has(id)).sort((a, b) => a - b),
        predecessorNames: task.predecessorIds.filter(id => existingTaskIds.has(id)).sort((a, b) => a - b).map(id => workspace.tasks.find(item => item.id === id)?.title ?? String(id)),
        successorNames: task.successorIds.filter(id => existingTaskIds.has(id)).sort((a, b) => a - b).map(id => workspace.tasks.find(item => item.id === id)?.title ?? String(id)),
    }));
    compare('task', tasks(before), tasks(after), [['title', 'Titel'], ['description', 'Beschreibung'], ['priority', 'Priorität'], ['kind', 'Typ'], ['projectName', 'Projekt'], ['dueDate', 'Fälligkeit'], ['status', 'Status'], ['releaseName', 'Release'], ['predecessorNames', 'Vorgänger'], ['successorNames', 'Folgeaufgaben']], (key, old, next) => {
        switch (key) {
            case 'projectName': return old.projectId === next.projectId;
            case 'releaseName': return old.releaseId === next.releaseId;
            case 'predecessorNames': return JSON.stringify(old.predecessorIds) === JSON.stringify(next.predecessorIds);
            case 'successorNames': return JSON.stringify(old.successorIds) === JSON.stringify(next.successorIds);
            default: return false;
        }
    });
}
