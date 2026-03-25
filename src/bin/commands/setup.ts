import * as readline from 'readline';
import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigLoader } from '../../utils/configLoader';
import { CDP_PORTS } from '../../utils/cdpPorts';

const C = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    magenta: '\x1b[35m',
} as const;

const SETUP_LOGO = `
${C.cyan}            ,_,${C.reset}
${C.cyan}           (O,O)${C.reset}
${C.cyan}           (   )${C.reset}
${C.cyan}           -"-"-${C.reset}

     ${C.bold}~ Antigravity Telegram Remote Setup ~${C.reset}
`;

function isNonEmpty(value: string): boolean {
    return value.trim().length > 0;
}

function isNumericString(value: string): boolean {
    return /^\d+$/.test(value.trim());
}

function parseAllowedUserIds(raw: string): string[] {
    return raw.split(',').map((id) => id.trim()).filter((id) => id.length > 0);
}

function validateAllowedUserIds(raw: string): string | null {
    const ids = parseAllowedUserIds(raw);
    if (ids.length === 0) return 'Please enter at least one user ID.';
    const invalid = ids.find((id) => !isNumericString(id));
    if (invalid) return `Invalid user ID: "${invalid}" — must be a numeric string.`;
    return null;
}

function expandTilde(raw: string): string {
    if (raw === '~') return os.homedir();
    if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
    return raw;
}

interface BotInfo {
    id: number;
    username: string;
    first_name: string;
}

function verifyTelegramToken(token: string): Promise<BotInfo | null> {
    return new Promise((resolve) => {
        const req = https.get(`https://api.telegram.org/bot${token}/getMe`, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                if (res.statusCode !== 200) { resolve(null); return; }
                try {
                    const json = JSON.parse(data);
                    if (json.ok && json.result) {
                        resolve({ id: json.result.id, username: json.result.username, first_name: json.result.first_name });
                    } else { resolve(null); }
                } catch { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    });
}

function createInterface(): readline.Interface {
    return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl: readline.Interface, prompt: string): Promise<string> {
    return new Promise((resolve) => { rl.question(prompt, resolve); });
}

function askSecret(rl: readline.Interface, prompt: string): Promise<string> {
    return new Promise((resolve) => {
        if (!process.stdin.isTTY) { rl.question(prompt, resolve); return; }
        process.stdout.write(prompt);
        rl.pause();
        const stdin = process.stdin;
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');
        let input = '';
        const onData = (char: string): void => {
            const code = char.charCodeAt(0);
            if (char === '\r' || char === '\n') {
                stdin.setRawMode(false); stdin.removeListener('data', onData);
                process.stdout.write('\n'); rl.resume(); resolve(input);
            } else if (code === 127 || code === 8) {
                if (input.length > 0) { input = input.slice(0, -1); process.stdout.write('\b \b'); }
            } else if (code === 3) {
                stdin.setRawMode(false); process.stdout.write('\n'); process.exit(0);
            } else if (code >= 32) { input += char; process.stdout.write('*'); }
        };
        stdin.on('data', onData);
    });
}

function stepHeader(step: number, total: number, title: string): void {
    console.log(`  ${C.cyan}[Step ${step}/${total}]${C.reset} ${C.bold}${title}${C.reset}`);
}

function hint(text: string): void {
    console.log(`  ${C.dim}${text}${C.reset}`);
}

function hintBlank(): void { console.log(''); }

function errMsg(text: string): void {
    console.log(`  ${C.red}${text}${C.reset}\n`);
}

const TOTAL_STEPS = 3;

interface SetupResult {
    telegramBotToken: string;
    allowedUserIds: string[];
    workspaceBaseDir: string;
}

async function promptToken(rl: readline.Interface): Promise<{ token: string; botName: string | null }> {
    while (true) {
        const token = await askSecret(rl, `  ${C.yellow}>${C.reset} `);
        if (!isNonEmpty(token)) { errMsg('Token cannot be empty.'); continue; }
        const trimmed = token.trim();

        process.stdout.write(`  ${C.dim}Verifying token...${C.reset}`);
        const botInfo = await verifyTelegramToken(trimmed);

        if (botInfo) {
            process.stdout.write(`\r  ${C.green}Verified!${C.reset} Bot: ${C.bold}@${botInfo.username}${C.reset} (${botInfo.first_name})\n`);
            return { token: trimmed, botName: botInfo.username };
        }

        process.stdout.write(`\r  ${C.yellow}Could not verify online${C.reset} — using token as-is.\n`);
        return { token: trimmed, botName: null };
    }
}

async function promptAllowedUserIds(rl: readline.Interface): Promise<string[]> {
    while (true) {
        const raw = await ask(rl, `  ${C.yellow}>${C.reset} `);
        const error = validateAllowedUserIds(raw);
        if (error === null) return parseAllowedUserIds(raw);
        errMsg(`${error}`);
    }
}

function directoryCompleter(line: string): [string[], string] {
    const raw = line.trimStart();
    const expanded = expandTilde(raw || '.');
    const resolved = path.resolve(expanded);

    let dir: string;
    let partial: string;
    try {
        if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
            dir = resolved;
            partial = '';
        } else {
            dir = path.dirname(resolved);
            partial = path.basename(resolved);
        }
    } catch {
        return [[], line];
    }

    try {
        const entries = fs.readdirSync(dir)
            .filter((name) => {
                if (partial && !name.toLowerCase().startsWith(partial.toLowerCase())) return false;
                try { return fs.statSync(path.join(dir, name)).isDirectory(); } catch { return false; }
            })
            .map((name) => {
                const full = path.join(dir, name) + '/';
                if (raw.startsWith('~/')) {
                    return '~/' + path.relative(os.homedir(), full);
                }
                return full;
            });
        return [entries, line];
    } catch {
        return [[], line];
    }
}

async function promptWorkspaceDir(): Promise<string> {
    const defaultDir = path.join(os.homedir(), 'Code');
    while (true) {
        const acRl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            completer: directoryCompleter,
        });
        const raw = await ask(acRl, `  ${C.yellow}>${C.reset} [${C.dim}${defaultDir}${C.reset}] `);
        acRl.close();
        const dir = expandTilde(raw.trim().length > 0 ? raw.trim() : defaultDir);
        const resolved = path.resolve(dir);
        if (fs.existsSync(resolved)) return resolved;
        const confirmRl = createInterface();
        const answer = await ask(confirmRl, `  ${C.yellow}"${resolved}" does not exist. Create it? (y/n):${C.reset} `);
        confirmRl.close();
        if (answer.trim().toLowerCase() === 'y') { fs.mkdirSync(resolved, { recursive: true }); return resolved; }
        errMsg('Please enter an existing directory.');
    }
}

