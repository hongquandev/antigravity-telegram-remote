import { logger } from '../utils/logger';
import type { ExtractionMode } from '../utils/config';
import { CdpService } from './cdpService';
import {
    extractAssistantSegmentsPayloadScript,
    classifyAssistantSegments,
} from './assistantDomExtractor';

/** Lean DOM selectors for response extraction */
export const RESPONSE_SELECTORS = {
    /** Scored selector approach for extracting response text.
     *  Tie-breaking: newest wins (first found in reverse iteration).
     *  DOM is normal order: index 0 = oldest, N-1 = newest.
     *  Reverse iteration (N-1→0) visits newest first; strict > keeps it. */
    RESPONSE_TEXT: `(() => {
        const panel = document.querySelector('.antigravity-agent-side-panel');
        const scopes = [panel, document].filter(Boolean);

        const selectors = [
            { sel: '.rendered-markdown', score: 10 },
            { sel: '.leading-relaxed.select-text', score: 9 },
            { sel: '.flex.flex-col.gap-y-3', score: 8 },
            { sel: '[data-message-author-role="assistant"]', score: 7 },
            { sel: '[data-message-role="assistant"]', score: 6 },
            { sel: '[class*="assistant-message"]', score: 5 },
            { sel: '[class*="message-content"]', score: 4 },
            { sel: '[class*="markdown-body"]', score: 3 },
            { sel: '.prose', score: 2 },
        ];

        const looksLikeActivityLog = (text) => {
            const normalized = (text || '').trim().toLowerCase();
            if (!normalized) return false;
            const stripped = normalized.replace(/^[^a-z]+/i, '');
            const activityPattern = /^(?:analy[sz]ing|reading|writing|running|searching|planning|thinking|processing|loading|executing|testing|debugging|fetching|connecting|creating|updating|deleting|installing|building|compiling|deploying|checking|scanning|parsing|resolving|downloading|uploading|analyzed|read|wrote|ran|created|updated|deleted|fetched|built|compiled|installed|resolved|downloaded|connected)\\b/i;
            if (activityPattern.test(stripped) && normalized.length <= 220) return true;
            if (/^initiating\\s/i.test(stripped) && normalized.length <= 500) return true;
            if (/^thought for\\s/i.test(stripped) && normalized.length <= 500) return true;
            return false;
        };

        const looksLikeFeedbackFooter = (text) => {
            const normalized = (text || '').trim().toLowerCase().replace(/\\s+/g, ' ');
            if (!normalized) return false;
            return normalized === 'good bad' || normalized === 'good' || normalized === 'bad';
        };

        const isInsideExcludedContainer = (node) => {
            if (node.closest('details')) return true;
            if (node.closest('[class*="feedback"], footer')) return true;
            if (node.closest('.notify-user-container')) return true;
            if (node.closest('[role="dialog"]')) return true;
            return false;
        };

        const looksLikeToolOutput = (text) => {
            const first = (text || '').trim().split('\\n')[0] || '';
            if (/^[a-z0-9._-]+\\s*\\/\\s*[a-z0-9._-]+$/i.test(first)) return true;
            if (/^full output written to\\b/i.test(first)) return true;
            if (/^output\\.[a-z0-9._-]+(?:#l\\d+(?:-\\d+)?)?$/i.test(first)) return true;
            var lower = (text || '').trim().toLowerCase();
            if (/^title:\\s/.test(lower) && /\\surl:\\s/.test(lower) && /\\ssnippet:\\s/.test(lower)) return true;
            if (/^(json|javascript|typescript|python|bash|sh|html|css|xml|yaml|yml|toml|sql|graphql|markdown|text|plaintext|log|ruby|go|rust|java|c|cpp|csharp|php|swift|kotlin)$/i.test(first)) return true;
            return false;
        };

        const looksLikeQuotaPopup = (text) => {
            var lower = (text || '').trim().toLowerCase();
            // Inline error: "Error You have exhausted your quota on this model."
            if (lower.includes('exhausted your quota') || lower.includes('exhausted quota')) return true;
            // Popup: quota keyword + dismiss/upgrade button text
            if (!lower.includes('model quota reached') && !lower.includes('quota exceeded') && !lower.includes('rate limit')) return false;
            return lower.includes('dismiss') || lower.includes('upgrade');
        };

        const combinedSelector = selectors.map((s) => s.sel).join(', ');
        const seen = new Set();

        for (const scope of scopes) {
            const nodes = scope.querySelectorAll(combinedSelector);
            for (let i = nodes.length - 1; i >= 0; i--) {
                const node = nodes[i];
                if (!node || seen.has(node)) continue;
                seen.add(node);
                if (isInsideExcludedContainer(node)) continue;
                const text = (node.innerText || node.textContent || '').replace(/\\r/g, '').trim();
                if (!text || text.length < 2) continue;
                if (looksLikeActivityLog(text)) continue;
                if (looksLikeFeedbackFooter(text)) continue;
                if (looksLikeToolOutput(text)) continue;
                if (looksLikeQuotaPopup(text)) continue;
                // Prefer recency first: return the newest acceptable node.
                return text;
            }
        }

        return null;
    })()`,
    /** Stop button detection via tooltip-id + text fallback */
    STOP_BUTTON: `(() => {
        const panel = document.querySelector('.antigravity-agent-side-panel');
        const scopes = [panel, document].filter(Boolean);

        for (const scope of scopes) {
            const el = scope.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
            if (el) return { isGenerating: true };
        }

        const normalize = (value) => (value || '').toLowerCase().replace(/\\s+/g, ' ').trim();
        const STOP_PATTERNS = [
            /^stop$/,
            /^stop generating$/,
            /^stop response$/,
            /^停止$/,
            /^生成を停止$/,
            /^応答を停止$/,
        ];
        const isStopLabel = (value) => {
            const normalized = normalize(value);
            if (!normalized) return false;
            return STOP_PATTERNS.some((re) => re.test(normalized));
        };
        for (const scope of scopes) {
            const buttons = scope.querySelectorAll('button, [role="button"]');
            for (let i = 0; i < buttons.length; i++) {
                const btn = buttons[i];
                const labels = [
                    btn.textContent || '',
                    btn.getAttribute('aria-label') || '',
                    btn.getAttribute('title') || '',
                ];
                if (labels.some(isStopLabel)) {
                    return { isGenerating: true };
                }
            }
        }

        return { isGenerating: false };
    })()`,
    /** Check if planning dialog (Open/Proceed buttons) is active */
    PLANNING_ACTIVE: `(() => {
        var container = document.querySelector('.notify-user-container');
        if (!container) return false;
        var buttons = Array.from(container.querySelectorAll('button')).filter(function(btn) { return btn.offsetParent !== null; });
        var hasOpen = buttons.some(function(btn) { return (btn.textContent || '').toLowerCase().trim() === 'open'; });
        var hasProceed = buttons.some(function(btn) { return (btn.textContent || '').toLowerCase().trim() === 'proceed'; });
        return hasOpen && hasProceed;
    })()`,
    /** Click stop button via tooltip-id + text fallback */
    CLICK_STOP_BUTTON: `(() => {
        const panel = document.querySelector('.antigravity-agent-side-panel');
        const scopes = [panel, document].filter(Boolean);

        for (const scope of scopes) {
            const el = scope.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
            if (el && typeof el.click === 'function') {
                el.click();
                return { ok: true, method: 'tooltip-id' };
            }
        }

        const normalize = (value) => (value || '').toLowerCase().replace(/\\s+/g, ' ').trim();
        const STOP_PATTERNS = [
            /^stop$/,
            /^stop generating$/,
            /^stop response$/,
            /^停止$/,
            /^生成を停止$/,
            /^応答を停止$/,
        ];
        const isStopLabel = (value) => {
            const normalized = normalize(value);
            if (!normalized) return false;
            return STOP_PATTERNS.some((re) => re.test(normalized));
        };
        for (const scope of scopes) {
            const buttons = scope.querySelectorAll('button, [role="button"]');
            for (let i = 0; i < buttons.length; i++) {
                const btn = buttons[i];
                const labels = [
                    btn.textContent || '',
                    btn.getAttribute('aria-label') || '',
                    btn.getAttribute('title') || '',
                ];
                if (labels.some(isStopLabel) && typeof btn.click === 'function') {
                    btn.click();
                    return { ok: true, method: 'text-fallback' };
                }
            }
        }

        return { ok: false, error: 'Stop button not found' };
    })()`,
    /** Diagnostic: dump ALL candidate text nodes with filter classification */
    DUMP_ALL_TEXTS: `(() => {
        const panel = document.querySelector('.antigravity-agent-side-panel');
        const scopes = [panel, document].filter(Boolean);

        const selectors = [
            { sel: '.rendered-markdown', score: 10 },
            { sel: '.leading-relaxed.select-text', score: 9 },
            { sel: '.flex.flex-col.gap-y-3', score: 8 },
            { sel: '[data-message-author-role="assistant"]', score: 7 },
            { sel: '[data-message-role="assistant"]', score: 6 },
            { sel: '[class*="assistant-message"]', score: 5 },
            { sel: '[class*="message-content"]', score: 4 },
            { sel: '[class*="markdown-body"]', score: 3 },
            { sel: '.prose', score: 2 },
        ];

        const looksLikeActivityLog = (text) => {
            const normalized = (text || '').trim().toLowerCase();
            if (!normalized) return false;
            const stripped = normalized.replace(/^[^a-z]+/i, '');
            const activityPattern = /^(?:analy[sz]ing|reading|writing|running|searching|planning|thinking|processing|loading|executing|testing|debugging|fetching|connecting|creating|updating|deleting|installing|building|compiling|deploying|checking|scanning|parsing|resolving|downloading|uploading|analyzed|read|wrote|ran|created|updated|deleted|fetched|built|compiled|installed|resolved|downloaded|connected)\\b/i;
            if (activityPattern.test(stripped) && normalized.length <= 220) return true;
            if (/^initiating\\s/i.test(stripped) && normalized.length <= 500) return true;
            if (/^thought for\\s/i.test(stripped) && normalized.length <= 500) return true;
            return false;
        };
        const looksLikeFeedbackFooter = (text) => {
            const normalized = (text || '').trim().toLowerCase().replace(/\\s+/g, ' ');
            if (!normalized) return false;
            return normalized === 'good bad' || normalized === 'good' || normalized === 'bad';
        };
        const isInsideExcludedContainer = (node) => {
            if (node.closest('details')) return true;
            if (node.closest('[class*="feedback"], footer')) return true;
            if (node.closest('.notify-user-container')) return true;
            if (node.closest('[role="dialog"]')) return true;
            return false;
        };
        const looksLikeToolOutput = (text) => {
            const first = (text || '').trim().split('\\n')[0] || '';
            if (/^[a-z0-9._-]+\\s*\\/\\s*[a-z0-9._-]+$/i.test(first)) return true;
            if (/^full output written to\\b/i.test(first)) return true;
            if (/^output\\.[a-z0-9._-]+(?:#l\\d+(?:-\\d+)?)?$/i.test(first)) return true;
            var lower = (text || '').trim().toLowerCase();
            if (/^title:\\s/.test(lower) && /\\surl:\\s/.test(lower) && /\\ssnippet:\\s/.test(lower)) return true;
            if (/^(json|javascript|typescript|python|bash|sh|html|css|xml|yaml|yml|toml|sql|graphql|markdown|text|plaintext|log|ruby|go|rust|java|c|cpp|csharp|php|swift|kotlin)$/i.test(first)) return true;
            return false;
        };

        const results = [];
        const seen = new Set();

        for (const scope of scopes) {
            for (const { sel, score } of selectors) {
                const nodes = scope.querySelectorAll(sel);
                for (let i = nodes.length - 1; i >= 0; i--) {
                    const node = nodes[i];
                    if (!node || seen.has(node)) continue;
                    seen.add(node);
                    const text = (node.innerText || node.textContent || '').replace(/\\r/g, '').trim();
                    let skip = null;
                    if (!text || text.length < 2) skip = 'too-short';
                    else if (isInsideExcludedContainer(node)) skip = 'excluded-container';
                    else if (looksLikeActivityLog(text)) skip = 'activity-log';
                    else if (looksLikeFeedbackFooter(text)) skip = 'feedback-footer';
                    else if (looksLikeToolOutput(text)) skip = 'tool-output';
                    else {
                        var qlower = (text || '').trim().toLowerCase();
                        if (qlower.includes('exhausted your quota') || qlower.includes('exhausted quota')) skip = 'quota-popup';
                        else if ((qlower.includes('model quota reached') || qlower.includes('quota exceeded') || qlower.includes('rate limit'))
                            && (qlower.includes('dismiss') || qlower.includes('upgrade'))) skip = 'quota-popup';
                    }
                    const classes = (node.className || '').toString().slice(0, 80);
                    results.push({
                        sel,
                        score,
                        skip,
                        len: text.length,
                        classes,
                        preview: text.slice(0, 120),
                    });
                }
            }
        }
        return results;
    })()`,
    /** Extract process log entries (activity messages + tool output) from DOM */
    PROCESS_LOGS: `(() => {
        const panel = document.querySelector('.antigravity-agent-side-panel');
        const scopes = [panel, document].filter(Boolean);

        const selectors = [
            { sel: '.rendered-markdown', score: 10 },
            { sel: '.leading-relaxed.select-text', score: 9 },
            { sel: '.flex.flex-col.gap-y-3', score: 8 },
            { sel: '[data-message-author-role="assistant"]', score: 7 },
            { sel: '[data-message-role="assistant"]', score: 6 },
            { sel: '[class*="assistant-message"]', score: 5 },
            { sel: '[class*="message-content"]', score: 4 },
            { sel: '[class*="markdown-body"]', score: 3 },
            { sel: '.prose', score: 2 },
        ];

        const looksLikeActivityLog = (text) => {
            const normalized = (text || '').trim().toLowerCase();
            if (!normalized) return false;
            const stripped = normalized.replace(/^[^a-z]+/i, '');
            const activityPattern = /^(?:analy[sz]ing|reading|writing|running|searching|planning|thinking|processing|loading|executing|testing|debugging|fetching|connecting|creating|updating|deleting|installing|building|compiling|deploying|checking|scanning|parsing|resolving|downloading|uploading|analyzed|read|wrote|ran|created|updated|deleted|fetched|built|compiled|installed|resolved|downloaded|connected)\\b/i;
            if (activityPattern.test(stripped) && normalized.length <= 220) return true;
            if (/^initiating\\s/i.test(stripped) && normalized.length <= 500) return true;
            if (/^thought for\\s/i.test(stripped) && normalized.length <= 500) return true;
            return false;
        };

        const looksLikeToolOutput = (text) => {
            const first = (text || '').trim().split('\\n')[0] || '';
            if (/^[a-z0-9._-]+\\s*\\/\\s*[a-z0-9._-]+$/i.test(first)) return true;
            if (/^full output written to\\b/i.test(first)) return true;
            if (/^output\\.[a-z0-9._-]+(?:#l\\d+(?:-\\d+)?)?$/i.test(first)) return true;
            var lower = (text || '').trim().toLowerCase();
            if (/^title:\\s/.test(lower) && /\\surl:\\s/.test(lower) && /\\ssnippet:\\s/.test(lower)) return true;
            if (/^(json|javascript|typescript|python|bash|sh|html|css|xml|yaml|yml|toml|sql|graphql|markdown|text|plaintext|log|ruby|go|rust|java|c|cpp|csharp|php|swift|kotlin)$/i.test(first)) return true;
            return false;
        };

        const isInsideExcludedContainer = (node) => {
            if (node.closest('details')) return true;
            if (node.closest('[class*="feedback"], footer')) return true;
            if (node.closest('.notify-user-container')) return true;
            if (node.closest('[role="dialog"]')) return true;
            return false;
        };

        const results = [];
        const seen = new Set();

        for (const scope of scopes) {
            for (const { sel } of selectors) {
                const nodes = scope.querySelectorAll(sel);
                for (let i = 0; i < nodes.length; i++) {
                    const node = nodes[i];
                    if (!node || seen.has(node)) continue;
                    seen.add(node);
                    if (isInsideExcludedContainer(node)) continue;
                    const text = (node.innerText || node.textContent || '').replace(/\\r/g, '').trim();
                    if (!text || text.length < 4) continue;
                    if (looksLikeActivityLog(text) || looksLikeToolOutput(text)) {
                        results.push(text.slice(0, 300));
                    }
                }
            }
        }

        return results;
    })()`,
    /** Combined poll script — stop button + quota error + legacy text in one CDP call */
    COMBINED_POLL: `(() => {
        const panel = document.querySelector('.antigravity-agent-side-panel');
        const scopes = [panel, document].filter(Boolean);

        // --- Stop button ---
        let isGenerating = false;
        for (const scope of scopes) {
            const el = scope.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
            if (el) { isGenerating = true; break; }
        }
        if (!isGenerating) {
            const normalize = (value) => (value || '').toLowerCase().replace(/\\s+/g, ' ').trim();
            const STOP_PATTERNS = [/^stop$/, /^stop generating$/, /^stop response$/, /^停止$/, /^生成を停止$/, /^応答を停止$/];
            const isStopLabel = (value) => { const n = normalize(value); return n ? STOP_PATTERNS.some((re) => re.test(n)) : false; };
            outer: for (const scope of scopes) {
                const buttons = scope.querySelectorAll('button, [role="button"]');
                for (let i = 0; i < buttons.length; i++) {
                    const btn = buttons[i];
                    if ([btn.textContent || '', btn.getAttribute('aria-label') || '', btn.getAttribute('title') || ''].some(isStopLabel)) {
                        isGenerating = true; break outer;
                    }
                }
            }
        }

        // --- Quota error ---
        let quotaError = false;
        const scope = panel || document;
        const QUOTA_KEYWORDS = ['model quota reached', 'rate limit', 'quota exceeded', 'exhausted your quota', 'exhausted quota'];
        const isInsideResponse = (node) =>
            node.closest('.rendered-markdown, .prose, pre, code, [data-message-author-role="assistant"], [data-message-role="assistant"], [class*="message-content"]');
        const headings = scope.querySelectorAll('h3 span, h3');
        for (const el of headings) {
            if (isInsideResponse(el)) continue;
            const text = (el.textContent || '').trim().toLowerCase();
            if (QUOTA_KEYWORDS.some(kw => text.includes(kw))) { quotaError = true; break; }
        }
        if (!quotaError) {
            const inlineSpans = scope.querySelectorAll('span');
            for (const el of inlineSpans) {
                if (isInsideResponse(el)) continue;
                const text = (el.textContent || '').trim().toLowerCase();
                if (text.includes('exhausted your quota') || text.includes('exhausted quota')) { quotaError = true; break; }
            }
        }
        if (!quotaError) {
            const errorSelectors = ['[role="alert"]','[class*="error"]','[class*="warning"]','[class*="toast"]','[class*="banner"]','[class*="notification"]','[class*="alert"]','[class*="quota"]','[class*="rate-limit"]'];
            const errorElements = scope.querySelectorAll(errorSelectors.join(', '));
            for (const el of errorElements) {
                if (isInsideResponse(el)) continue;
                const text = (el.textContent || '').trim().toLowerCase();
                if (QUOTA_KEYWORDS.some(kw => text.includes(kw))) { quotaError = true; break; }
            }
        }

        // --- Planning active ---
        let planningActive = false;
        const container = document.querySelector('.notify-user-container');
        if (container) {
            const buttons = Array.from(container.querySelectorAll('button')).filter(function(btn) { return btn.offsetParent !== null; });
            const hasOpen = buttons.some(function(btn) { return (btn.textContent || '').toLowerCase().trim() === 'open'; });
            const hasProceed = buttons.some(function(btn) { return (btn.textContent || '').toLowerCase().trim() === 'proceed'; });
            planningActive = hasOpen && hasProceed;
        }

        // --- Legacy text extraction ---
        const selectors = [
            { sel: '.rendered-markdown', score: 10 },
            { sel: '.leading-relaxed.select-text', score: 9 },
            { sel: '.flex.flex-col.gap-y-3', score: 8 },
            { sel: '[data-message-author-role="assistant"]', score: 7 },
            { sel: '[data-message-role="assistant"]', score: 6 },
            { sel: '[class*="assistant-message"]', score: 5 },
            { sel: '[class*="message-content"]', score: 4 },
            { sel: '[class*="markdown-body"]', score: 3 },
            { sel: '.prose', score: 2 },
        ];
        const looksLikeActivityLog = (text) => {
            const normalized = (text || '').trim().toLowerCase();
            if (!normalized) return false;
            const stripped = normalized.replace(/^[^a-z]+/i, '');
            const activityPattern = /^(?:analy[sz]ing|reading|writing|running|searching|planning|thinking|processing|loading|executing|testing|debugging|fetching|connecting|creating|updating|deleting|installing|building|compiling|deploying|checking|scanning|parsing|resolving|downloading|uploading|analyzed|read|wrote|ran|created|updated|deleted|fetched|built|compiled|installed|resolved|downloaded|connected)\\b/i;
            if (activityPattern.test(stripped) && normalized.length <= 220) return true;
            if (/^initiating\\s/i.test(stripped) && normalized.length <= 500) return true;
            if (/^thought for\\s/i.test(stripped) && normalized.length <= 500) return true;
            return false;
        };
        const looksLikeFeedbackFooter = (text) => {
            const normalized = (text || '').trim().toLowerCase().replace(/\\s+/g, ' ');
            if (!normalized) return false;
            return normalized === 'good bad' || normalized === 'good' || normalized === 'bad';
        };
        const isInsideExcludedContainer = (node) => {
            if (node.closest('details')) return true;
            if (node.closest('[class*="feedback"], footer')) return true;
            if (node.closest('.notify-user-container')) return true;
            if (node.closest('[role="dialog"]')) return true;
            return false;
        };
        const looksLikeToolOutput = (text) => {
            const first = (text || '').trim().split('\\n')[0] || '';
            if (/^[a-z0-9._-]+\\s*\\/\\s*[a-z0-9._-]+$/i.test(first)) return true;
            if (/^full output written to\\b/i.test(first)) return true;
            if (/^output\\.[a-z0-9._-]+(?:#l\\d+(?:-\\d+)?)?$/i.test(first)) return true;
            var lower = (text || '').trim().toLowerCase();
            if (/^title:\\s/.test(lower) && /\\surl:\\s/.test(lower) && /\\ssnippet:\\s/.test(lower)) return true;
            if (/^(json|javascript|typescript|python|bash|sh|html|css|xml|yaml|yml|toml|sql|graphql|markdown|text|plaintext|log|ruby|go|rust|java|c|cpp|csharp|php|swift|kotlin)$/i.test(first)) return true;
            return false;
        };
        const looksLikeQuotaPopup = (text) => {
            var lower = (text || '').trim().toLowerCase();
            if (lower.includes('exhausted your quota') || lower.includes('exhausted quota')) return true;
            if (!lower.includes('model quota reached') && !lower.includes('quota exceeded') && !lower.includes('rate limit')) return false;
            return lower.includes('dismiss') || lower.includes('upgrade');
        };
        const combinedSelector = selectors.map((s) => s.sel).join(', ');
        const seen = new Set();
        let responseText = null;
        for (const s of scopes) {
            const nodes = s.querySelectorAll(combinedSelector);
            for (let i = nodes.length - 1; i >= 0; i--) {
                const node = nodes[i];
                if (!node || seen.has(node)) continue;
                seen.add(node);
                if (isInsideExcludedContainer(node)) continue;
                const text = (node.innerText || node.textContent || '').replace(/\\r/g, '').trim();
                if (!text || text.length < 2) continue;
                if (looksLikeActivityLog(text)) continue;
                if (looksLikeFeedbackFooter(text)) continue;
                if (looksLikeToolOutput(text)) continue;
                if (looksLikeQuotaPopup(text)) continue;
                responseText = text;
                break;
            }
            if (responseText !== null) break;
        }

        // --- Process logs ---
        const logSeen = new Set();
        const processLogs = [];
        for (const s of scopes) {
            for (const { sel } of selectors) {
                const nodes = s.querySelectorAll(sel);
                for (let i = 0; i < nodes.length; i++) {
                    const node = nodes[i];
                    if (!node || logSeen.has(node)) continue;
                    logSeen.add(node);
                    if (isInsideExcludedContainer(node)) continue;
                    const text = (node.innerText || node.textContent || '').replace(/\\r/g, '').trim();
                    if (!text || text.length < 4) continue;
                    if (looksLikeActivityLog(text) || looksLikeToolOutput(text)) {
                        processLogs.push(text.slice(0, 300));
                    }
                }
            }
        }

        return { isGenerating, quotaError, planningActive, responseText, processLogs };
    })()`,
    /** Quota error detection — text-based h3 span match first, class-based fallback second */
    QUOTA_ERROR: `(() => {
        const panel = document.querySelector('.antigravity-agent-side-panel');
        const scope = panel || document;
        const QUOTA_KEYWORDS = ['model quota reached', 'rate limit', 'quota exceeded', 'exhausted your quota', 'exhausted quota'];
        const isInsideResponse = (node) =>
            node.closest('.rendered-markdown, .prose, pre, code, [data-message-author-role="assistant"], [data-message-role="assistant"], [class*="message-content"]');

        // Primary: text-based detection via h3 span (Tailwind-only popup)
        const headings = scope.querySelectorAll('h3 span, h3');
        for (const el of headings) {
            if (isInsideResponse(el)) continue;
            const text = (el.textContent || '').trim().toLowerCase();
            if (QUOTA_KEYWORDS.some(kw => text.includes(kw))) return true;
        }

        // Inline error: "Error You have exhausted your quota on this model."
        // Appears in process log area as a span inside flex containers
        const inlineSpans = scope.querySelectorAll('span');
        for (const el of inlineSpans) {
            if (isInsideResponse(el)) continue;
            const text = (el.textContent || '').trim().toLowerCase();
            if (text.includes('exhausted your quota') || text.includes('exhausted quota')) return true;
        }

        // Fallback: semantic class-based detection
        const errorSelectors = [
            '[role="alert"]',
            '[class*="error"]',
            '[class*="warning"]',
            '[class*="toast"]',
            '[class*="banner"]',
            '[class*="notification"]',
            '[class*="alert"]',
            '[class*="quota"]',
            '[class*="rate-limit"]',
        ];
        const errorElements = scope.querySelectorAll(errorSelectors.join(', '));
        for (const el of errorElements) {
            if (isInsideResponse(el)) continue;
            const text = (el.textContent || '').trim().toLowerCase();
            if (QUOTA_KEYWORDS.some(kw => text.includes(kw))) return true;
        }
        return false;
    })()`,
    /** Structured DOM extraction — walks DOM to produce typed segment array */
    RESPONSE_STRUCTURED: extractAssistantSegmentsPayloadScript(),
    /** One-shot DOM diagnostic — dumps DOM structure around activity areas */
    DOM_DIAGNOSTIC: `(() => {
        var panel = document.querySelector('.antigravity-agent-side-panel');
        var scope = panel || document;
        var diag = { detailsCount: 0, detailsDump: [], activityNodes: [], allTextNodes: [] };

        // 1. Dump all <details> elements
        var details = scope.querySelectorAll('details');
        diag.detailsCount = details.length;
        for (var i = 0; i < Math.min(details.length, 5); i++) {
            diag.detailsDump.push({
                outerHTML: details[i].outerHTML.slice(0, 500),
                summaryText: (details[i].querySelector('summary') || {}).textContent || '(no summary)',
                childCount: details[i].children.length
            });
        }

        // 2. Find all text nodes that look like activity
        var selectors = '.rendered-markdown, .leading-relaxed.select-text, .flex.flex-col.gap-y-3, [data-message-author-role="assistant"], [data-message-role="assistant"], [class*="assistant-message"], [class*="message-content"], [class*="markdown-body"], .prose';
        var nodes = scope.querySelectorAll(selectors);
        for (var j = 0; j < nodes.length; j++) {
            var text = (nodes[j].innerText || nodes[j].textContent || '').trim();
            if (!text || text.length < 2) continue;
            diag.allTextNodes.push({
                tag: nodes[j].tagName,
                className: (nodes[j].className || '').toString().slice(0, 100),
                text: text.slice(0, 200),
                insideDetails: !!nodes[j].closest('details'),
                length: text.length
            });
        }

        // 3. Broader scan: any element with activity-like text
        var allEls = scope.querySelectorAll('*');
        for (var k = 0; k < allEls.length; k++) {
            var el = allEls[k];
            if (el.children.length > 2) continue; // only leaf-ish nodes
            var t = (el.textContent || '').trim();
            if (!t || t.length < 5 || t.length > 300) continue;
            var lower = t.toLowerCase();
            if (/^(?:analy[sz]|read|writ|run|search|think|process|execut|debug|test)/i.test(lower) || /\\//.test(t)) {
                diag.activityNodes.push({
                    tag: el.tagName,
                    className: (el.className || '').toString().slice(0, 100),
                    text: t.slice(0, 200),
                    parentTag: el.parentElement ? el.parentElement.tagName : null,
                    parentClass: el.parentElement ? (el.parentElement.className || '').toString().slice(0, 100) : null,
                    insideDetails: !!el.closest('details')
                });
            }
        }
        return diag;
    })()`,
    /** Injected MutationObserver to push DOM changes via addBinding */
    DOM_OBSERVER: `(() => {
        const panel = document.querySelector('.antigravity-agent-side-panel') || document.body;
        // Clean up previous observer if exists
        if (window._antigravity-telegram-remoteObserver) window._antigravity-telegram-remoteObserver.disconnect();
        
        let debounceTimer;
        const notify = () => {
            if (typeof window.onantigravity-telegram-remoteDOMChange === 'function') {
                window.onantigravity-telegram-remoteDOMChange('changed');
            }
        };

        window._antigravity-telegram-remoteObserver = new MutationObserver((mutations) => {
            clearTimeout(debounceTimer);
            // Throttle to 100ms to avoid flooding CDP during rapid streaming
            debounceTimer = setTimeout(notify, 100);
        });

        window._antigravity-telegram-remoteObserver.observe(panel, {
            childList: true,
            subtree: true,
            characterData: true
        });
        return { ok: true, observing: panel.className || 'body' };
    })()`,
};

