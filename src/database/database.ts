import { DatabaseSync } from 'node:sqlite';
import { recordChanges } from './history';
import { migrateDatabase } from './migrations';
import type { Priority, Project, ProjectFields, Task, TaskFields, TaskStatus, Subtask, Workspace, Release, ReleaseStatus, HistoryKind, HistoryEntry } from '../shared';
const byPriority = "CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END";
function title(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 120)
        throw new Error('Der Name muss zwischen 1 und 120 Zeichen haben.');
    return value.trim();
}
function description(value: unknown): string {
    if (typeof value !== 'string' || value.length > 10000)
        throw new Error('Die Beschreibung ist ungültig.');
    return value.trim();
}
function priority(value: unknown): Priority {
    if (value !== 'high' && value !== 'normal' && value !== 'low')
        throw new Error('Diese Priorität ist ungültig.');
    return value;
}
function identifier(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1)
        throw new Error('Dieser Eintrag ist ungültig.');
    return value;
}
function validDate(value: unknown): string | null {
    if (value === null)
        return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
        throw new Error('Das Fälligkeitsdatum ist ungültig.');
    return value;
}
function status(value: unknown): TaskStatus {
    if (value !== 'planned' && value !== 'in_progress' && value !== 'paused' && value !== 'done')
        throw new Error('Dieser Status ist ungültig.');
    return value;
}
export class PlannerDatabase {
    private readonly db: DatabaseSync;
    constructor(path: string) {
        this.db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
        migrateDatabase(this.db);
    }
    read(): Workspace {
        this.db.exec('SAVEPOINT workspace_read');
        try {
            const revision = (this.db.prepare('SELECT revision FROM workspace_revision WHERE id=1').get() as {
                revision: number;
            }).revision;
            const projects = this.db.prepare(`SELECT id, title, priority, description, kind, due_date AS dueDate FROM projects ORDER BY ${byPriority}, id DESC`).all() as unknown as Project[];
            const releases = this.db.prepare('SELECT id, project_id AS projectId, version, due_date AS dueDate, status, published FROM releases ORDER BY id DESC').all() as unknown as Array<Omit<Release, 'published'> & {
                published: number;
            }>;
            const rows = this.db.prepare(`
        SELECT t.id, t.title, t.priority, t.description, t.kind,
               t.feature_id AS featureId, t.release_id AS releaseId, r.version AS targetVersion,
               t.project_id AS projectId, t.due_date AS dueDate, t.status, t.completed
        FROM tasks t
        LEFT JOIN releases r ON r.id=t.release_id
        ORDER BY t.due_date IS NULL, t.due_date ASC, CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, t.id DESC
      `).all() as unknown as Array<Omit<Task, 'completed' | 'predecessorIds' | 'successorIds' | 'criteria'> & {
                completed: number;
            }>;
            const edges = this.db.prepare('SELECT predecessor_id AS predecessorId, successor_id AS successorId FROM task_dependencies').all() as unknown as {
                predecessorId: number;
                successorId: number;
            }[];
            const criteria = this.db.prepare('SELECT id, task_id AS taskId, text, completed FROM acceptance_criteria ORDER BY position, id').all() as unknown as {
                id: number;
                taskId: number;
                text: string;
                completed: number;
            }[];
            const subs = this.db.prepare('SELECT id, task_id AS taskId, title, completed FROM subtasks ORDER BY id').all() as unknown as Array<Omit<Subtask, 'completed'> & {
                completed: number;
            }>;
            const history = (this.db.prepare('SELECT id, entity_kind AS entityKind, entity_id AS entityId, project_id AS projectId, entity_title AS entityTitle, date, field, old_value AS oldValue, new_value AS newValue, manual FROM history ORDER BY id DESC').all() as unknown as Array<Omit<HistoryEntry, 'manual'> & {
                manual: number;
            }>).map(entry => ({ ...entry, manual: !!entry.manual }));
            const workspace = {
                revision,
                history,
                releases: releases.map(r => ({ ...r, published: !!r.published })),
                projects,
                tasks: rows.map(row => ({
                    ...row,
                    completed: !!row.completed,
                    criteria: criteria.filter(c => c.taskId === row.id).map(c => ({ id: c.id, text: c.text, completed: !!c.completed })),
                    predecessorIds: edges.filter(e => e.successorId === row.id).map(e => e.predecessorId),
                    successorIds: edges.filter(e => e.predecessorId === row.id).map(e => e.successorId)
                })),
                subtasks: subs.map(s => ({ ...s, completed: !!s.completed }))
            };
            this.db.exec('RELEASE workspace_read');
            return workspace;
        }
        catch (error) {
            this.db.exec('ROLLBACK TO workspace_read; RELEASE workspace_read');
            throw error;
        }
    }
    mutate<T>(expectedRevision: number, operation: () => T): T {
        return this.transact(expectedRevision, operation, result =>
            result && typeof result === 'object' && 'revision' in result ? this.read() as T : result);
    }

