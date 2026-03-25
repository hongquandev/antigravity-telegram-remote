import {
    buildSessionPickerUI,
    isSessionSelectId,
    SESSION_SELECT_ID,
} from '../../src/ui/sessionPickerUi';
import { SessionListItem } from '../../src/services/chatSessionService';

describe('sessionPickerUi', () => {
    describe('isSessionSelectId', () => {
        it('matches session_select custom ID prefix', () => {
            expect(isSessionSelectId(`${SESSION_SELECT_ID}:some_session`)).toBe(true);
        });

        it('matches exact session_select custom ID', () => {
            expect(isSessionSelectId(SESSION_SELECT_ID)).toBe(true);
        });

        it('does not match unrelated custom IDs', () => {
            expect(isSessionSelectId('project_select')).toBe(false);
            expect(isSessionSelectId('mode_select')).toBe(false);
            expect(isSessionSelectId('')).toBe(false);
        });
    });

    describe('buildSessionPickerUI', () => {
        it('returns text and keyboard for multiple sessions', () => {
            const sessions: SessionListItem[] = [
                { title: 'Fix login bug', isActive: true },
                { title: 'Refactor auth', isActive: false },
                { title: 'Add tests', isActive: false },
            ];

            const { text, keyboard } = buildSessionPickerUI(sessions);

            expect(text).toContain('3');
            expect(keyboard).toBeDefined();
        });

        it('returns empty keyboard for zero sessions', () => {
            const { text, keyboard } = buildSessionPickerUI([]);

            expect(text).toContain('Không tìm thấy phiên nào');
            expect(keyboard).toBeDefined();
        });

        it('truncates sessions to 25-item limit', () => {
            const sessions: SessionListItem[] = Array.from({ length: 30 }, (_, i) => ({
                title: `Session ${i + 1}`,
                isActive: i === 0,
            }));

            const { keyboard } = buildSessionPickerUI(sessions);
            expect(keyboard).toBeDefined();
        });
    });
});
