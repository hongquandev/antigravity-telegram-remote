/**
 * HTML-to-Telegram-HTML converter.
 * Converts common HTML tags to Telegram-compatible HTML formatting.
 * Telegram supports: <b>, <i>, <code>, <pre>, <a href="">, <s>, <u>, <blockquote>.
 */

export function htmlToTelegramHtml(html: string): string {
    if (!html) return '';

    let result = html;

    // Remove non-visible elements
    result = result.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    result = result.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

    // Line breaks and separators
    result = result.replace(/<br\s*\/?>/gi, '\n');
    result = result.replace(/<hr\s*\/?>/gi, '\n---\n');

    // Headings (all levels → bold)
    result = result.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_m, content) =>
        `\n<b>${stripTags(content).trim()}</b>\n`,
    );

    // Code blocks: <pre><code> (must come before inline code)
    result = result.replace(
        /<pre[^>]*>\s*<code(?:\s+class="language-([^"]*)")?[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
        (_m, lang, content) => lang
            ? `\n<pre><code class="language-${lang}">${content}</code></pre>\n`
            : `\n<pre>${content}</pre>\n`,
    );

    // Inline code
    result = result.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '<code>$1</code>');

    // Bold
    result = result.replace(
        /<(?:strong|b)(?:\s[^>]*)?>((?: |\s|[^<]|<(?!\/(?:strong|b)>))*)<\/(?:strong|b)>/gi,
        '<b>$1</b>',
    );

    // Italic
    result = result.replace(
        /<(?:em|i)(?:\s[^>]*)?>((?: |\s|[^<]|<(?!\/(?:em|i)>))*)<\/(?:em|i)>/gi,
        '<i>$1</i>',
    );

    // Strikethrough: <del>, <strike>, <s> → <s>
    result = result.replace(
        /<(?:del|strike|s)(?:\s[^>]*)?>([\s\S]*?)<\/(?:del|strike|s)>/gi,
        '<s>$1</s>',
    );

    // Underline: <ins>, <u> → <u>
    result = result.replace(
        /<(?:ins|u)(?:\s[^>]*)?>([\s\S]*?)<\/(?:ins|u)>/gi,
        '<u>$1</u>',
    );

    // Highlight/mark → bold fallback
    result = result.replace(
        /<mark[^>]*>([\s\S]*?)<\/mark>/gi,
        '<b>$1</b>',
    );

    // Links: preserve <a href="...">text</a>
    result = result.replace(
        /<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
        (_m, href, text) => {
            const linkText = stripTags(text).trim();
            if (!href || href.startsWith('#') || href.startsWith('javascript:')) {
                return linkText;
            }
            return `<a href="${href}">${linkText}</a>`;
        },
    );

    // Blockquote → Telegram <blockquote>
    result = result.replace(
        /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi,
        (_m, content) => `\n<blockquote>${stripTags(content).trim()}</blockquote>\n`,
    );

    // Context-scope mentions (Antigravity-specific)
    result = result.replace(
        /<span[^>]*class="[^"]*context-scope-mention[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
        (_m, text) => `<code>${stripTags(text).trim()}</code>`,
    );

    // Elements with title attributes (file paths)
    result = result.replace(
        /<(?:div|span|a)[^>]*\btitle="([^"]*)"[^>]*>([\s\S]*?)<\/(?:div|span|a)>/gi,
        (_m, title, text) => {
            if (looksLikeFilePath(title)) {
                return `${title}${stripTags(text).trim()}`;
            }
            return stripTags(text);
        },
    );

    // Images → show alt text
    result = result.replace(
        /<img[^>]*alt="([^"]*)"[^>]*\/?>/gi,
        (_m, alt) => alt ? `[${alt}]` : '',
    );
    result = result.replace(/<img[^>]*\/?>/gi, '');

    // Details/summary → show as expandable content
    result = result.replace(
        /<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi,
        (_m, summary, content) => {
            const summaryText = stripTags(summary).trim();
            const contentText = stripTags(content).trim();
            return contentText
                ? `\n<b>${summaryText}</b>\n${contentText}\n`
                : `\n<b>${summaryText}</b>\n`;
        },
    );

    // Figure/figcaption → show caption
    result = result.replace(
        /<figure[^>]*>([\s\S]*?)<figcaption[^>]*>([\s\S]*?)<\/figcaption>[\s\S]*?<\/figure>/gi,
        (_m, content, caption) => `${stripTags(content).trim()}\n<i>${stripTags(caption).trim()}</i>\n`,
    );
    result = result.replace(/<figure[^>]*>([\s\S]*?)<\/figure>/gi, '$1');

    // Convert HTML tables to monospace ASCII tables inside <pre>
    result = result.replace(
        /<table[^>]*>([\s\S]*?)<\/table>/gi,
        (_m, tableContent) => {
            const rows: string[][] = [];
            const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
            let rowMatch;
        while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
            const cells: string[] = [];
            const cellRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
            let cellMatch;
            while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
                const cellRaw = stripTags(cellMatch[1]).trim();
                // Telegram HTML requires escaping < > & even inside <pre>
                const escaped = cellRaw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                cells.push(escaped);
            }
            if (cells.length > 0) rows.push(cells);
        }
            if (rows.length === 0) return '';

            const colCount = Math.max(...rows.map(r => r.length));
            const colWidths: number[] = [];
            for (let c = 0; c < colCount; c++) {
                colWidths[c] = Math.max(...rows.map(r => (r[c] || '').length), 1);
            }

            const lines: string[] = [];
            for (let ri = 0; ri < rows.length; ri++) {
                const row = rows[ri];
                const cells = row.map((cell, ci) => cell.padEnd(colWidths[ci]));
                lines.push('| ' + cells.join(' | ') + ' |');
                if (ri === 0) {
                    lines.push('|' + colWidths.map(w => '-'.repeat(w + 2)).join('|') + '|');
                }
            }
            return `\n<pre>${lines.join('\n')}</pre>\n`;
        },
    );

    // Definition lists: <dl>, <dt>, <dd>
    result = result.replace(
        /<dl[^>]*>([\s\S]*?)<\/dl>/gi,
        (_m, content) => {
            let output = '\n';
            output = content.replace(/<dt[^>]*>([\s\S]*?)<\/dt>/gi, (_dm: string, text: string) =>
                `<b>${stripTags(text).trim()}</b>\n`,
            );
            output = output.replace(/<dd[^>]*>([\s\S]*?)<\/dd>/gi, (_ddm: string, text: string) =>
                `  ${stripTags(text).trim()}\n`,
            );
            return `\n${output}`;
        },
    );

    // Superscript/subscript → inline text
    result = result.replace(/<sup[^>]*>([\s\S]*?)<\/sup>/gi, (_m, text) => `^${stripTags(text).trim()}`);
    result = result.replace(/<sub[^>]*>([\s\S]*?)<\/sub>/gi, (_m, text) => `_${stripTags(text).trim()}`);

    // Block-level elements
    result = result.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');
    result = result.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, '$1\n');

    // Lists (iterative for nested lists)
    for (let iteration = 0; iteration < 5; iteration++) {
        if (!/<(?:ul|ol)\b/i.test(result)) break;

        result = result.replace(
            /<ul[^>]*>((?:(?!<\/?(?:ul|ol)\b)[\s\S])*?)<\/ul>/gi,
            (_m, content) => {
                const items = content.replace(
                    /<li[^>]*>([\s\S]*?)<\/li>/gi,
                    (_lm: string, text: string) => `- ${stripTags(text).trim()}\n`,
                );
                return `\n${items}`;
            },
        );

        result = result.replace(
            /<ol[^>]*>((?:(?!<\/?(?:ul|ol)\b)[\s\S])*?)<\/ol>/gi,
            (_m, content) => {
                let counter = 0;
                const items = content.replace(
                    /<li[^>]*>([\s\S]*?)<\/li>/gi,
                    (_lm: string, text: string) => {
                        counter++;
                        return `${counter}. ${stripTags(text).trim()}\n`;
                    },
                );
                return `\n${items}`;
            },
        );
    }

    // Strip remaining HTML tags except the Telegram-supported ones
    result = stripUnsupportedTags(result);

    result = decodeSafeEntities(result);
    result = result.replace(/\n{3,}/g, '\n\n');
    result = result.trim();

    return result;
}

