import path from 'path';
import { realpathSync } from 'fs';

export const resolveSafePath = (inputPath: string, baseDir: string): string => {
    // SECURITY: Use realpathSync to resolve symlinks and prevent bypass attacks
    // This catches both traditional path traversal (..) and symlink-based escapes
    const resolvedPath = path.resolve(baseDir, inputPath);
    const normalizedBaseDir = path.resolve(baseDir);

    const relative = path.relative(normalizedBaseDir, resolvedPath);

    if (relative && (relative.startsWith('..' + path.sep) || relative === '..')) {
        throw new Error('Path traversal detected');
    }

    // Resolve symlinks to prevent symlink-based path traversal on all platforms
    try {
        const realPath = realpathSync(resolvedPath);
        const realBaseDir = realpathSync(normalizedBaseDir);

        if (!realPath.startsWith(realBaseDir)) {
            throw new Error('Path traversal detected (symlink bypass attempt)');
        }

        return realPath;
    } catch (err: any) {
        // If realpath fails (e.g., file doesn't exist), fall back to resolved path check
        // But still prevent parent directory access
        if (err.message.includes('Path traversal')) {
            throw err;
        }
        return resolvedPath;
    }
};