/** Response generation phases */
export type ResponsePhase = 'waiting' | 'thinking' | 'generating' | 'complete' | 'timeout' | 'quotaReached';

export interface ResponseMonitorOptions {
    /** CDP service instance */
    cdpService: CdpService;
    /** Poll interval in ms (default: 2000) */
    pollIntervalMs?: number;
    /** Max monitoring duration in ms (default: 300000) */
    maxDurationMs?: number;
    /** Consecutive stop-gone confirmations needed (default: 3) */
    stopGoneConfirmCount?: number;
    /** Extraction mode: 'legacy' uses innerText, 'structured' uses DOM segment extraction */
    extractionMode?: ExtractionMode;
    /** Text update callback */
    onProgress?: (text: string) => void;
    /** Generation complete callback. Meta.source indicates whether text is already Telegram HTML (structured) or plain (legacy). */
    onComplete?: (finalText: string, meta?: { source: 'structured' | 'legacy' }) => void;
    /** Timeout callback */
    onTimeout?: (lastText: string) => void;
    /** Phase change callback */
    onPhaseChange?: (phase: ResponsePhase, text: string | null) => void;
    /** Process log update callback (activity messages + tool output) */
    onProcessLog?: (text: string) => void;
    /** Thinking content callback (AI thinking/reasoning text) */
    onThinkingLog?: (text: string) => void;
}

