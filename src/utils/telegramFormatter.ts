/**
 * Telegram text formatter — HTML-based formatting for Telegram messages.
 * Formats text for Telegram HTML parse mode.
 */

const UI_CHROME_LITERALS = new Set([
    'analyzed', 'analyzing', 'reading', 'writing', 'running',
    'searching', 'planning', 'thinking', 'thinking...', 'processing',
    'loading', 'executing', 'testing', 'debugging', 'read', 'wrote',
    'ran', 'good', 'bad', 'good bad', 'show details',
    'json', 'css', 'html', 'xml', 'yaml', 'toml', 'sql', 'graphql',
]);

const UI_CHROME_REGEXES: RegExp[] = [
    /^[+-]\d+$/,
    /^\d+\s*chars?$/i,
    /^line\s+\d+/i,
    /^col\s+\d+/i,
    /^tool call:/i,
    /^tool result:/i,
    /^calling tool\b/i,
    /^tool response\b/i,
    /^mcp\b/i,
    /^thought for\s*<?\d+/i,
    /^show details$/i,
    /^[a-z0-9._-]+\s*\/\s*[a-z0-9._-]+$/i,
    /^full output written to\b/i,
    /^output\.[a-z0-9._-]+(?:#l\d+(?:-\d+)?)?$/i,
    /^\s*\{\s*$/,
    /^\s*\}\s*$/,
    /^\s*"[^"]*"\s*:\s*/,
];

function isUiChromeLine(line: string): boolean {
    const trimmed = (line || '').trim();
    if (!trimmed) return false;
    const lower = trimmed.toLowerCase();
    if (UI_CHROME_LITERALS.has(lower)) return true;
    for (const re of UI_CHROME_REGEXES) {
        if (re.test(trimmed)) return true;
    }
    return false;
}

const FILE_REF_REGEX = /(?<![`/\\])(\b[a-zA-Z][\w.-]*(?:\/[\w.-]+)+(?::\d+(?:-\d+)?)?)\s?(?!`)/g;

/**
 * Escape special HTML characters for Telegram HTML parse mode.
 */
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Format text for Telegram HTML display.
 * Converts Markdown syntax to Telegram HTML, wraps table/tree lines in <pre>,
 * and file references in <code>.
 */
export function formatForTelegram(text: string): string {
    const lines = text.split('\n');
    const result: string[] = [];
    let inSpecialBlock = false;
    let inCodeBlock = false;
    let codeBlockHasLang = false;
    let inBlockquote = false;
    const blockquoteLines: string[] = [];

    const flushBlockquote = () => {
        if (blockquoteLines.length > 0) {
            result.push(`<blockquote>${blockquoteLines.join('\n')}</blockquote>`);
            blockquoteLines.length = 0;
        }
        inBlockquote = false;
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed.startsWith('```')) {
            if (inBlockquote) flushBlockquote();
            inCodeBlock = !inCodeBlock;
            if (inCodeBlock) {
                const lang = trimmed.slice(3).trim();
                codeBlockHasLang = !!lang;
                result.push(lang ? `<pre><code class="language-${escapeHtml(lang)}">` : '<pre>');
            } else {
                result.push(codeBlockHasLang ? '</code></pre>' : '</pre>');
                codeBlockHasLang = false;
            }
            continue;
        }

        if (inCodeBlock) {
            result.push(escapeHtml(line));
            continue;
        }

        const isTableLine =
            (trimmed.startsWith('|') && trimmed.length > 2) ||
            /^\|[\s\-:]+\|/.test(trimmed);

        const isTreeLine = /[├└│┌┐┘┤┬┴┼]/.test(line) ||
            /^\s*[│├└]\s*──/.test(line) ||
            /^\s*\|.*──/.test(line);

        const isSpecialLine = isTableLine || isTreeLine;

        // Blockquote lines: > text
        if (trimmed.startsWith('>') && !isSpecialLine) {
            if (inSpecialBlock) {
                result.push('</pre>');
                inSpecialBlock = false;
            }
            inBlockquote = true;
            const quoteContent = trimmed.replace(/^>\s?/, '');
            blockquoteLines.push(formatMarkdownLine(escapeHtml(quoteContent)));
            continue;
        } else if (inBlockquote) {
            flushBlockquote();
        }

        if (isSpecialLine && !inSpecialBlock) {
            result.push('<pre>');
            inSpecialBlock = true;
            result.push(escapeHtml(line));
        } else if (isSpecialLine && inSpecialBlock) {
            result.push(escapeHtml(line));
        } else if (!isSpecialLine && inSpecialBlock) {
            result.push('</pre>');
            inSpecialBlock = false;
            result.push(formatMarkdownLine(wrapFileReferences(escapeHtml(line))));
        } else {
            result.push(formatMarkdownLine(wrapFileReferences(escapeHtml(line))));
        }
    }

    if (inBlockquote) flushBlockquote();
    if (inSpecialBlock) {
        result.push('</pre>');
    }
    if (inCodeBlock) {
        result.push(codeBlockHasLang ? '</code></pre>' : '</pre>');
    }

    return result.join('\n');
}

