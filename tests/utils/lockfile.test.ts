import * as os from 'os';
import * as path from 'path';

jest.mock('fs');

import * as fs from 'fs';
import { acquireLock } from '../../src/utils/lockfile';

const mockedFs = fs as jest.Mocked<typeof fs>;
const expectedLockPath = path.join(os.homedir(), '.antigravity-telegram-remote', '.bot.lock');

describe('lockfile', () => {
    let processKillSpy: jest.SpyInstance;
    let processOnSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.resetAllMocks();
        processKillSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
        processOnSpy = jest.spyOn(process, 'on').mockImplementation(() => process);
        // Suppress console output
        jest.spyOn(console, 'info').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('creates lock file with current PID when no existing lock', () => {
        mockedFs.existsSync.mockReturnValue(false);
        mockedFs.mkdirSync.mockReturnValue(undefined as any);
        mockedFs.writeFileSync.mockReturnValue(undefined);

        acquireLock();

        expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
            expectedLockPath,
            String(process.pid),
            'utf-8',
        );
    });

    it('ensures ~/.antigravity-telegram-remote directory is created', () => {
        mockedFs.existsSync.mockReturnValue(false);
        mockedFs.mkdirSync.mockReturnValue(undefined as any);
        mockedFs.writeFileSync.mockReturnValue(undefined);

        acquireLock();

        expect(mockedFs.mkdirSync).toHaveBeenCalledWith(
            path.dirname(expectedLockPath),
            { recursive: true },
        );
    });

    it('cleans up stale lock file when PID is not running', () => {
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue('99999' as any);
        mockedFs.mkdirSync.mockReturnValue(undefined as any);
        mockedFs.writeFileSync.mockReturnValue(undefined);
        mockedFs.unlinkSync.mockReturnValue(undefined);

        // process.kill(99999, 0) throws = not running
        processKillSpy.mockImplementation((pid: number, signal?: string | number) => {
            if (signal === 0) throw new Error('ESRCH');
            return true;
        });

        acquireLock();

        // Should have cleaned up stale lock
        expect(mockedFs.unlinkSync).toHaveBeenCalledWith(expectedLockPath);
    });

    it('handles NaN PID in lock file gracefully', () => {
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue('not-a-number' as any);
        mockedFs.mkdirSync.mockReturnValue(undefined as any);
        mockedFs.writeFileSync.mockReturnValue(undefined);
        mockedFs.unlinkSync.mockReturnValue(undefined);

        // Should not throw
        expect(() => acquireLock()).not.toThrow();
    });

    it('returns a release function', () => {
        mockedFs.existsSync.mockReturnValue(false);
        mockedFs.mkdirSync.mockReturnValue(undefined as any);
        mockedFs.writeFileSync.mockReturnValue(undefined);

        const release = acquireLock();
        expect(typeof release).toBe('function');
    });

    it('release function deletes lock file when PID matches', () => {
        mockedFs.existsSync.mockReturnValue(false);
        mockedFs.mkdirSync.mockReturnValue(undefined as any);
        mockedFs.writeFileSync.mockReturnValue(undefined);

        const release = acquireLock();

        // Setup for release call
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(String(process.pid) as any);
        mockedFs.unlinkSync.mockReturnValue(undefined);

        release();

        expect(mockedFs.unlinkSync).toHaveBeenCalledWith(expectedLockPath);
    });

    it('release function does not delete lock file when PID does not match', () => {
        mockedFs.existsSync.mockReturnValue(false);
        mockedFs.mkdirSync.mockReturnValue(undefined as any);
        mockedFs.writeFileSync.mockReturnValue(undefined);

        const release = acquireLock();

        // Another process wrote the lock file
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue('99999' as any);

        release();

        expect(mockedFs.unlinkSync).not.toHaveBeenCalled();
    });

    it('registers process exit handlers', () => {
        mockedFs.existsSync.mockReturnValue(false);
        mockedFs.mkdirSync.mockReturnValue(undefined as any);
        mockedFs.writeFileSync.mockReturnValue(undefined);

        acquireLock();

        const registeredEvents = processOnSpy.mock.calls.map((c: any[]) => c[0]);
        expect(registeredEvents).toContain('exit');
        expect(registeredEvents).toContain('SIGINT');
        expect(registeredEvents).toContain('SIGTERM');
        expect(registeredEvents).toContain('uncaughtException');
    });
});