/**
 * Lean AI response monitor.
 *
 * Each poll makes exactly 3 CDP calls: stop button, quota, text extraction.
 * Completion: stop button gone N consecutive times -> complete.
 * Simple baseline suppression via string comparison.
 * NO network event subscription.
 */
export class ResponseMonitor {
    private readonly cdpService: CdpService;
    private readonly pollIntervalMs: number;
    private readonly maxDurationMs: number;
    private readonly stopGoneConfirmCount: number;
    private readonly extractionMode: ExtractionMode;
    private readonly onProgress?: (text: string) => void;
    private readonly onComplete?: (finalText: string, meta?: { source: 'structured' | 'legacy' }) => void;
    private readonly onTimeout?: (lastText: string) => void;
    private readonly onPhaseChange?: (phase: ResponsePhase, text: string | null) => void;
    private readonly onProcessLog?: (text: string) => void;
    private readonly onThinkingLog?: (text: string) => void;

    private pollTimer: ReturnType<typeof setTimeout> | null = null;
    private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    private isRunning: boolean = false;
    private lastText: string | null = null;
    private baselineText: string | null = null;
    private generationStarted: boolean = false;
    private currentPhase: ResponsePhase = 'waiting';
    private stopGoneCount: number = 0;
    private quotaDetected: boolean = false;
    private seenProcessLogKeys: Set<string> = new Set();
    private seenThinkingLogKeys: Set<string> = new Set();
    private structuredDiagLogged: boolean = false;
    private lastExtractionSource: 'structured' | 'legacy' | null = null;
    /** Consecutive WebSocket error count — stops monitor after threshold */
    private consecutiveWsErrors: number = 0;
    /** Timer for debouncing events from the browser */
    private domChangedDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    /** Listener for CDP binding events */
    private bindingListener: ((params: any) => void) | null = null;