/**
 * Convert Markdown inline/line-level syntax to Telegram HTML.
 * Expects input that is already HTML-escaped.
 */
function formatMarkdownLine(line: string): string {
    let result = line;

    // Headings: ### Title → <b>Title</b>
    const headingMatch = result.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
        return `<b>${headingMatch[2]}</b>`;
    }

    // Horizontal rule: --- or *** or ___ → ---
    if (/^(?:---+|\*\*\*+|___+)\s*$/.test(result.trim())) {
        return '---';
    }

    // Inline code: `code` → <code>code</code> (must be before bold/italic)
    result = result.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Links: [text](url) → <a href="url">text</a>
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Bold: **text** or __text__ → <b>text</b>
    result = result.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    result = result.replace(/__(.+?)__/g, '<b>$1</b>');

    // Italic: *text* or _text_ → <i>text</i> (but not inside words for _)
    result = result.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '<i>$1</i>');
    result = result.replace(/(?<!\w)_([^_]+)_(?!\w)/g, '<i>$1</i>');

    // Strikethrough: ~~text~~ → <s>text</s>
    result = result.replace(/~~(.+?)~~/g, '<s>$1</s>');

    return result;
}

function wrapFileReferences(line: string): string {
    return line.replace(FILE_REF_REGEX, '<code>$1</code>');
}

function isMcpFormatLine(line: string): boolean {
    return /^[a-z0-9._-]+\s*\/\s*[a-z0-9._-]+$/i.test(line);
}

function isActivityLogLine(line: string): boolean {
    const trimmed = (line || '').trim();
    if (!trimmed) return false;
    return /^(?:analy[sz]ing|reading|writing|running|searching|planning|thinking|processing|loading|executing|testing|debugging|analyzed|read|wrote|ran)\s+.+/i.test(trimmed)
        && trimmed.length <= 220;
}

export function splitOutputAndLogs(rawText: string): { output: string; logs: string } {
    const normalized = (rawText || '').replace(/\r/g, '');
    if (!normalized.trim()) {
        return { output: '', logs: '' };
    }

    const lines = normalized.split('\n');
    type LineClass = 'output' | 'chrome' | 'blank' | 'code';
    const classes: LineClass[] = [];
    let inCodeBlock = false;

    for (const line of lines) {
        const trimmed = (line || '').trim();
        if (trimmed.startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            classes.push('code');
            continue;
        }
        if (inCodeBlock) { classes.push('code'); continue; }
        if (!trimmed) { classes.push('blank'); continue; }
        if (isUiChromeLine(trimmed) || isActivityLogLine(trimmed)) {
            classes.push('chrome');
        } else {
            classes.push('output');
        }
    }

    const hasMcpCalls = lines.some(
        (l, i) => classes[i] === 'chrome' && isMcpFormatLine(l.trim()),
    );

    if (!hasMcpCalls) {
        const outputLines: string[] = [];
        const logLines: string[] = [];
        for (let i = 0; i < lines.length; i++) {
            if (classes[i] === 'chrome') {
                logLines.push(lines[i].trim());
            } else {
                outputLines.push(lines[i]);
            }
        }
        return {
            output: collapseBlankLines(outputLines.join('\n')),
            logs: collapseBlankLines(logLines.join('\n')),
        };
    }

    let lastOutputEnd = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        if (classes[i] === 'output' || classes[i] === 'code') {
            lastOutputEnd = i;
            break;
        }
    }

    if (lastOutputEnd === -1) {
        const logLines = lines.filter((_, i) => classes[i] === 'chrome').map((l) => l.trim());
        return { output: '', logs: collapseBlankLines(logLines.join('\n')) };
    }

    let lastOutputStart = lastOutputEnd;
    for (let i = lastOutputEnd - 1; i >= 0; i--) {
        if (classes[i] === 'blank' || classes[i] === 'chrome') break;
        if (classes[i] === 'output' || classes[i] === 'code') lastOutputStart = i;
    }

    const outputLines: string[] = [];
    const logLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        if (i >= lastOutputStart && i <= lastOutputEnd) {
            if (classes[i] !== 'chrome') outputLines.push(lines[i]);
            else logLines.push(lines[i].trim());
        } else if (classes[i] === 'chrome' || classes[i] === 'output') {
            logLines.push(lines[i].trim());
        }
    }

    return {
        output: collapseBlankLines(outputLines.join('\n')),
        logs: collapseBlankLines(logLines.join('\n')),
    };
}

function collapseBlankLines(text: string): string {
    return text.replace(/\n{3,}/g, '\n\n').trim();
}

export function separateOutputForDelivery(options: {
    rawText: string;
    domSource: 'dom-structured' | 'legacy-fallback';
    domOutputText?: string;
    domActivityLines?: string[];
}): { source: string; output: string; logs: string } {
    const { rawText, domSource, domOutputText, domActivityLines } = options;

    if (domSource === 'dom-structured' && domOutputText !== undefined) {
        return {
            source: 'dom-structured',
            output: domOutputText,
            logs: (domActivityLines ?? []).join('\n'),
        };
    }

    const separated = splitOutputAndLogs(rawText);
    return { source: 'legacy-fallback', output: separated.output, logs: separated.logs };
}

