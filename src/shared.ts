export type Priority = 'low' | 'normal' | 'high';
export type ReleaseStatus = 'planned' | 'in_progress' | 'paused' | 'published';
export type TaskStatus = 'planned' | 'in_progress' | 'paused' | 'done';
export type ProjectKind = 'normal' | 'software';
export type TaskKind = 'task' | 'feature' | 'fix';
export interface BaseFields { title: string; priority: Priority; description: string }
export interface ProjectFields extends BaseFields { kind: ProjectKind; dueDate: string | null }
export interface CriterionFields { id: number | null; text: string; completed: boolean }
export interface TaskFields extends BaseFields { kind: TaskKind; featureId: number | null; releaseId: number | null; criteria: CriterionFields[]; projectId: number | null; dueDate: string | null; status: TaskStatus; predecessorIds: number[] }
export interface Project extends ProjectFields { id: number }
export interface Task extends TaskFields { targetVersion: string | null; id: number; completed: boolean; successorIds: number[] }
export interface Subtask { id: number; taskId: number; title: string; completed: boolean }
export interface Release { id: number; projectId: number; version: string; dueDate: string | null; status: ReleaseStatus; published: boolean }
export interface Workspace { revision: number; releases: Release[]; projects: Project[]; tasks: Task[]; subtasks: Subtask[] }
export interface HqApi {
 read(): Promise<Workspace>;
 createRelease(projectId: number, version: string, dueDate: string | null, revision: number): Promise<Workspace>;
 renameRelease(id: number, version: string, dueDate: string | null, status: ReleaseStatus, revision: number): Promise<Workspace>;
 publishRelease(id: number, revision: number): Promise<Workspace>;
 deleteRelease(id: number, revision: number): Promise<Workspace>;
 saveProject(id: number | null, fields: ProjectFields, revision: number): Promise<Workspace>;
 saveTask(id: number | null, fields: TaskFields, revision: number): Promise<Workspace>;
 completeTask(id: number, completed: boolean, revision: number): Promise<Workspace>;
 deleteTask(id: number, revision: number): Promise<Workspace>;
 addSubtask(taskId: number, title: string, revision: number): Promise<Workspace>;
 completeSubtask(id: number, completed: boolean, revision: number): Promise<Workspace>;
 completeCriterion(id: number, completed: boolean, revision: number): Promise<Workspace>;
}
