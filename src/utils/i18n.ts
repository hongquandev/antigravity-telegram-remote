import { logger } from './logger';
import * as fs from 'fs';
import * as path from 'path';

export type Language = 'en' | 'ja' | 'vi';

let currentLanguage: Language = 'vi';
let translations: Record<string, Record<string, string>> = {};

export function initI18n(lang: Language = 'vi') {
    currentLanguage = lang;
    loadTranslations();
}

function loadTranslations() {
    try {
        const enPath = path.join(__dirname, '../../locales/en.json');
        const jaPath = path.join(__dirname, '../../locales/ja.json');
        const viPath = path.join(__dirname, '../../locales/vi.json');

        if (fs.existsSync(enPath)) {
            translations['en'] = JSON.parse(fs.readFileSync(enPath, 'utf8'));
        } else {
            translations['en'] = {};
        }

        if (fs.existsSync(jaPath)) {
            translations['ja'] = JSON.parse(fs.readFileSync(jaPath, 'utf8'));
        } else {
            translations['ja'] = {};
        }

        if (fs.existsSync(viPath)) {
            translations['vi'] = JSON.parse(fs.readFileSync(viPath, 'utf8'));
        } else {
            translations['vi'] = {};
        }
    } catch (error) {
        logger.error('Failed to load translations:', error);
    }
}

export function t(key: string, variables?: Record<string, any>): string {
    const langDict = translations[currentLanguage] || translations['en'];
    let text = langDict?.[key] || translations['en']?.[key] || key;

    if (variables) {
        for (const [vKey, vValue] of Object.entries(variables)) {
            text = text.replaceAll(`{{${vKey}}}`, String(vValue));
        }
    }

    return text;
}
