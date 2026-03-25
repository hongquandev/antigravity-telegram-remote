import { version } from '../../package.json';

const C = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
} as const;

/** Length of a string ignoring ANSI escape codes. */
function visibleLength(s: string): number {
    return s.replace(/\x1b\[\d+m/g, '').length;
}

export function printWelcome(): void {
    const logo = [
        `${C.cyan}            ,_,${C.reset}`,
        `${C.cyan}           (O,O)${C.reset}`,
        `${C.cyan}           (   )${C.reset}`,
        `${C.cyan}           -"-"-${C.reset}`,
    ].join('\n');

    const width = 50;
    const borderTop = `╭${'─'.repeat(width)}╮`;
    const borderBottom = `╰${'─'.repeat(width)}╯`;
    const pad = (s: string) => `│  ${s}${''.padEnd(width - visibleLength(s) - 4)}  │`;
    const empty = `│${''.padEnd(width)}│`;

    const lines = [
        '',
        borderTop,
        empty,
        ...logo.split('\n').map(l => pad(l)),
        empty,
        pad(`${C.bold}Antigravity Telegram Remote${C.reset} v${version}`),
        pad(`${C.dim}Control Antigravity from your phone${C.reset}`),
        empty,
        pad(`${C.yellow}Quick start:${C.reset}`),
        pad(`  ${C.bold}1.${C.reset} ${C.green}antigravity-telegram-remote setup${C.reset}   ${C.dim}— configure Telegram bot${C.reset}`),
        pad(`  ${C.bold}2.${C.reset} ${C.green}antigravity-telegram-remote open${C.reset}    ${C.dim}— launch Antigravity + CDP${C.reset}`),
        pad(`  ${C.bold}3.${C.reset} ${C.green}antigravity-telegram-remote start${C.reset}   ${C.dim}— start the bot${C.reset}`),
        empty,
        pad(`${C.dim}Troubleshoot: ${C.reset}${C.green}antigravity-telegram-remote doctor${C.reset}`),
        pad(`${C.dim}GitHub: ${C.reset}${C.cyan}github.com/optimistengineer/remoat${C.reset}`),
        empty,
        borderBottom,
        '',
    ];

    console.log(lines.join('\n'));
}
