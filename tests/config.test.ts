import { loadConfig, resolveResponseDeliveryMode } from '../src/utils/config';

jest.mock('../src/utils/configLoader', () => {
    const actual = jest.requireActual('../src/utils/configLoader');
    return {
        ...actual,
        ConfigLoader: {
            ...actual.ConfigLoader,
            load: () => actual.ConfigLoader.load({}),
        },
    };
});

describe('Config', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...originalEnv };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('throws an error if TELEGRAM_BOT_TOKEN is missing', () => {
        delete process.env.TELEGRAM_BOT_TOKEN;
        process.env.ALLOWED_USER_IDS = '123456';
        expect(() => loadConfig()).toThrow('Missing required config: TELEGRAM_BOT_TOKEN');
    });

    it('throws an error if ALLOWED_USER_IDS is missing', () => {
        process.env.TELEGRAM_BOT_TOKEN = 'token';
        delete process.env.ALLOWED_USER_IDS;
        expect(() => loadConfig()).toThrow('Missing required config: ALLOWED_USER_IDS');
    });

    it('returns valid config if all required variables are set', () => {
        process.env.TELEGRAM_BOT_TOKEN = 'secret_token';
        process.env.ALLOWED_USER_IDS = '123456789,987654321';
        process.env.WORKSPACE_BASE_DIR = '/custom/dir';

        const config = loadConfig();
        expect(config.telegramBotToken).toEqual('secret_token');
        expect(config.allowedUserIds).toEqual(['123456789', '987654321']);
        expect(config.workspaceBaseDir).toEqual('/custom/dir');
    });

    it('returns default workspace base dir if not set', () => {
        process.env.TELEGRAM_BOT_TOKEN = 'secret_token';
        process.env.ALLOWED_USER_IDS = '123456789';
        delete process.env.WORKSPACE_BASE_DIR;

        const config = loadConfig();
        expect(config.workspaceBaseDir).toBeDefined();
        expect(typeof config.workspaceBaseDir).toBe('string');
    });

    it('defaults useTopics to true when not set', () => {
        process.env.TELEGRAM_BOT_TOKEN = 'secret_token';
        process.env.ALLOWED_USER_IDS = '123456789';
        delete process.env.USE_TOPICS;

        const config = loadConfig();
        expect(config.useTopics).toBe(true);
    });

    it('disables useTopics when set to false', () => {
        process.env.TELEGRAM_BOT_TOKEN = 'secret_token';
        process.env.ALLOWED_USER_IDS = '123456789';
        process.env.USE_TOPICS = 'false';

        const config = loadConfig();
        expect(config.useTopics).toBe(false);
    });

    it('defaults AUTO_APPROVE_FILE_EDITS to false when not set', () => {
        process.env.TELEGRAM_BOT_TOKEN = 'secret_token';
        process.env.ALLOWED_USER_IDS = '123456789';
        delete process.env.AUTO_APPROVE_FILE_EDITS;

        const config = loadConfig();
        expect(config.autoApproveFileEdits).toBe(false);
    });

    it('enables AUTO_APPROVE_FILE_EDITS when set to true', () => {
        process.env.TELEGRAM_BOT_TOKEN = 'secret_token';
        process.env.ALLOWED_USER_IDS = '123456789';
        process.env.AUTO_APPROVE_FILE_EDITS = 'true';

        const config = loadConfig();
        expect(config.autoApproveFileEdits).toBe(true);
    });

    it('returns stream as the only supported delivery mode', () => {
        expect(resolveResponseDeliveryMode()).toBe('stream');
    });
});
