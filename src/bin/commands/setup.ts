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

     ${C.bold}~ Cài đặt Antigravity Telegram Remote ~${C.reset}
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
    if (ids.length === 0) return 'Vui lòng nhập ít nhất một ID người dùng.';
    const invalid = ids.find((id) => !isNumericString(id));
    if (invalid) return `ID người dùng không hợp lệ: "${invalid}" — phải là một chuỗi số.`;
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
    console.log(`  ${C.cyan}[Bước ${step}/${total}]${C.reset} ${C.bold}${title}${C.reset}`);
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
        if (!isNonEmpty(token)) { errMsg('Token không được để trống.'); continue; }
        const trimmed = token.trim();

        process.stdout.write(`  ${C.dim}Đang xác thực token...${C.reset}`);
        const botInfo = await verifyTelegramToken(trimmed);

        if (botInfo) {
            process.stdout.write(`\r  ${C.green}Đã xác thực!${C.reset} Bot: ${C.bold}@${botInfo.username}${C.reset} (${botInfo.first_name})\n`);
            return { token: trimmed, botName: botInfo.username };
        }

        process.stdout.write(`\r  ${C.yellow}Không thể xác thực trực tuyến${C.reset} — sử dụng token như hiện tại.\n`);
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
        const answer = await ask(confirmRl, `  ${C.yellow}"${resolved}" không tồn tại. Tạo thư mục này? (y/n):${C.reset} `);
        confirmRl.close();
        if (answer.trim().toLowerCase() === 'y') { fs.mkdirSync(resolved, { recursive: true }); return resolved; }
        errMsg('Vui lòng nhập một thư mục hợp lệ.');
    }
}

async function runSetupWizard(): Promise<SetupResult> {
    const rl = createInterface();
    try {
        console.log(SETUP_LOGO);
        console.log(`  ${C.bold}Hướng dẫn cài đặt — ${TOTAL_STEPS} bước${C.reset}\n`);

        stepHeader(1, TOTAL_STEPS, 'Telegram Bot Token');
        hint('1. Mở Telegram và tìm kiếm @BotFather');
        hint('2. Gửi lệnh /newbot và làm theo hướng dẫn để tạo bot mới');
        hint('3. Sao chép mã bot token mà BotFather cung cấp cho bạn');
        hintBlank();
        const { token: telegramBotToken } = await promptToken(rl);
        console.log('');

        stepHeader(2, TOTAL_STEPS, 'ID người dùng Telegram được phép');
        hint('Chỉ những người dùng này mới có thể gửi lệnh cho bot.');
        hint('1. Mở Telegram và tìm kiếm @raw_data_bot');
        hint('2. Gửi bất kỳ tin nhắn nào — nó sẽ trả lời bằng ID người dùng (số) của bạn');
        hint('Nhiều ID: phân tách bằng dấu phẩy (ví dụ: 123456,789012)');
        hintBlank();
        const allowedUserIds = await promptAllowedUserIds(rl);
        console.log('');

        stepHeader(3, TOTAL_STEPS, 'Thư mục gốc của Workspace');
        hint('Thư mục cha chứa các dự án code của bạn.');
        hint('Mỗi thư mục con sẽ trở thành một dự án có thể chọn trên Telegram qua lệnh /project.');
        hint('Bạn có thể thay đổi mục này sau tại ~/.antigravity-telegram-remote/config.json hoặc chạy lại lệnh setup.');
        hint('Nhấn Tab để tự động hoàn thành đường dẫn thư mục.');
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

    console.log(`  ${C.green}Cài đặt hoàn tất!${C.reset}\n`);
    console.log(`  ${C.dim}Đã lưu tại${C.reset} ${configPath}\n`);
    console.log(`  ${C.cyan}Các bước tiếp theo:${C.reset}`);
    console.log(`  ${C.bold}1.${C.reset} Mở Antigravity với CDP được bật:`);
    console.log(`     ${C.green}antigravity-telegram-remote open${C.reset}`);
    console.log(`     ${C.dim}(tự động chọn một cổng khả dụng từ: ${CDP_PORTS.join(', ')})${C.reset}\n`);
    console.log(`  ${C.bold}2.${C.reset} Chạy lệnh: ${C.green}antigravity-telegram-remote start${C.reset}\n`);
    console.log(`  ${C.bold}3.${C.reset} Mở Telegram và gửi tin nhắn cho bot của bạn!\n`);
}
