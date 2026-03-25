import { InlineKeyboard } from 'grammy';
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
    console.log(`[DEBUG] buildProjectListUI: wsCount=${workspaces.length}, page=${page}`);
    const totalPages = Math.max(1, Math.ceil(workspaces.length / ITEMS_PER_PAGE));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));

    if (workspaces.length === 0) {
        return {
            text: `<b>📁 Dự án</b>\n\nKhông tìm thấy dự án nào.`,
            keyboard: new InlineKeyboard(),
        };
    }

    const start = safePage * ITEMS_PER_PAGE;
    const end = Math.min(start + ITEMS_PER_PAGE, workspaces.length);
    const pageItems = workspaces.slice(start, end);

    const lines = pageItems.map((ws, i) =>
        `${start + i + 1}. ${escapeHtml(ws)}`,
    );

    let text = `<b>📁 Dự án</b>\n\n` +
        `Chọn một dự án để tự động tạo topic và phiên làm việc` + `\n\n` +
        lines.join('\n');

    if (totalPages > 1) {
        text += `\n\n<i>Trang ${safePage + 1} / ${totalPages} (${workspaces.length} tổng số dự án)</i>`;
    }

    const keyboard = new InlineKeyboard();

    for (const ws of pageItems) {
        const label = ws.length > 40 ? ws.substring(0, 37) + '...' : ws;
        keyboard.text(label, `${PROJECT_SELECT_ID}:${ws}`).row();
    }

    if (totalPages > 1) {
        if (safePage > 0) {
            keyboard.text(`◀ Trước`, `${PROJECT_PAGE_PREFIX}:${safePage - 1}`);
        }
        if (safePage < totalPages - 1) {
            keyboard.text(`Tiếp ▶`, `${PROJECT_PAGE_PREFIX}:${safePage + 1}`);
        }
        keyboard.row();
    }

    return { text, keyboard };
}
