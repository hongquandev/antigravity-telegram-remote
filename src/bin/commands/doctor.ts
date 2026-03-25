import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { CDP_PORTS } from '../../utils/cdpPorts';
import { ConfigLoader } from '../../utils/configLoader';
import { getAntigravityCdpHint } from '../../utils/pathUtils';
import { COLORS } from '../../utils/logger';

const ok = (msg: string) => console.log(`  ${COLORS.green}[OK]${COLORS.reset} ${msg}`);
const warn = (msg: string) => console.log(`  ${COLORS.yellow}[--]${COLORS.reset} ${msg}`);
const fail = (msg: string) => console.log(`  ${COLORS.red}[!!]${COLORS.reset} ${msg}`);
const hint = (msg: string) => console.log(`       ${COLORS.dim}${msg}${COLORS.reset}`);

function checkPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}/json/list`, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(Array.isArray(parsed));
                } catch {
                    resolve(false);
                }
            });
        });
        req.on('error', () => resolve(false));
        req.setTimeout(2000, () => {
            req.destroy();
            resolve(false);
        });
    });
}

function checkEnvFile(): { exists: boolean; path: string } {
    const envPath = path.resolve(process.cwd(), '.env');
    return { exists: fs.existsSync(envPath), path: envPath };
}

function checkRequiredEnvVars(): { name: string; set: boolean }[] {
    const required = ['TELEGRAM_BOT_TOKEN', 'ALLOWED_USER_IDS'];

    // Also check config.json values
    let persisted: Record<string, unknown> = {};
    try {
        const configPath = ConfigLoader.getConfigFilePath();
        if (fs.existsSync(configPath)) {
            persisted = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        }
    } catch { /* ignore parse errors here */ }

    const configKeyMap: Record<string, string> = {
        TELEGRAM_BOT_TOKEN: 'telegramBotToken',
        ALLOWED_USER_IDS: 'allowedUserIds',
    };

    return required.map((name) => ({
        name,
        set: Boolean(process.env[name]) || Boolean(persisted[configKeyMap[name]]),
    }));
}

export async function doctorAction(): Promise<void> {
    console.log(`\n${COLORS.cyan}antigravity-telegram-remote doctor${COLORS.reset}\n`);
    let allOk = true;

    // 1. Config directory check
    const configDir = ConfigLoader.getConfigDir();
    if (fs.existsSync(configDir)) {
        ok(`Config directory exists: ${configDir}`);
    } else {
        warn(`Config directory not found: ${configDir}`);
        hint('Run: antigravity-telegram-remote setup  (optional if using .env)');
    }

    // 2. Config file check
    const configFilePath = ConfigLoader.getConfigFilePath();
    if (ConfigLoader.configExists()) {
        ok(`Config file found: ${configFilePath}`);
    } else {
        warn(`Config file not found: ${configFilePath} (optional — .env fallback used)`);
    }

    // 3. .env file check
    const env = checkEnvFile();
    if (env.exists) {
        // Load .env so subsequent checks can see the variables
        require('dotenv').config({ path: env.path });
        ok(`.env file found: ${env.path}`);
    } else {
        if (!ConfigLoader.configExists()) {
            fail(`.env file not found: ${env.path}`);
            allOk = false;
        } else {
            warn(`.env file not found: ${env.path} (not needed — config.json used)`);
        }
    }

    // 4. Required environment variables (checks both .env and config.json)
    const vars = checkRequiredEnvVars();
    for (const v of vars) {
        if (v.set) {
            ok(`${v.name} is set`);
        } else {
            fail(`${v.name} is NOT set`);
            allOk = false;
        }
    }

    // 5. Node.js version check
    const nodeVersion = process.versions.node;
    const major = parseInt(nodeVersion.split('.')[0], 10);
    if (major >= 18) {
        ok(`Node.js ${nodeVersion}`);
    } else {
        fail(`Node.js ${nodeVersion} (>= 18.0.0 required)`);
        allOk = false;
    }

    // 6. Platform-specific checks
    const platform = os.platform();
    if (platform === 'darwin') {
        // Check Xcode Command Line Tools (needed for native module compilation)
        try {
            execFileSync('xcode-select', ['-p'], { stdio: 'pipe' });
            ok('Xcode Command Line Tools installed');
        } catch {
            warn('Xcode Command Line Tools not found');
            hint('Install with: xcode-select --install');
            hint('Required for native dependencies (better-sqlite3)');
        }

        // Check if Antigravity.app exists
        const antigravityPath = process.env.ANTIGRAVITY_PATH;
        if (antigravityPath) {
            if (fs.existsSync(antigravityPath)) {
                ok(`Antigravity found: ${antigravityPath}`);
            } else {
                fail(`ANTIGRAVITY_PATH set but not found: ${antigravityPath}`);
                allOk = false;
            }
        } else if (fs.existsSync('/Applications/Antigravity.app')) {
            ok('Antigravity.app found in /Applications');
        } else {
            warn('Antigravity.app not found in /Applications');
            hint('Install Antigravity, or set ANTIGRAVITY_PATH in .env');
        }
    }

    // 7. CDP port check
    console.log(`\n  ${COLORS.dim}Checking CDP ports...${COLORS.reset}`);
    let cdpOk = false;
    for (const port of CDP_PORTS) {
        const alive = await checkPort(port);
        if (alive) {
            ok(`CDP port ${port} is responding`);
            cdpOk = true;
        }
    }
    if (!cdpOk) {
        fail('No CDP ports responding');
        hint(`Run: antigravity-telegram-remote open`);
        hint(`Or manually: ${getAntigravityCdpHint(9222)}`);
        allOk = false;
    }

    // Summary
    console.log('');
    if (allOk) {
        console.log(`  ${COLORS.green}All checks passed!${COLORS.reset}`);
    } else {
        console.log(`  ${COLORS.red}Some checks failed. Please fix the issues above.${COLORS.reset}`);
        process.exitCode = 1;
    }
}