/**
 * Split an HTML-formatted string into multiple Telegram-safe chunks.
 * Respects HTML tag boundaries — unclosed tags at chunk end are closed
 * and reopened at the start of the next chunk.
 *
 * Supported tags: <pre>, <code>, <b>, <i>, <pre><code ...>
 */
export function splitTelegramHtml(html: string, maxLen: number = 4096): string[] {
    if (html.length <= maxLen) return [html];

    const lines = html.split('\n');
    const chunks: string[] = [];
    let current = '';
    const openTags: string[] = [];  // stack of currently open tags (raw opening tags)

    const closingFor = (tag: string): string => {
        const name = tag.match(/^<(\w+)/)?.[1];
        return name ? `</${name}>` : '';
    };

    const flush = () => {
        if (!current) return;
        // Close any open tags at chunk end
        let suffix = '';
        for (let i = openTags.length - 1; i >= 0; i--) {
            suffix += closingFor(openTags[i]);
        }
        chunks.push(current + suffix);
        // Reopen tags at next chunk start
        current = openTags.join('');
    };

    const trackTags = (line: string) => {
        // Track opening and closing HTML tags
        const tagRegex = /<\/?(\w+)(?:\s[^>]*)?\s*\/?>/g;
        let match;
        while ((match = tagRegex.exec(line)) !== null) {
            const full = match[0];
            if (full.endsWith('/>')) continue;  // self-closing
            const tagName = match[1].toLowerCase();
            if (tagName === 'br') continue;  // void element
            if (full.startsWith('</')) {
                // Closing tag: pop matching open tag
                for (let i = openTags.length - 1; i >= 0; i--) {
                    const openName = openTags[i].match(/^<(\w+)/)?.[1]?.toLowerCase();
                    if (openName === tagName) {
                        openTags.splice(i, 1);
                        break;
                    }
                }
            } else {
                openTags.push(full);
            }
        }
    };

    for (const line of lines) {
        const candidate = current ? `${current}\n${line}` : line;
        // Calculate how much space closing tags would need
        let closingLen = 0;
        for (let i = openTags.length - 1; i >= 0; i--) {
            closingLen += closingFor(openTags[i]).length;
        }

        // Also account for closing tags that would be needed after adding this line
        const tempTags = [...openTags];
        const tempTagRegex = /<\/?(\w+)(?:\s[^>]*)?\s*\/?>/g;
        let m;
        while ((m = tempTagRegex.exec(line)) !== null) {
            const full = m[0];
            if (full.endsWith('/>')) continue;
            const tagName = m[1].toLowerCase();
            if (tagName === 'br') continue;
            if (full.startsWith('</')) {
                for (let j = tempTags.length - 1; j >= 0; j--) {
                    const openName = tempTags[j].match(/^<(\w+)/)?.[1]?.toLowerCase();
                    if (openName === tagName) { tempTags.splice(j, 1); break; }
                }
            } else {
                tempTags.push(full);
            }
        }
        let newClosingLen = 0;
        for (let i = tempTags.length - 1; i >= 0; i--) {
            newClosingLen += closingFor(tempTags[i]).length;
        }

        if (candidate.length + newClosingLen <= maxLen) {
            current = candidate;
            trackTags(line);
            continue;
        }

        // Current chunk is full — flush it
        if (current) {
            flush();
        }

        // If this single line fits in a fresh chunk
        const reopenLen = openTags.join('').length;
        if (reopenLen + line.length + newClosingLen <= maxLen) {
            current = openTags.join('') + line;
            trackTags(line);
            continue;
        }

        // Hard-split a very long line
        let available = maxLen - reopenLen - newClosingLen;
        if (available <= 0) {
            // Edge case: tag overhead alone exceeds limit — just push the line as-is
            current = openTags.join('') + line;
            trackTags(line);
            flush();
            continue;
        }
        let cursor = 0;
        while (cursor < line.length) {
            const slice = line.slice(cursor, cursor + available);
            current = openTags.join('') + slice;
            trackTags(slice);
            cursor += available;
            if (cursor < line.length) {
                flush();
                // Recalculate available space since openTags may have changed
                let updatedClosingLen = 0;
                for (let i = openTags.length - 1; i >= 0; i--) {
                    updatedClosingLen += closingFor(openTags[i]).length;
                }
                available = maxLen - openTags.join('').length - updatedClosingLen;
                if (available <= 0) available = 1; // prevent infinite loop
            }
        }
    }

    // Flush remaining
    if (current) {
        let suffix = '';
        for (let i = openTags.length - 1; i >= 0; i--) {
            suffix += closingFor(openTags[i]);
        }
        chunks.push(current + suffix);
    }

    return chunks.length > 0 ? chunks : [html];
}

export function sanitizeActivityLines(raw: string): string {
    const lines = (raw || '')
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    const kept = lines.filter((line) => !isUiChromeLine(line));
    return Array.from(new Set(kept)).join('\n');
}
