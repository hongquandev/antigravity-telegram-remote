import { InlineKeyboard } from 'grammy';
import { t } from '../utils/i18n';
import { escapeHtml } from '../utils/telegramFormatter';

export const PROJECT_SELECT_ID = 'project_select';
export const WORKSPACE_SELECT_ID = 'workspace_select';
export const PROJECT_PAGE_PREFIX = 'project_page';
export const ITEMS_PER_PAGE = 100;

export function parseProjectPageId(customId: string): number {
    if (!customId.startsWith(`${PROJECT_PAGE_PREFIX}:`)) return NaN;
    return parseInt(customId.slice(PROJECT_PAGE_PREFIX.length + 1), 10);
}

export function isProjectSelectId(customId: string): boolean {
    return (
        customId === PROJECT_SELECT_ID ||
        customId === WORKSPACE_SELECT_ID ||
        customId.startsWith(`${PROJECT_SELECT_ID}:`)
    );
}

export function buildProjectListUI(
    workspaces: string[],
    page: number = 0,
): { text: string; keyboard: InlineKeyboard } {
    const totalPages = Math.max(1, Math.ceil(workspaces.length / ITEMS_PER_PAGE));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));

    if (workspaces.length === 0) {
        return {
            text: `<b>📁 Projects</b>\n\n${t('No projects found.')}`,
            keyboard: new InlineKeyboard(),
        };
    }

    const start = safePage * ITEMS_PER_PAGE;
    const end = Math.min(start + ITEMS_PER_PAGE, workspaces.length);
    const pageItems = workspaces.slice(start, end);

    const lines = pageItems.map((ws, i) =>
        `${start + i + 1}. ${escapeHtml(ws)}`,
    );

    let text = `<b>📁 Projects</b>\n\n` +
        t('Select a project to auto-create a topic and session') + `\n\n` +
        lines.join('\n');

    if (totalPages > 1) {
        text += `\n\n<i>Page ${safePage + 1} / ${totalPages} (${workspaces.length} projects total)</i>`;
    }

    const keyboard = new InlineKeyboard();

    for (const ws of pageItems) {
        const label = ws.length > 40 ? ws.substring(0, 37) + '...' : ws;
        keyboard.text(label, `${PROJECT_SELECT_ID}:${ws}`).row();
    }

    if (totalPages > 1) {
        if (safePage > 0) {
            keyboard.text('◀ Prev', `${PROJECT_PAGE_PREFIX}:${safePage - 1}`);
        }
        if (safePage < totalPages - 1) {
            keyboard.text('Next ▶', `${PROJECT_PAGE_PREFIX}:${safePage + 1}`);
        }
        keyboard.row();
    }

    return { text, keyboard };
}