    constructor(options: ResponseMonitorOptions) {
        this.cdpService = options.cdpService;
        this.pollIntervalMs = options.pollIntervalMs ?? 2000;
        this.maxDurationMs = options.maxDurationMs ?? 300000;
        this.stopGoneConfirmCount = options.stopGoneConfirmCount ?? 3;
        this.extractionMode = options.extractionMode
            ?? (process.env.EXTRACTION_MODE === 'legacy' ? 'legacy' : 'structured');
        this.onProgress = options.onProgress;
        this.onComplete = options.onComplete;
        this.onTimeout = options.onTimeout;
        this.onPhaseChange = options.onPhaseChange;
        this.onProcessLog = options.onProcessLog;
        this.onThinkingLog = options.onThinkingLog;

        // Listen for push notifications from the browser
        this.bindingListener = (params: any) => {
            if (params.name === 'onantigravity-telegram-remoteDOMChange' && this.isRunning) {
                this.handleDomChangedEvent();
            }
        };
        this.cdpService.on('Runtime.bindingCalled', this.bindingListener);
    }

    /** Start monitoring */
    async start(): Promise<void> {
        return this.initMonitoring(false);
    }

    /**
     * Start monitoring in passive mode.
     * Same as start() but with generationStarted=true, so text changes
     * are detected immediately without waiting for the stop button to appear.
     * Used when joining an existing session that may already be generating.
     */
    async startPassive(): Promise<void> {
        return this.initMonitoring(true);
    }

