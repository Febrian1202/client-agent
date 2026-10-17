// ALL VGen DOM/URL knowledge lives here; calibration adjusts ONLY this file.
// Values are provisional guesses; Task 6 calibrates them against the real DOM.
export const VGEN_BASE_URL = 'https://vgen.co';
export const VGEN_DASHBOARD_URL = 'https://vgen.co/dashboard'; // matches browser/src/session.ts constant
export const VGEN_INBOX_URL = 'https://vgen.co/inbox';
export const VGEN_LOGIN_PATH_HINT = '/login';
export const AUTH_MARKER_SELECTOR = '[data-testid="user-avatar"], img[alt="Account"]';
export const INBOX_THREAD_ITEM_SELECTOR = '[data-testid="conversation-item"]';
export const THREAD_URL_PATTERN = /(?:vgen\.co\/)?(?:inbox|messages)\/(?<threadId>[A-Za-z0-9_-]+)/i;
export const THREAD_MESSAGE_SELECTOR = '[data-testid="thread-message"]';
export const MESSAGE_SENDER_SELECTOR = '[data-testid="message-sender"]';
export const MESSAGE_BODY_SELECTOR = '[data-testid="message-body"]';
export const MESSAGE_TIME_SELECTOR = 'time';
export const OUTBOUND_MARKER = 'data-outbound'; // attribute on outbound message blocks
