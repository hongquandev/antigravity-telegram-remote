import { InputFile } from 'grammy';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { ExtractedResponseImage } from '../services/cdpService';
import { logger } from './logger';

const MAX_INBOUND_IMAGE_ATTACHMENTS = 4;
const IMAGE_EXT_PATTERN = /\.(png|jpe?g|webp|gif|bmp)$/i;
const TEMP_IMAGE_DIR = path.join(os.tmpdir(), 'antigravity-telegram-remote-images');

export interface InboundImageAttachment {
    localPath: string;
    url: string;
    name: string;
    mimeType: string;
}

export interface TelegramPhotoInfo {
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
    file_size?: number;
}

export function isImageAttachment(contentType: string | null | undefined, fileName: string | null | undefined): boolean {
    if ((contentType || '').toLowerCase().startsWith('image/')) return true;
    return IMAGE_EXT_PATTERN.test(fileName || '');
}

export function mimeTypeToExtension(mimeType: string): string {
    const normalized = (mimeType || '').toLowerCase();
    if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
    if (normalized.includes('webp')) return 'webp';
    if (normalized.includes('gif')) return 'gif';
    if (normalized.includes('bmp')) return 'bmp';
    return 'png';
}

export function sanitizeFileName(fileName: string): string {
    const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
    return sanitized || `image-${Date.now()}.png`;
}

export function buildPromptWithAttachmentUrls(prompt: string, attachments: InboundImageAttachment[]): string {
    const base = prompt.trim() || 'Please review the attached images and respond accordingly.';
    if (attachments.length === 0) return base;

    const lines = attachments.map((image, index) =>
        `${index + 1}. ${image.name}\nURL: ${image.url}`,
    );

    return `${base}\n\n[Telegram Attached Images]\n${lines.join('\n\n')}\n\nPlease refer to the attached images above in your response.`;
}

/**
 * Download image attachments from a Telegram message via bot API.
 */
export async function downloadTelegramImages(
    botApi: { getFile: (fileId: string) => Promise<any> },
    botToken: string,
    photos: Array<{ file_id: string; file_size?: number }>,
    messageId: string | number,
): Promise<InboundImageAttachment[]> {
    const imageAttachments = photos.slice(0, MAX_INBOUND_IMAGE_ATTACHMENTS);
    if (imageAttachments.length === 0) return [];

    await fs.mkdir(TEMP_IMAGE_DIR, { recursive: true });

    const downloaded: InboundImageAttachment[] = [];
    let index = 0;
    for (const photo of imageAttachments) {
        try {
            const file = await botApi.getFile(photo.file_id);
            const filePath = file.file_path;
            if (!filePath) continue;

            const url = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
            const response = await fetch(url);
            if (!response.ok) {
                logger.warn(`[ImageBridge] Telegram image download failed (status=${response.status})`);
                continue;
            }

            const bytes = Buffer.from(await response.arrayBuffer());
            if (bytes.length === 0) continue;

            const ext = path.extname(filePath) || '.png';
            const name = sanitizeFileName(`telegram-image-${index + 1}${ext}`);
            const localPath = path.join(
                TEMP_IMAGE_DIR,
                `${Date.now()}-${messageId}-${index}-${name}`,
            );

            await fs.writeFile(localPath, bytes);
            const mimeExt = ext.slice(1).toLowerCase() === 'jpg' ? 'jpeg' : ext.slice(1).toLowerCase();
            downloaded.push({ localPath, url: `[local file: ${name}]`, name, mimeType: `image/${mimeExt}` });
            index += 1;
        } catch (error: any) {
            logger.warn(`[ImageBridge] Telegram image processing failed`, error?.message || error);
        }
    }

    return downloaded;
}

export async function cleanupInboundImageAttachments(attachments: InboundImageAttachment[]): Promise<void> {
    for (const image of attachments) {
        await fs.unlink(image.localPath).catch(() => { });
    }
}

/**
 * Convert an extracted response image to a Buffer + filename for sending via Telegram.
 */
export async function toTelegramInputFile(image: ExtractedResponseImage, index: number): Promise<{ buffer: Buffer; name: string } | null> {
    let buffer: Buffer | null = null;
    let mimeType = image.mimeType || 'image/png';

    if (image.base64Data) {
        try { buffer = Buffer.from(image.base64Data, 'base64'); }
        catch { buffer = null; }
    } else if (image.url && /^https?:\/\//i.test(image.url)) {
        try {
            const response = await fetch(image.url);
            if (response.ok) {
                buffer = Buffer.from(await response.arrayBuffer());
                mimeType = response.headers.get('content-type') || mimeType;
            }
        } catch { buffer = null; }
    }

    if (!buffer || buffer.length === 0) return null;

    const fallbackExt = mimeTypeToExtension(mimeType);
    const baseName = sanitizeFileName(image.name || `generated-image-${index + 1}.${fallbackExt}`);
    const finalName = IMAGE_EXT_PATTERN.test(baseName) ? baseName : `${baseName}.${fallbackExt}`;
    return { buffer, name: finalName };
}