    /** Internal initialization shared between start() and startPassive() */
    private async initMonitoring(passive: boolean): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastText = null;
        this.baselineText = null;
        this.generationStarted = passive;
        this.currentPhase = passive ? 'generating' : 'waiting';
        this.stopGoneCount = 0;
        this.quotaDetected = false;
        this.seenProcessLogKeys = new Set();
        this.seenThinkingLogKeys = new Set();
        this.consecutiveWsErrors = 0;

        this.onPhaseChange?.(this.currentPhase, null);

        // Capture baselines in parallel (text + process logs + optional structured)
        const baselinePromises: Promise<any>[] = [
            this.cdpService.call('Runtime.evaluate', this.buildEvaluateParams(RESPONSE_SELECTORS.RESPONSE_TEXT)).catch(() => null),
            this.cdpService.call('Runtime.evaluate', this.buildEvaluateParams(RESPONSE_SELECTORS.PROCESS_LOGS)).catch(() => null),
        ];
        if (this.extractionMode === 'structured') {
            baselinePromises.push(
                this.cdpService.call('Runtime.evaluate', this.buildEvaluateParams(RESPONSE_SELECTORS.RESPONSE_STRUCTURED)).catch(() => null),
            );
        }
        const [baseResult, logResult, structuredBaseline] = await Promise.all(baselinePromises);