function looksLikeFilePath(value: string): boolean {
    if (!value) return false;
    return /^[a-zA-Z0-9._\-/]+\.[a-zA-Z0-9]+$/.test(value) && value.includes('/');
}

function stripTags(html: string): string {
    return html.replace(/<[^>]+>/g, '');
}

/** Strip HTML tags except the ones Telegram supports */
function stripUnsupportedTags(html: string): string {
    const allowed = /^\/?(b|i|u|s|code|pre|a|blockquote)(\s|>|\/|$)/i;
    return html.replace(/<\/?[^>]+>/g, (tag) => {
        const inner = tag.replace(/^<\/?/, '').replace(/>$/, '');
        return allowed.test(inner) ? tag : '';
    });
}

/**
 * Decode HTML entities that are safe for Telegram HTML mode.
 * Preserves &amp; &lt; &gt; as-is since Telegram requires them escaped.
 */
function decodeSafeEntities(text: string): string {
    return text
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
            const cp = parseInt(hex, 16);
            const ch = String.fromCodePoint(cp);
            if (ch === '&') return '&amp;';
            if (ch === '<') return '&lt;';
            if (ch === '>') return '&gt;';
            return ch;
        })
        .replace(/&#(\d+);/g, (_m, dec) => {
            const cp = parseInt(dec, 10);
            const ch = String.fromCodePoint(cp);
            if (ch === '&') return '&amp;';
            if (ch === '<') return '&lt;';
            if (ch === '>') return '&gt;';
            return ch;
        });
}
