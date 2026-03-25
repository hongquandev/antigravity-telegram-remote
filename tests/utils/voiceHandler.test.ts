import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const TEMP_VOICE_DIR = path.join(os.tmpdir(), 'antigravity-telegram-remote-voice');

// Mock fetch globally
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

// Mock fs/promises
jest.mock('fs/promises', () => ({
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined),
}));

// Mock logger
jest.mock('../../src/utils/logger', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    },
}));

import { downloadTelegramVoice, transcribeVoice } from '../../src/utils/voiceHandler';

describe('voiceHandler', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('downloadTelegramVoice', () => {
        const mockBotApi = {
            getFile: jest.fn(),
        };
        const botToken = 'test-bot-token';
        const voice = {
            file_id: 'voice-file-id-123',
            file_unique_id: 'unique-456',
            duration: 5,
            mime_type: 'audio/ogg',
        };

        it('downloads voice file to temp directory', async () => {
            mockBotApi.getFile.mockResolvedValue({ file_path: 'voice/file_0.oga' });
            mockFetch.mockResolvedValue({
                ok: true,
                arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
            });

            const result = await downloadTelegramVoice(mockBotApi, botToken, voice);

            expect(mockBotApi.getFile).toHaveBeenCalledWith('voice-file-id-123');
            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.telegram.org/file/bottest-bot-token/voice/file_0.oga',
            );
            expect(fs.mkdir).toHaveBeenCalledWith(TEMP_VOICE_DIR, { recursive: true });
            expect(fs.writeFile).toHaveBeenCalled();
            expect(result).toMatch(/unique-456\.oga$/);
        });

        it('throws when Telegram returns no file_path', async () => {
            mockBotApi.getFile.mockResolvedValue({});

            await expect(
                downloadTelegramVoice(mockBotApi, botToken, voice),
            ).rejects.toThrow('Telegram returned no file_path');
        });

        it('throws when download HTTP status is not ok', async () => {
            mockBotApi.getFile.mockResolvedValue({ file_path: 'voice/file_0.oga' });
            mockFetch.mockResolvedValue({ ok: false, status: 404 });

            await expect(
                downloadTelegramVoice(mockBotApi, botToken, voice),
            ).rejects.toThrow('Voice download failed (status=404)');
        });

        it('throws when downloaded file is empty', async () => {
            mockBotApi.getFile.mockResolvedValue({ file_path: 'voice/file_0.oga' });
            mockFetch.mockResolvedValue({
                ok: true,
                arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
            });

            await expect(
                downloadTelegramVoice(mockBotApi, botToken, voice),
            ).rejects.toThrow('Voice download returned empty file');
        });

        it('uses .ogg extension when file_path has no extension', async () => {
            mockBotApi.getFile.mockResolvedValue({ file_path: 'voice/file_0' });
            mockFetch.mockResolvedValue({
                ok: true,
                arrayBuffer: () => Promise.resolve(new ArrayBuffer(50)),
            });

            const result = await downloadTelegramVoice(mockBotApi, botToken, voice);
            expect(result).toMatch(/\.ogg$/);
        });
    });

    describe('transcribeVoice', () => {
        it('returns null and cleans up file on transcription failure', async () => {
            // nodejs-whisper is not installed in test env, so require will throw
            const result = await transcribeVoice('/tmp/nonexistent.ogg');

            expect(result).toBeNull();
            expect(fs.unlink).toHaveBeenCalledWith('/tmp/nonexistent.ogg');
        });
    });
});
