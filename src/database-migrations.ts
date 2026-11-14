import type { DatabaseSync } from 'node:sqlite';

export function migrateDatabase(db: DatabaseSync): void {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec(`CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120), priority TEXT NOT NULL CHECK (priority IN ('low','normal','high'))) STRICT;
  CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120), priority TEXT NOT NULL CHECK (priority IN ('low','normal','high')), project_id INTEGER REFERENCES projects(id), completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0,1))) STRICT;`);
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    try {
        const columns = (table: string) => new Set((db.prepare(`PRAGMA table_info(${table})`).all() as unknown as {
            name: string;
        }[]).map(c => c.name));
        const pc = columns('projects');
        const tc = columns('tasks');
        if (!pc.has('kind'))
            db.exec("ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'normal' CHECK (kind IN ('normal','software'))");
        if (!tc.has('kind'))
            db.exec("ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'task' CHECK (kind IN ('task','feature'))");
        if (!pc.has('due_date'))
            db.exec('ALTER TABLE projects ADD COLUMN due_date TEXT');
        if (!pc.has('description'))
            db.exec("ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT ''");
        if (!tc.has('feature_id'))
            db.exec('ALTER TABLE tasks ADD COLUMN feature_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL');
        if (!tc.has('target_version'))
            db.exec('ALTER TABLE tasks ADD COLUMN target_version TEXT');
        if (!tc.has('description'))
            db.exec("ALTER TABLE tasks ADD COLUMN description TEXT NOT NULL DEFAULT ''");
        if (!tc.has('due_date'))
            db.exec('ALTER TABLE tasks ADD COLUMN due_date TEXT');
        if (!tc.has('status')) {
            db.exec("ALTER TABLE tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','paused','done'))");
            db.exec("UPDATE tasks SET status = 'done' WHERE completed = 1");
        }
        const taskSchema = db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='tasks'").get() as {
            sql: string;
        };
        if (!taskSchema.sql.includes("'fix'")) {
            const auxiliary = db.prepare("SELECT sql FROM sqlite_schema WHERE tbl_name='tasks' AND type IN ('index','trigger') AND sql IS NOT NULL").all() as unknown as {
                sql: string;
            }[];
            db.exec(`CREATE TABLE tasks_new (
     id INTEGER PRIMARY KEY,
     title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
     priority TEXT NOT NULL CHECK (priority IN ('low','normal','high')),
     project_id INTEGER REFERENCES projects(id),
     completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0,1)),
     kind TEXT NOT NULL DEFAULT 'task' CHECK (kind IN ('task','feature','fix')),
     description TEXT NOT NULL DEFAULT '', due_date TEXT,
     status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','paused','done')),
     target_version TEXT, feature_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL
    ) STRICT;
    INSERT INTO tasks_new (id,title,priority,project_id,completed,kind,description,due_date,status,target_version,feature_id)
     SELECT id,title,priority,project_id,completed,kind,description,due_date,status,target_version,feature_id FROM tasks;
    DROP TABLE tasks;
    ALTER TABLE tasks_new RENAME TO tasks;`);
            for (const object of auxiliary)
                db.exec(object.sql);
        }
        db.exec(`CREATE TABLE IF NOT EXISTS releases (
    id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id),
    version TEXT NOT NULL CHECK (length(trim(version)) BETWEEN 1 AND 120),
    published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
    UNIQUE(project_id,version)
   ) STRICT;`);
        const releaseColumns = columns('releases');
        if (!releaseColumns.has('due_date'))
            db.exec('ALTER TABLE releases ADD COLUMN due_date TEXT');
        if (!releaseColumns.has('status')) {
            db.exec("ALTER TABLE releases ADD COLUMN status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','paused','published'))");
            db.exec("UPDATE releases SET status='published' WHERE published=1");
        }
        if (!tc.has('release_id')) {
            db.exec(`ALTER TABLE tasks ADD COLUMN release_id INTEGER REFERENCES releases(id);
     INSERT INTO releases (project_id, version)
      SELECT DISTINCT t.project_id, trim(t.target_version) FROM tasks t JOIN projects p ON p.id=t.project_id
      WHERE t.kind IN ('feature','fix') AND p.kind='software' AND t.target_version IS NOT NULL AND length(trim(t.target_version))>0
      ON CONFLICT(project_id,version) DO NOTHING;
     UPDATE tasks SET release_id=(SELECT r.id FROM releases r WHERE r.project_id=tasks.project_id AND r.version=trim(tasks.target_version))
      WHERE kind IN ('feature','fix') AND target_version IS NOT NULL AND length(trim(target_version))>0;`);
        }
        db.exec(`CREATE TABLE IF NOT EXISTS subtasks (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120), completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0,1))) STRICT;
   CREATE TABLE IF NOT EXISTS acceptance_criteria (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, text TEXT NOT NULL CHECK (length(trim(text)) BETWEEN 1 AND 1000), completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0,1)), position INTEGER NOT NULL) STRICT;
   CREATE TABLE IF NOT EXISTS task_dependencies (predecessor_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, successor_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, PRIMARY KEY (predecessor_id, successor_id), CHECK (predecessor_id != successor_id)) STRICT;`);
        db.exec('CREATE TABLE IF NOT EXISTS workspace_revision (id INTEGER PRIMARY KEY CHECK (id=1), revision INTEGER NOT NULL) STRICT; INSERT OR IGNORE INTO workspace_revision VALUES (1,0)');
        for (const table of ['projects', 'tasks', 'releases', 'subtasks', 'acceptance_criteria', 'task_dependencies'])
            for (const action of ['INSERT', 'UPDATE', 'DELETE'])
                db.exec(`CREATE TRIGGER IF NOT EXISTS revision_${table}_${action.toLowerCase()} AFTER ${action} ON ${table} BEGIN UPDATE workspace_revision SET revision=revision+1 WHERE id=1; END`);
        db.exec(`CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY, entity_kind TEXT NOT NULL, entity_id INTEGER NOT NULL, project_id INTEGER,
    entity_title TEXT NOT NULL, date TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    field TEXT NOT NULL, old_value TEXT, new_value TEXT, manual INTEGER NOT NULL DEFAULT 0
   ) STRICT;
   CREATE TRIGGER IF NOT EXISTS revision_history_insert AFTER INSERT ON history BEGIN UPDATE workspace_revision SET revision=revision+1 WHERE id=1; END;`);
        db.exec(`CREATE TRIGGER IF NOT EXISTS revision_history_update AFTER UPDATE ON history BEGIN UPDATE workspace_revision SET revision=revision+1 WHERE id=1; END;
   CREATE TRIGGER IF NOT EXISTS revision_history_delete AFTER DELETE ON history BEGIN UPDATE workspace_revision SET revision=revision+1 WHERE id=1; END;`);
        db.exec('UPDATE tasks SET feature_id=NULL WHERE feature_id IS NOT NULL');
        if (db.prepare('PRAGMA foreign_key_check').get())
            throw new Error('Die Datenbank enthält ungültige Verknüpfungen.');
        db.exec('COMMIT');
    }
    catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
    finally {
        db.exec('PRAGMA foreign_keys = ON');
    }
}