        // Baseline text
        const rawValue = baseResult?.result?.value;
        this.baselineText = typeof rawValue === 'string' ? rawValue.trim() || null : null;

        // Baseline process log keys
        const logEntries = logResult?.result?.value;
        if (Array.isArray(logEntries)) {
            this.seenProcessLogKeys = new Set(
                logEntries
                    .map((s: string) => (s || '').replace(/\r/g, '').trim())
                    .filter((s: string) => s.length > 0)
                    .map((s: string) => s.slice(0, 200)),
            );
        }

        // Structured baseline activity lines
        if (structuredBaseline) {
            try {
                const baselineClassified = classifyAssistantSegments(structuredBaseline?.result?.value);
                if (baselineClassified.diagnostics.source === 'dom-structured') {
                    for (const line of baselineClassified.activityLines) {
                        const key = (line || '').replace(/\r/g, '').trim().slice(0, 200);
                        if (key) this.seenProcessLogKeys.add(key);
                    }
                    for (const line of baselineClassified.thinkingLines) {
                        const key = (line || '').replace(/\r/g, '').trim().slice(0, 200);
                        if (key) this.seenThinkingLogKeys.add(key);
                    }
                }
            } catch {
                // structured baseline is best-effort
            }
        }

        // Set timeout timer
        if (this.maxDurationMs > 0) {
            this.timeoutTimer = setTimeout(async () => {
                // Guard: skip if already completed or quota-reached
                if (this.currentPhase === 'complete' || this.currentPhase === 'quotaReached') return;
                const lastText = this.lastText ?? '';
                this.setPhase('timeout', lastText);
                await this.stop();
                try {
                    await Promise.resolve(this.onTimeout?.(lastText));
                } catch (error) {
                    logger.error('[ResponseMonitor] timeout callback failed:', error);
                }
            }, this.maxDurationMs);
        }

