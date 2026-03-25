import * as os from 'os';
import * as path from 'path';

// Must mock before importing
jest.mock('fs');
jest.mock('dotenv', () => ({ config: jest.fn() }));

import * as fs from 'fs';
import { ConfigLoader, PersistedConfig } from '../../src/utils/configLoader';

const mockedFs = fs as jest.Mocked<typeof fs>;

describe('ConfigLoader', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.resetAllMocks();
        process.env = { ...originalEnv };
        // Clear env vars that affect config
        delete process.env.TELEGRAM_BOT_TOKEN;
        delete process.env.ALLOWED_USER_IDS;
        delete process.env.WORKSPACE_BASE_DIR;
        delete process.env.AUTO_APPROVE_FILE_EDITS;
        delete process.env.LOG_LEVEL;
        delete process.env.EXTRACTION_MODE;
        delete process.env.USE_TOPICS;
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('getConfigDir()', () => {
        it('returns ~/.antigravity-telegram-remote', () => {
            expect(ConfigLoader.getConfigDir()).toBe(path.join(os.homedir(), '.antigravity-telegram-remote'));
        });
    });

    describe('getConfigFilePath()', () => {
        it('returns ~/.antigravity-telegram-remote/config.json', () => {
            expect(ConfigLoader.getConfigFilePath()).toBe(
                path.join(os.homedir(), '.antigravity-telegram-remote', 'config.json'),
            );
        });
    });

    describe('getDefaultDbPath()', () => {
        it('returns ~/.antigravity-telegram-remote/antigravity.db', () => {
            expect(ConfigLoader.getDefaultDbPath()).toBe(
                path.join(os.homedir(), '.antigravity-telegram-remote', 'antigravity.db'),
            );
        });
    });

    describe('configExists()', () => {
        it('returns true when config file exists', () => {
            mockedFs.existsSync.mockReturnValue(true);
            expect(ConfigLoader.configExists()).toBe(true);
        });

        it('returns false when config file does not exist', () => {
            mockedFs.existsSync.mockReturnValue(false);
            expect(ConfigLoader.configExists()).toBe(false);
        });
    });

    describe('load()', () => {
        it('loads config from persisted override', () => {
            const persisted: PersistedConfig = {
                telegramBotToken: 'test-token',
                allowedUserIds: ['111', '222'],
            };
            const config = ConfigLoader.load(persisted);
            expect(config.telegramBotToken).toBe('test-token');
            expect(config.allowedUserIds).toEqual(['111', '222']);
        });

        it('env vars override persisted config', () => {
            process.env.TELEGRAM_BOT_TOKEN = 'env-token';
            process.env.ALLOWED_USER_IDS = '999';
            const persisted: PersistedConfig = {
                telegramBotToken: 'file-token',
                allowedUserIds: ['111'],
            };
            const config = ConfigLoader.load(persisted);
            expect(config.telegramBotToken).toBe('env-token');
            expect(config.allowedUserIds).toEqual(['999']);
        });

        it('throws when telegramBotToken is missing', () => {
            expect(() => ConfigLoader.load({})).toThrow('Missing required config: TELEGRAM_BOT_TOKEN');
        });

        it('throws when allowedUserIds is missing', () => {
            expect(() => ConfigLoader.load({ telegramBotToken: 'tok' })).toThrow(
                'Missing required config: ALLOWED_USER_IDS',
            );
        });

        it('uses default workspaceBaseDir when not specified', () => {
            const config = ConfigLoader.load({
                telegramBotToken: 'tok',
                allowedUserIds: ['1'],
            });
            expect(config.workspaceBaseDir).toBe(path.join(os.homedir(), 'Code'));
        });

        it('expands tilde in workspaceBaseDir', () => {
            const config = ConfigLoader.load({
                telegramBotToken: 'tok',
                allowedUserIds: ['1'],
                workspaceBaseDir: '~/projects',
            });
            expect(config.workspaceBaseDir).toBe(path.join(os.homedir(), 'projects'));
        });

        it('resolves autoApproveFileEdits from env', () => {
            process.env.AUTO_APPROVE_FILE_EDITS = 'true';
            const config = ConfigLoader.load({
                telegramBotToken: 'tok',
                allowedUserIds: ['1'],
            });
            expect(config.autoApproveFileEdits).toBe(true);
        });

        it('defaults autoApproveFileEdits to false', () => {
            const config = ConfigLoader.load({
                telegramBotToken: 'tok',
                allowedUserIds: ['1'],
            });
            expect(config.autoApproveFileEdits).toBe(false);
        });

        it('resolves logLevel from env', () => {
            process.env.LOG_LEVEL = 'debug';
            const config = ConfigLoader.load({
                telegramBotToken: 'tok',
                allowedUserIds: ['1'],
            });
            expect(config.logLevel).toBe('debug');
        });

        it('defaults logLevel to info', () => {
            const config = ConfigLoader.load({
                telegramBotToken: 'tok',
                allowedUserIds: ['1'],
            });
            expect(config.logLevel).toBe('info');
        });

        it('resolves extractionMode from env', () => {
            process.env.EXTRACTION_MODE = 'legacy';
            const config = ConfigLoader.load({
                telegramBotToken: 'tok',
                allowedUserIds: ['1'],
            });
            expect(config.extractionMode).toBe('legacy');
        });

        it('defaults extractionMode to structured', () => {
            const config = ConfigLoader.load({
                telegramBotToken: 'tok',
                allowedUserIds: ['1'],
            });
            expect(config.extractionMode).toBe('structured');
        });

        it('resolves useTopics from env', () => {
            process.env.USE_TOPICS = 'false';
            const config = ConfigLoader.load({
                telegramBotToken: 'tok',
                allowedUserIds: ['1'],
            });
            expect(config.useTopics).toBe(false);
        });

        it('defaults useTopics to true', () => {
            const config = ConfigLoader.load({
                telegramBotToken: 'tok',
                allowedUserIds: ['1'],
            });
            expect(config.useTopics).toBe(true);
        });

        it('handles comma-separated ALLOWED_USER_IDS with whitespace', () => {
            process.env.TELEGRAM_BOT_TOKEN = 'tok';
            process.env.ALLOWED_USER_IDS = ' 111 , 222 , 333 ';
            const config = ConfigLoader.load({});
            expect(config.allowedUserIds).toEqual(['111', '222', '333']);
        });

        it('filters empty strings from ALLOWED_USER_IDS', () => {
            process.env.TELEGRAM_BOT_TOKEN = 'tok';
            process.env.ALLOWED_USER_IDS = '111,,222,';
            const config = ConfigLoader.load({});
            expect(config.allowedUserIds).toEqual(['111', '222']);
        });

        // Bug fix: malformed JSON config throws clear error
        it('throws a clear error for malformed JSON config', () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue('{ invalid json }' as any);
            expect(() => ConfigLoader.load()).toThrow('Failed to parse config file');
        });

        it('returns empty persisted config when file does not exist', () => {
            mockedFs.existsSync.mockReturnValue(false);
            process.env.TELEGRAM_BOT_TOKEN = 'tok';
            process.env.ALLOWED_USER_IDS = '1';
            const config = ConfigLoader.load();
            expect(config.telegramBotToken).toBe('tok');
        });

        it('ignores invalid logLevel values', () => {
            process.env.LOG_LEVEL = 'INVALID';
            const config = ConfigLoader.load({
                telegramBotToken: 'tok',
                allowedUserIds: ['1'],
            });
            expect(config.logLevel).toBe('info');
        });
    });

    describe('save()', () => {
        it('creates directory and writes merged config', () => {
            mockedFs.existsSync.mockImplementation((p) => {
                if (typeof p === 'string' && p.endsWith('.antigravity-telegram-remote')) return false;
                return false;
            });
            mockedFs.readFileSync.mockReturnValue('{}' as any);
            mockedFs.mkdirSync.mockReturnValue(undefined as any);
            mockedFs.writeFileSync.mockReturnValue(undefined);

            ConfigLoader.save({ telegramBotToken: 'new-token' });

            expect(mockedFs.mkdirSync).toHaveBeenCalledWith(
                expect.stringContaining('.antigravity-telegram-remote'),
                { recursive: true },
            );
            expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('config.json'),
                expect.stringContaining('new-token'),
                'utf-8',
            );
        });
    });
});
