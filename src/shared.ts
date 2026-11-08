export type Priority = 'low' | 'normal' | 'high';
export type TaskStatus = 'planned' | 'in_progress' | 'paused' | 'done';
export type ProjectKind = 'normal' | 'software';
export type TaskKind = 'task' | 'feature';
export interface BaseFields { title: string; priority: Priority; description: string }
export interface ProjectFields extends BaseFields { kind: ProjectKind }
export interface CriterionFields { id: number | null; text: string; completed: boolean }
export interface TaskFields extends BaseFields { kind: TaskKind; featureId: number | null; targetVersion: string | null; criteria: CriterionFields[]; projectId: number | null; dueDate: string | null; status: TaskStatus; predecessorIds: number[] }
export interface Project extends ProjectFields { id: number }
export interface Task extends TaskFields { id: number; completed: boolean; successorIds: number[] }
export interface Subtask { id: number; taskId: number; title: string; completed: boolean }
export interface Workspace { projects: Project[]; tasks: Task[]; subtasks: Subtask[] }
export interface HqApi {
 read(): Promise<Workspace>;
 saveProject(id: number | null, fields: ProjectFields): Promise<Workspace>;
 saveTask(id: number | null, fields: TaskFields): Promise<Workspace>;
 completeTask(id: number, completed: boolean): Promise<Workspace>;
 deleteTask(id: number): Promise<Workspace>;
 assignFeature(taskId: number, featureId: number | null): Promise<Workspace>;
 addSubtask(taskId: number, title: string): Promise<Workspace>;
 completeSubtask(id: number, completed: boolean): Promise<Workspace>;
 completeCriterion(id: number, completed: boolean): Promise<Workspace>;
}