async function runSetupWizard(): Promise<SetupResult> {
    const rl = createInterface();
    try {
        console.log(SETUP_LOGO);
        console.log(`  ${C.bold}Interactive setup — ${TOTAL_STEPS} steps${C.reset}\n`);

        stepHeader(1, TOTAL_STEPS, 'Telegram Bot Token');
        hint('1. Open Telegram and search for @BotFather');
        hint('2. Send /newbot and follow the prompts to create a bot');
        hint('3. Copy the bot token BotFather gives you');
        hintBlank();
        const { token: telegramBotToken } = await promptToken(rl);
        console.log('');

        stepHeader(2, TOTAL_STEPS, 'Allowed Telegram User IDs');
        hint('Only these users can send commands to the bot.');
        hint('1. Open Telegram and search for @userinfobot');
        hint('2. Send any message — it replies with your numeric user ID');
        hint('Multiple IDs: separate with commas (e.g. 123456,789012)');
        hintBlank();
        const allowedUserIds = await promptAllowedUserIds(rl);
        console.log('');

        stepHeader(3, TOTAL_STEPS, 'Workspace Base Directory');
        hint('The parent directory where your coding projects live.');
        hint('Each subdirectory becomes a selectable project in Telegram via /project.');
        hint('You can change this later in ~/.remoat/config.json or by re-running remoat setup.');
        hint('Press Tab to autocomplete directory paths.');
        hintBlank();
        rl.close();
        const workspaceBaseDir = await promptWorkspaceDir();
        console.log('');

        return { telegramBotToken, allowedUserIds, workspaceBaseDir };
    } finally {
        rl.close();
    }
}

export async function setupAction(): Promise<void> {
    const result = await runSetupWizard();

    ConfigLoader.save({
        telegramBotToken: result.telegramBotToken,
        allowedUserIds: result.allowedUserIds,
        workspaceBaseDir: result.workspaceBaseDir,
    });

    const configPath = ConfigLoader.getConfigFilePath();

    console.log(`  ${C.green}Setup complete!${C.reset}\n`);
    console.log(`  ${C.dim}Saved to${C.reset} ${configPath}\n`);
    console.log(`  ${C.cyan}Next steps:${C.reset}`);
    console.log(`  ${C.bold}1.${C.reset} Open Antigravity with CDP enabled:`);
    console.log(`     ${C.green}remoat open${C.reset}`);
    console.log(`     ${C.dim}(auto-selects an available port from: ${CDP_PORTS.join(', ')})${C.reset}\n`);
    console.log(`  ${C.bold}2.${C.reset} Run: ${C.green}remoat start${C.reset}\n`);
    console.log(`  ${C.bold}3.${C.reset} Open Telegram and message your bot!\n`);
}