        // Inject the MutationObserver for real-time push notifications
        try {
            await this.cdpService.call('Runtime.evaluate', this.buildEvaluateParams(RESPONSE_SELECTORS.DOM_OBSERVER));
            logger.debug('[ResponseMonitor] MutationObserver injected successfully');
        } catch (err) {
            logger.warn('[ResponseMonitor] Failed to inject MutationObserver (falling back to pure polling):', err);
        }

        const mode = passive ? 'Passive monitoring' : 'Monitoring';
        logger.debug(
            `── ${mode} started | poll=${this.pollIntervalMs}ms timeout=${this.maxDurationMs / 1000}s baseline=${this.baselineText?.length ?? 0}ch`,
        );

        this.schedulePoll();
    }

    /** Stop monitoring */
    async stop(): Promise<void> {
        this.isRunning = false;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
        if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = null;
        }
        if (this.domChangedDebounceTimer) {
            clearTimeout(this.domChangedDebounceTimer);
            this.domChangedDebounceTimer = null;
        }

        if (this.bindingListener) {
            this.cdpService.off('Runtime.bindingCalled', this.bindingListener);
        }
    }

    /**
     * Handle DOM change event from the browser.
     * Triggers an immediate poll with debouncing.
     */
    private handleDomChangedEvent(): void {
        if (!this.isRunning) return;

        // If we're already generating, use a shorter debounce to keep up with streaming
        const debounceMs = this.currentPhase === 'generating' ? 200 : 500;

        if (this.domChangedDebounceTimer) {
            clearTimeout(this.domChangedDebounceTimer);
        }

        this.domChangedDebounceTimer = setTimeout(async () => {
            if (!this.isRunning) return;
            logger.debug('[ResponseMonitor] Event-triggered poll');
            // Check if another poll is already clearing
            if (this.pollTimer) {
                clearTimeout(this.pollTimer);
                this.pollTimer = null;
            }
            await this.poll();
            if (this.isRunning) {
                this.schedulePoll();
            }
        }, debounceMs);
    }

    /** Get current phase */
    getPhase(): ResponsePhase {
        return this.currentPhase;
    }

    /** Whether quota error was detected */
    getQuotaDetected(): boolean {
        return this.quotaDetected;
    }

    /** Whether monitoring is active */
    isActive(): boolean {
        return this.isRunning;
    }

    /** Get last extracted text */
    getLastText(): string | null {
        return this.lastText;
    }

    /** Get last extraction source (structured = HTML, legacy = plain text) */
    getLastExtractionSource(): 'structured' | 'legacy' | null {
        return this.lastExtractionSource;
    }

    /** Click the stop button to interrupt LLM generation */
    async clickStopButton(): Promise<{ ok: boolean; method?: string; error?: string }> {
        try {
            const result = await this.cdpService.call(
                'Runtime.evaluate',
                this.buildEvaluateParams(RESPONSE_SELECTORS.CLICK_STOP_BUTTON),
            );
            const value = result?.result?.value;

            if (this.isRunning) {
                await this.stop();
            }

            return value ?? { ok: false, error: 'CDP evaluation returned empty' };
        } catch (error: any) {
            return { ok: false, error: error.message || 'Failed to click stop button' };
        }
    }

    private setPhase(phase: ResponsePhase, text: string | null): void {
        if (this.currentPhase !== phase) {
            this.currentPhase = phase;
            const len = text?.length ?? 0;
            switch (phase) {
                case 'thinking':
                    logger.phase('Thinking');
                    break;
                case 'generating':
                    logger.phase(`Generating (${len} chars)`);
                    break;
                case 'complete':
                    logger.done(`Complete (${len} chars)`);
                    break;
                case 'timeout':
                    logger.warn(`Timeout (${len} chars captured)`);
                    break;
                case 'quotaReached':
                    logger.warn('Quota Reached');
                    break;
                default:
                    logger.phase(`${phase}`);
            }
            this.onPhaseChange?.(phase, text);
        }
    }

    private schedulePoll(): void {
        if (!this.isRunning) return;
        this.pollTimer = setTimeout(async () => {
            await this.poll();
            if (this.isRunning) {
                this.schedulePoll();
            }
        }, this.pollIntervalMs);
    }

    private buildEvaluateParams(expression: string): Record<string, unknown> {
        const params: Record<string, unknown> = {
            expression,
            returnByValue: true,
            awaitPromise: true,
        };
        const contextId = this.cdpService.getPrimaryContextId?.();
        if (contextId !== null && contextId !== undefined) {
            params.contextId = contextId;
        }
        return params;
    }

    /**
     * Emit new process log entries, deduplicating against previously seen keys.
     */
    private emitNewProcessLogs(entries: string[]): void {
        for (const line of entries) {
            const normalized = (line || '').replace(/\r/g, '').trim();
            if (!normalized) continue;
            const key = normalized.slice(0, 200);
            if (this.seenProcessLogKeys.has(key)) continue;
            this.seenProcessLogKeys.add(key);
            try {
                this.onProcessLog?.(normalized.slice(0, 300));
            } catch {
                // callback error
            }
        }
    }

    /**
     * Emit new thinking log entries, deduplicating against previously seen keys.
     */
    private emitNewThinkingLogs(entries: string[]): void {
        for (const line of entries) {
            const normalized = (line || '').replace(/\r/g, '').trim();
            if (!normalized) continue;
            const key = normalized.slice(0, 200);
            if (this.seenThinkingLogKeys.has(key)) continue;
            this.seenThinkingLogKeys.add(key);
            // Also mark as seen in process logs to prevent cross-contamination
            this.seenProcessLogKeys.add(key);
            logger.debug('[ResponseMonitor] Emitting thinking entry:', normalized.slice(0, 80));
            try {
                this.onThinkingLog?.(normalized.slice(0, 2000));
            } catch {
                // callback error
            }
        }
    }

    /**
     * Single poll cycle.
     * - Legacy mode: 4 CDP calls (stop, quota, text, process logs).
     * - Structured mode: 3-4 CDP calls (stop, quota, structured; legacy text on fallback).
     */
    private async poll(): Promise<void> {
        try {
            let isGenerating: boolean;
            let quotaDetected: boolean;
            let planningActive: boolean;
            let currentText: string | null = null;
            let structuredHandledLogs = false;

            if (this.extractionMode === 'structured') {
                // Structured mode: run combined (stop+quota+planning) in parallel with structured extraction
                const [combinedResult, structuredResult] = await Promise.all([
                    this.cdpService.call('Runtime.evaluate', this.buildEvaluateParams(RESPONSE_SELECTORS.COMBINED_POLL)),
                    this.cdpService.call('Runtime.evaluate', this.buildEvaluateParams(RESPONSE_SELECTORS.RESPONSE_STRUCTURED)).catch(() => null),
                ]);

                const combined = combinedResult?.result?.value ?? {};
                isGenerating = !!combined.isGenerating;
                quotaDetected = !!combined.quotaError;
                planningActive = !!combined.planningActive;

                // Try structured extraction first
                if (structuredResult) {
                    try {
                        const payload = structuredResult?.result?.value;
                        const classified = classifyAssistantSegments(payload);

                        if (classified.diagnostics.source === 'dom-structured') {
                            currentText = classified.finalOutputText.trim() || null;
                            this.lastExtractionSource = 'structured';
                            structuredHandledLogs = true;

                            if (!this.structuredDiagLogged) {
                                this.structuredDiagLogged = true;
                                logger.debug('[ResponseMonitor] Structured extraction OK — segments:', classified.diagnostics.segmentCounts);
                            }

                            if (classified.activityLines.length > 0) {
                                this.emitNewProcessLogs(classified.activityLines);
                            }
                            if (classified.thinkingLines.length > 0) {
                                logger.debug('[ResponseMonitor] Thinking lines found:', classified.thinkingLines.length,
                                    'previews:', classified.thinkingLines.map(l => l.slice(0, 80)));
                                this.emitNewThinkingLogs(classified.thinkingLines);
                            }
                        } else if (!this.structuredDiagLogged) {
                            this.structuredDiagLogged = true;
                            logger.warn(
                                '[ResponseMonitor:poll] Structured extraction failed — reason:',
                                classified.diagnostics.fallbackReason ?? 'unknown',
                                '| payload type:', typeof payload,
                                '| payload:', payload === null ? 'null' : payload === undefined ? 'undefined' : 'object',
                            );
                        }
                    } catch (error) {
                        logger.warn('[ResponseMonitor:poll] RESPONSE_STRUCTURED classification failed:', error);
                    }
                }

                // Fallback to legacy text from combined result
                if (currentText === null) {
                    currentText = typeof combined.responseText === 'string' ? combined.responseText.trim() || null : null;
                    this.lastExtractionSource = 'legacy';
                }

                // Process logs from combined result
                if (!structuredHandledLogs && Array.isArray(combined.processLogs)) {
                    this.emitNewProcessLogs(combined.processLogs);
                }
            } else {
                // Legacy mode: single combined CDP call gets everything
                const combinedResult = await this.cdpService.call(
                    'Runtime.evaluate',
                    this.buildEvaluateParams(RESPONSE_SELECTORS.COMBINED_POLL),
                );
                const combined = combinedResult?.result?.value ?? {};
                isGenerating = !!combined.isGenerating;
                quotaDetected = !!combined.quotaError;
                planningActive = !!combined.planningActive;
                currentText = typeof combined.responseText === 'string' ? combined.responseText.trim() || null : null;
                this.lastExtractionSource = 'legacy';

                if (Array.isArray(combined.processLogs)) {
                    this.emitNewProcessLogs(combined.processLogs);
                }
            }

            // CDP calls succeeded — reset WebSocket error counter
            this.consecutiveWsErrors = 0;

            // Handle stop button appearing
            if (isGenerating) {
                if (!this.generationStarted) {
                    this.generationStarted = true;
                    this.setPhase('thinking', null);
                }
                this.stopGoneCount = 0;
            }

            // Handle quota detection
            if (quotaDetected) {
                const hasText = !!(this.lastText && this.lastText.trim().length > 0);
                logger.warn(`[ResponseMonitor] quota detected hasText=${hasText}`);
                if (hasText) {
                    this.quotaDetected = true;
                } else {
                    this.setPhase('quotaReached', '');
                    await this.stop();
                    try {
                        await Promise.resolve(this.onComplete?.('', { source: 'legacy' }));
                    } catch (error) {
                        logger.error('[ResponseMonitor] complete callback failed:', error);
                    }
                    return;
                }
            }

            // Baseline suppression: do not emit progress for pre-existing text.
            // IMPORTANT: do not early-return here; completion logic must still run.
            const effectiveText = (
                currentText !== null &&
                this.baselineText !== null &&
                currentText === this.baselineText &&
                this.lastText === null
            ) ? null : currentText;

            // Text change handling
            const textChanged = effectiveText !== null && effectiveText !== this.lastText;
            if (textChanged) {
                this.lastText = effectiveText;

                if (this.currentPhase === 'waiting' || this.currentPhase === 'thinking') {
                    this.setPhase('generating', effectiveText);
                    if (!this.generationStarted) {
                        this.generationStarted = true;
                    }
                }

                this.onProgress?.(effectiveText);
            }

            // Completion: stop button gone N consecutive times
            if (!isGenerating && this.generationStarted) {
                // Planning check already done in combined poll script
                if (planningActive) {
                    this.stopGoneCount = 0;
                    logger.info('[ResponseMonitor] Planning dialog active — deferring completion');
                } else {
                    this.stopGoneCount++;
                    if (this.stopGoneCount >= this.stopGoneConfirmCount && this.isRunning) {
                        const finalText = this.lastText ?? '';
                        this.setPhase('complete', finalText);
                        await this.stop();
                        try {
                            const source = this.lastExtractionSource ?? 'legacy';
                            await Promise.resolve(this.onComplete?.(finalText, { source }));
                        } catch (error) {
                            logger.error('[ResponseMonitor] complete callback failed:', error);
                        }
                        return;
                    }
                }
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            if (msg.includes('WebSocket is not connected') || msg.includes('WebSocket disconnected')) {
                this.consecutiveWsErrors++;
                if (this.consecutiveWsErrors >= 5) {
                    logger.error(`[ResponseMonitor] ${this.consecutiveWsErrors} consecutive WebSocket errors — stopping monitor`);
                    const lastText = this.lastText ?? '';
                    await this.stop();
                    try {
                        await Promise.resolve(this.onTimeout?.(lastText));
                    } catch { /* callback error */ }
                }
                return;
            }
            logger.error('[ResponseMonitor] poll error:', error);
        }
    }
}
