import Database from 'better-sqlite3';

/**
 * Template record type definition
 */
export interface TemplateRecord {
    /** Unique ID (auto-increment) */
    id: number;
    /** Template name (unique) */
    name: string;
    /** Prompt to execute */
    prompt: string;
    /** Creation timestamp (ISO string) */
    createdAt?: string;
}

/**
 * Input type for template creation
 */
export interface CreateTemplateInput {
    name: string;
    prompt: string;
}

/**
 * Input type for template update (partial update)
 */
export interface UpdateTemplateInput {
    prompt?: string;
}

/**
 * Repository class for SQLite persistence of frequently used prompt templates.
 * Handles template creation, retrieval, updating, and deletion.
 */
export class TemplateRepository {
    private readonly db: Database.Database;

    // Cached prepared statements
    private readonly stmtCreate: Database.Statement;
    private readonly stmtFindAll: Database.Statement;
    private readonly stmtFindById: Database.Statement;
    private readonly stmtFindByName: Database.Statement;
    private readonly stmtDeleteByName: Database.Statement;

    constructor(db: Database.Database) {
        this.db = db;
        this.initialize();

        this.stmtCreate = this.db.prepare(
            'INSERT INTO templates (name, prompt) VALUES (?, ?)'
        );
        this.stmtFindAll = this.db.prepare(
            'SELECT * FROM templates ORDER BY id ASC'
        );
        this.stmtFindById = this.db.prepare(
            'SELECT * FROM templates WHERE id = ?'
        );
        this.stmtFindByName = this.db.prepare(
            'SELECT * FROM templates WHERE name = ?'
        );
        this.stmtDeleteByName = this.db.prepare(
            'DELETE FROM templates WHERE name = ?'
        );
    }

    private initialize(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS templates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                prompt TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
    }

    public create(input: CreateTemplateInput): TemplateRecord {
        const result = this.stmtCreate.run(input.name, input.prompt);
        return {
            id: result.lastInsertRowid as number,
            name: input.name,
            prompt: input.prompt,
        };
    }

    public findAll(): TemplateRecord[] {
        const rows = this.stmtFindAll.all() as any[];
        return rows.map(this.mapRow);
    }

    public findById(id: number): TemplateRecord | undefined {
        const row = this.stmtFindById.get(id) as any;
        if (!row) return undefined;
        return this.mapRow(row);
    }

    public findByName(name: string): TemplateRecord | undefined {
        const row = this.stmtFindByName.get(name) as any;
        if (!row) return undefined;
        return this.mapRow(row);
    }

    public deleteByName(name: string): boolean {
        const result = this.stmtDeleteByName.run(name);
        return result.changes > 0;
    }

    /**
     * Partially update by template name
     * SECURITY: Uses hardcoded SQL patterns to prevent SQL injection
     */
    public updateByName(name: string, input: UpdateTemplateInput): boolean {
        if (input.prompt !== undefined) {
            const stmt = this.db.prepare('UPDATE templates SET prompt = ? WHERE name = ?');
            const result = stmt.run(input.prompt, name);
            return result.changes > 0;
        }

        return false;
    }

    private mapRow(row: any): TemplateRecord {
        return {
            id: row.id,
            name: row.name,
            prompt: row.prompt,
            createdAt: row.created_at,
        };
    }
}