    mutateWorkspace(expectedRevision: number, operation: () => void): Workspace {
        return this.transact(expectedRevision, operation, () => this.read());
    }

    private transact<T, Result>(expectedRevision: number, operation: () => T, finish: (result: T) => Result): Result {
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
            throw new Error('Der Datenstand ist ungültig.');
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const revision = (this.db.prepare('SELECT revision FROM workspace_revision WHERE id=1').get() as {
                revision: number;
            }).revision;
            if (revision !== expectedRevision)
                throw new Error('Der Arbeitsbereich wurde zwischenzeitlich geändert. Bitte neu laden und erneut versuchen.');
            const before = this.read();
            const result = operation();
            recordChanges(this.db, before, this.read());
            const refreshed = finish(result);
            this.db.exec('COMMIT');
            return refreshed;
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
    private withSavepoint<T>(operation: () => T): T {
        this.db.exec('SAVEPOINT hq_operation');
        try {
            const result = operation();
            this.db.exec('RELEASE hq_operation');
            return result;
        } catch (error) {
            this.db.exec('ROLLBACK TO hq_operation; RELEASE hq_operation');
            throw error;
        }
    }
    private nextEntityId(table: 'projects' | 'tasks' | 'releases', kind: HistoryKind): number {
        const row = this.db.prepare(`SELECT max(COALESCE((SELECT max(id) FROM ${table}),0), COALESCE((SELECT max(entity_id) FROM history WHERE entity_kind=?),0)) + 1 AS id`).get(kind) as {
            id: number;
        };
        return row.id;
    }
    addHistoryNote(kind: HistoryKind, id: number, text: string): void {
        identifier(id);
        if (!['project', 'task', 'release'].includes(kind))
            throw new Error('Dieser Eintrag ist ungültig.');
        const note = description(text);
        if (!note)
            throw new Error('Die Meldung darf nicht leer sein.');
        const queries = {
            project: 'SELECT title AS name, id AS projectId FROM projects WHERE id=?',
            task: 'SELECT title AS name, project_id AS projectId FROM tasks WHERE id=?',
            release: 'SELECT version AS name, project_id AS projectId FROM releases WHERE id=?',
        };
        const entity = this.db.prepare(queries[kind]).get(id) as
            { name: string; projectId: number | null } | undefined;
        if (!entity)
            throw new Error('Der Eintrag wurde nicht gefunden.');
        this.db.prepare(`
            INSERT INTO history (entity_kind,entity_id,project_id,entity_title,field,new_value,manual)
            VALUES (?,?,?,?,?,?,1)
        `).run(kind, id, entity.projectId, entity.name, 'Meldung', note);
    }
    saveHistoryNotes(kind: HistoryKind, id: number, notes: import('../shared').NoteFields[]): void {
        if (!Array.isArray(notes))
            throw new Error('Die Meldungen sind ungültig.');
        const existing = this.db.prepare(`
            SELECT id, new_value AS newValue FROM history
            WHERE manual=1 AND entity_kind=? AND entity_id=?
            ORDER BY id DESC
        `).all(kind, id) as Array<{id: number; newValue: string | null}>;
        const ids = new Set<number>();
        for (const note of notes) {
            if (!note || typeof note.text !== 'string' || !note.text.trim() || note.text.trim().length > 10000)
                throw new Error('Eine Meldung muss zwischen 1 und 10000 Zeichen haben.');
            if (note.id !== null) {
                const noteId = identifier(note.id);
                if (ids.has(noteId) || !existing.some(entry => entry.id === noteId))
                    throw new Error('Die Meldung wurde nicht gefunden oder mehrfach angegeben.');
                ids.add(noteId);
            }
        }
        if (kind !== 'project' && existing.some(entry => !ids.has(entry.id)))
            throw new Error('Meldungen dieses Eintrags können nicht gelöscht werden.');
        for (const note of notes) {
            if (note.id === null)
                this.addHistoryNote(kind, id, note.text);
            else if (existing.find(entry => entry.id === note.id)?.newValue !== note.text.trim())
                this.db.prepare('UPDATE history SET new_value=? WHERE id=? AND manual=1').run(note.text.trim(), note.id);
        }
        if (kind === 'project')
            for (const entry of existing)
                if (!ids.has(entry.id))
                    this.db.prepare('DELETE FROM history WHERE id=? AND manual=1').run(entry.id);
    }
    saveProject(id: number | null, fields: ProjectFields): number {
        if (fields.kind !== 'normal' && fields.kind !== 'software')
            throw new Error('Der Projekttyp ist ungültig.');
        const deadline = validDate(fields.dueDate ?? null);
        const args = [title(fields.title), priority(fields.priority), description(fields.description), fields.kind, deadline] as const;
        if (id === null) {
            const projectId = this.nextEntityId('projects', 'project');
            this.db.prepare('INSERT INTO projects (id, title, priority, description, kind, due_date) VALUES (?, ?, ?, ?, ?, ?)').run(projectId, ...args);
            return projectId;
        }
        identifier(id);
        this.withSavepoint(() => {
            if (fields.kind === 'normal' && (this.db.prepare("SELECT 1 FROM tasks WHERE project_id=? AND kind IN ('feature','fix')").get(id) || this.db.prepare('SELECT 1 FROM releases WHERE project_id=?').get(id)))
                throw new Error('Verschiebe zuerst die Features und Fixes in ein anderes Softwareprojekt.');
            if (deadline !== null) {
                const conflicts = this.db.prepare('SELECT title, due_date AS dueDate FROM tasks WHERE project_id=? AND due_date>? ORDER BY due_date, id').all(id, deadline) as unknown as {
                    title: string;
                    dueDate: string;
                }[];
                if (conflicts.length)
                    throw new Error('Diese Einträge liegen nach der Projektfrist: ' + conflicts.map(item => `${item.title} (${item.dueDate.split('-').reverse().join('.')})`).join('; '));
            }
            if (!this.db.prepare('UPDATE projects SET title=?, priority=?, description=?, kind=?, due_date=? WHERE id=?').run(...args, id).changes)
                throw new Error('Das Projekt wurde nicht gefunden.');
        });
        return id;
    }
    createRelease(projectId: number, version: string, dueDate: string | null = null): number {
        identifier(projectId);
        const name = title(version);
        const date = validDate(dueDate);
        if (!this.db.prepare("SELECT 1 FROM projects WHERE id=? AND kind='software'").get(projectId))
            throw new Error('Releases benötigen ein Softwareprojekt.');
        if (this.db.prepare('SELECT 1 FROM releases WHERE project_id=? AND version=?').get(projectId, name))
            throw new Error('Diese Version ist in diesem Projekt bereits vorhanden.');
        const id = this.nextEntityId('releases', 'release');
        this.db.prepare('INSERT INTO releases (id,project_id,version,due_date) VALUES (?,?,?,?)').run(id, projectId, name, date);
        return id;
    }
    renameRelease(id: number, version: string, dueDate: string | null, status?: ReleaseStatus): number {
        identifier(id);
        const name = title(version);
        const date = validDate(dueDate);
        if (status !== undefined && !['planned', 'in_progress', 'paused', 'published'].includes(status))
            throw new Error('Der Releasestatus ist ungültig.');
        const release = this.db.prepare('SELECT project_id AS projectId, status FROM releases WHERE id=?').get(id) as {
            projectId: number;
            status: ReleaseStatus;
        } | undefined;
        if (!release)
            throw new Error('Das Release wurde nicht gefunden.');
        if (this.db.prepare('SELECT 1 FROM releases WHERE project_id=? AND version=? AND id<>?').get(release.projectId, name, id))
            throw new Error('Diese Version ist in diesem Projekt bereits vorhanden.');
        const nextStatus = status ?? release.status;
        if (nextStatus === 'published' && release.status !== 'published')
            this.ensureReleaseCanPublish(id);
        this.db.prepare('UPDATE releases SET version=?, due_date=?, published=?, status=? WHERE id=?').run(name, date, Number(nextStatus === 'published'), nextStatus, id);
        return id;
    }
    deleteRelease(id: number): void {
        identifier(id);
        this.withSavepoint(() => {
            if (!this.db.prepare('SELECT 1 FROM releases WHERE id=?').get(id))
                throw new Error('Das Release wurde nicht gefunden.');
            this.db.prepare('UPDATE tasks SET release_id=NULL, target_version=NULL WHERE release_id=?').run(id);
            this.db.prepare('DELETE FROM releases WHERE id=?').run(id);
        });
    }
    private ensureReleaseCanPublish(id: number): void {
        const open = this.db.prepare("SELECT title, kind FROM tasks WHERE release_id=? AND status<>'done' ORDER BY id").all(id) as unknown as {
            title: string;
            kind: string;
        }[];
        if (open.length)
            throw new Error('Schließe zuerst diese Einträge ab: ' + open.map(item => `${item.kind === 'task' ? 'Aufgabe' : item.kind === 'fix' ? 'Fix' : 'Feature'}: ${item.title}`).join('; '));
    }
    publishRelease(id: number): void {
        identifier(id);
        if (!this.db.prepare('SELECT 1 FROM releases WHERE id=? AND published=0').get(id))
            throw new Error('Das Release wurde nicht gefunden oder ist bereits veröffentlicht.');
        this.ensureReleaseCanPublish(id);
        this.db.prepare("UPDATE releases SET published=1, status='published' WHERE id=?").run(id);
    }
    private ensureCanComplete(id: number): void {
        if (this.db.prepare('SELECT 1 FROM subtasks WHERE task_id=? AND completed=0').get(id))
            throw new Error('Schließe zuerst alle Unteraufgaben ab.');
        if (this.db.prepare('SELECT 1 FROM task_dependencies d JOIN tasks t ON t.id=d.predecessor_id WHERE d.successor_id=? AND t.completed=0').get(id))
            throw new Error('Schließe zuerst alle Vorgänger ab.');
    }
    private ensureCanReopen(id: number): void {
        if (this.db.prepare('SELECT 1 FROM task_dependencies d JOIN tasks t ON t.id=d.successor_id WHERE d.predecessor_id=? AND t.completed=1').get(id))
            throw new Error('Öffne zuerst die erledigten Folgeaufgaben wieder.');
    }
    saveTask(id: number | null, fields: TaskFields): number {
        const name = title(fields.title), rank = priority(fields.priority), desc = description(fields.description), state = status(fields.status);
        const projectId = fields.projectId === null ? null : identifier(fields.projectId);
        if (fields.kind !== 'task' && fields.kind !== 'feature' && fields.kind !== 'fix')
            throw new Error('Der Aufgabentyp ist ungültig.');
        if (fields.kind !== 'task' && (projectId === null || !this.db.prepare("SELECT 1 FROM projects WHERE id=? AND kind='software'").get(projectId)))
            throw new Error('Features und Fixes benötigen ein Softwareprojekt.');
        const releaseId = fields.releaseId === null ? null : identifier(fields.releaseId);
        if (releaseId !== null) {
            const release = this.db.prepare('SELECT project_id AS projectId, published FROM releases WHERE id=?').get(releaseId) as {
                projectId: number;
                published: number;
            } | undefined;
            const existing = id === null ? undefined : this.db.prepare('SELECT release_id AS releaseId FROM tasks WHERE id=?').get(identifier(id)) as {
                releaseId: number | null;
            } | undefined;
            if (!release || release.projectId !== projectId || (release.published && existing?.releaseId !== releaseId))
                throw new Error('Wähle ein geplantes Release desselben Softwareprojekts.');
        }
        const criteria = this.validateCriteria(fields.kind, fields.criteria);
        const { subtasks, subtaskIds } = this.validateSubtasks(fields.subtasks);
        if (fields.featureId !== null)
            throw new Error('Aufgaben-Zuordnungen werden nicht mehr unterstützt.');
        const featureId = null;
        const due = validDate(fields.dueDate);
        if (!Array.isArray(fields.predecessorIds))
            throw new Error('Die Vorgänger sind ungültig.');
        const predecessors = [...new Set(fields.predecessorIds.map(identifier))];
        return this.withSavepoint(() => {
            this.validateProjectDeadline(projectId, due);
            let taskId: number;
            if (id === null) {
                taskId = Number(this.db.prepare('INSERT INTO tasks (id,title,priority,description,project_id,due_date,status,completed,kind) VALUES (?,?,?,?,?,?,?,?,?)').run(this.nextEntityId('tasks', 'task'), name, rank, desc, projectId, due, 'planned', 0, fields.kind).lastInsertRowid);
            }
            else {
                taskId = identifier(id);
                if (!this.db.prepare('SELECT 1 FROM tasks WHERE id=?').get(taskId))
                    throw new Error('Die Aufgabe wurde nicht gefunden.');
            }
            this.validateCriterionOwnership(taskId, criteria);
            if (subtasks)
                this.saveSubtasks(taskId, subtasks, subtaskIds);
            if (state !== 'done')
                this.ensureCanReopen(taskId);
            this.replacePredecessors(taskId, predecessors);
            if (state === 'done')
                this.ensureCanComplete(taskId);
            this.db.prepare('UPDATE tasks SET title=?, priority=?, description=?, project_id=?, due_date=?, status=?, completed=?, kind=?, target_version=NULL, feature_id=?, release_id=? WHERE id=?').run(name, rank, desc, projectId, due, state, Number(state === 'done'), fields.kind, featureId, releaseId, taskId);
            this.replaceCriteria(taskId, criteria);
            return taskId;
        });
    }

    private validateCriteria(kind: TaskFields['kind'], input: TaskFields['criteria']): TaskFields['criteria'] {
        if (!Array.isArray(input))
            throw new Error('Die Akzeptanzkriterien sind ungültig.');
        if (kind === 'task' && input.length)
            throw new Error('Akzeptanzkriterien gehören zu einem Feature oder Fix.');
        const criteria = input.map(criterion => {
            if (!criterion || typeof criterion.text !== 'string' || !criterion.text.trim() || criterion.text.trim().length > 1000 || typeof criterion.completed !== 'boolean')
                throw new Error('Ein Akzeptanzkriterium muss zwischen 1 und 1000 Zeichen haben.');
            return {
                id: criterion.id === null ? null : identifier(criterion.id),
                text: criterion.text.trim(),
                completed: criterion.completed
            };
        });
        const existingIds = criteria.filter(c => c.id !== null).map(c => c.id);
        if (new Set(existingIds).size !== existingIds.length)
            throw new Error('Ein Akzeptanzkriterium wurde mehrfach angegeben.');
        return criteria;
    }

    private validateSubtasks(input: TaskFields['subtasks']) {
        if (input !== undefined && !Array.isArray(input))
            throw new Error('Die Unteraufgaben sind ungültig.');
        const subtasks = input?.map(subtask => ({ id: subtask.id === null ? null : identifier(subtask.id), title: title(subtask.title) }));
        const subtaskIds = subtasks?.flatMap(subtask => subtask.id === null ? [] : [subtask.id]) ?? [];
        if (new Set(subtaskIds).size !== subtaskIds.length)
            throw new Error('Eine Unteraufgabe wurde mehrfach angegeben.');
        return { subtasks, subtaskIds };
    }

    private validateProjectDeadline(projectId: number | null, due: string | null): void {
        if (projectId !== null && due !== null) {
            const project = this.db.prepare('SELECT due_date AS dueDate FROM projects WHERE id=?').get(projectId) as {
                dueDate: string | null;
            } | undefined;
            if (!project)
                throw new Error('Das Projekt wurde nicht gefunden.');
            if (project.dueDate !== null && due > project.dueDate)
                throw new Error(`Das Fälligkeitsdatum darf nicht nach der Projektfrist am ${project.dueDate.split('-').reverse().join('.')} liegen.`);
        }
    }

    private validateCriterionOwnership(taskId: number, criteria: TaskFields['criteria']): void {
        for (const criterion of criteria)
            if (criterion.id !== null && !this.db.prepare('SELECT 1 FROM acceptance_criteria WHERE id=? AND task_id=?').get(criterion.id, taskId))
                throw new Error('Das Akzeptanzkriterium wurde nicht gefunden.');
    }

    private saveSubtasks(taskId: number, subtasks: NonNullable<TaskFields['subtasks']>, subtaskIds: number[]): void {
        for (const subtaskId of subtaskIds)
            if (!this.db.prepare('SELECT 1 FROM subtasks WHERE id=? AND task_id=?').get(subtaskId, taskId))
                throw new Error('Die Unteraufgabe wurde nicht gefunden.');
        const existing = this.db.prepare('SELECT id FROM subtasks WHERE task_id=?').all(taskId) as Array<{
            id: number;
        }>;
        for (const subtask of subtasks) {
            if (subtask.id === null)
                this.db.prepare('INSERT INTO subtasks (task_id,title) VALUES (?,?)').run(taskId, subtask.title);
            else
                this.db.prepare('UPDATE subtasks SET title=? WHERE id=?').run(subtask.title, subtask.id);
        }
        for (const subtask of existing)
            if (!subtaskIds.includes(subtask.id))
                this.db.prepare('DELETE FROM subtasks WHERE id=?').run(subtask.id);
    }

    private replacePredecessors(taskId: number, predecessors: number[]): void {
        this.db.prepare('DELETE FROM task_dependencies WHERE successor_id=?').run(taskId);
        for (const predecessor of predecessors) {
            if (predecessor === taskId || this.db.prepare(`WITH RECURSIVE reachable(id) AS (SELECT successor_id FROM task_dependencies WHERE predecessor_id=? UNION SELECT d.successor_id FROM task_dependencies d JOIN reachable r ON d.predecessor_id=r.id) SELECT 1 FROM reachable WHERE id=?`).get(taskId, predecessor))
                throw new Error('Diese Verknüpfung würde einen Kreis erzeugen.');
            this.db.prepare('INSERT INTO task_dependencies (predecessor_id,successor_id) VALUES (?,?)').run(predecessor, taskId);
        }
    }

    private replaceCriteria(taskId: number, criteria: TaskFields['criteria']): void {
        this.db.prepare('DELETE FROM acceptance_criteria WHERE task_id=?').run(taskId);
        for (const [position, criterion] of criteria.entries())
            if (criterion.id !== null)
                this.db.prepare('INSERT INTO acceptance_criteria (id,task_id,text,completed,position) VALUES (?,?,?,?,?)').run(criterion.id, taskId, criterion.text, Number(criterion.completed), position);
        for (const [position, criterion] of criteria.entries())
            if (criterion.id === null)
                this.db.prepare('INSERT INTO acceptance_criteria (task_id,text,completed,position) VALUES (?,?,?,?)').run(taskId, criterion.text, Number(criterion.completed), position);
    }

    deleteTask(id: number): void {
        identifier(id);
        this.withSavepoint(() => {
            if (!this.db.prepare('SELECT 1 FROM tasks WHERE id=?').get(id))
                throw new Error('Der Eintrag wurde nicht gefunden.');
            this.db.prepare('UPDATE tasks SET feature_id=NULL WHERE feature_id=?').run(id);
            this.db.prepare('DELETE FROM task_dependencies WHERE predecessor_id=? OR successor_id=?').run(id, id);
            this.db.prepare('DELETE FROM subtasks WHERE task_id=?').run(id);
            this.db.prepare('DELETE FROM acceptance_criteria WHERE task_id=?').run(id);
            this.db.prepare('DELETE FROM tasks WHERE id=?').run(id);
        });
    }
    completeTask(id: number, completed: boolean): void {
        identifier(id);
        if (typeof completed !== 'boolean')
            throw new Error('Dieser Aufgabenstatus ist ungültig.');
        if (completed)
            this.ensureCanComplete(id);
        else
            this.ensureCanReopen(id);
        if (!this.db.prepare('UPDATE tasks SET completed=?, status=? WHERE id=?').run(Number(completed), completed ? 'done' : 'planned', id).changes)
            throw new Error('Die Aufgabe wurde nicht gefunden.');
    }
    addSubtask(taskId: number, value: string): void {
        identifier(taskId);
        if (this.db.prepare('SELECT 1 FROM tasks WHERE id=? AND completed=1').get(taskId))
            throw new Error('Öffne die Aufgabe zuerst wieder.');
        this.db.prepare('INSERT INTO subtasks (task_id,title) VALUES (?,?)').run(taskId, title(value));
    }
    completeSubtask(id: number, completed: boolean): void {
        identifier(id);
        if (typeof completed !== 'boolean')
            throw new Error('Dieser Status ist ungültig.');
        if (!completed && this.db.prepare('SELECT 1 FROM subtasks s JOIN tasks t ON t.id=s.task_id WHERE s.id=? AND t.completed=1').get(id))
            throw new Error('Öffne die übergeordnete Aufgabe zuerst wieder.');
        if (!this.db.prepare('UPDATE subtasks SET completed=? WHERE id=?').run(Number(completed), id).changes)
            throw new Error('Die Unteraufgabe wurde nicht gefunden.');
    }
    completeCriterion(id: number, completed: boolean): void {
        identifier(id);
        if (typeof completed !== 'boolean')
            throw new Error('Dieser Status ist ungültig.');
        if (!this.db.prepare('UPDATE acceptance_criteria SET completed=? WHERE id=?').run(Number(completed), id).changes)
            throw new Error('Das Akzeptanzkriterium wurde nicht gefunden.');
    }
    close(): void {
        this.db.close();
    }
}
