// ALL VGen DOM/URL knowledge lives here; calibration adjusts ONLY this file.
export const VGEN_BASE_URL = 'https://vgen.co';
export const VGEN_DASHBOARD_URL = 'https://vgen.co/creator'; // matches browser/src/session.ts constant
export const VGEN_INBOX_URL = 'https://vgen.co/creator';
export const VGEN_LOGIN_PATH_HINT = '/login';
export const AUTH_MARKER_SELECTOR = '[data-testid="user-avatar"], img[alt="Account"], svg.chatIcon';
export const INBOX_THREAD_ITEM_SELECTOR = '[data-testid="conversation-item"], [data-testid="inbox-thread-item"], [class*="ChatChannelListPreview__Container"]';
export const THREAD_URL_PATTERN = /vgen\.co\/(?:inbox|messages)\/(?<threadId>[A-Za-z0-9_-]+)/i;
export const THREAD_MESSAGE_SELECTOR = '[data-testid="thread-message"], .str-chat__message';
export const MESSAGE_SENDER_SELECTOR = '[data-testid="message-sender"]';
export const MESSAGE_BODY_SELECTOR = '[data-testid="message-body"]';
export const MESSAGE_TIME_SELECTOR = 'time';
export const OUTBOUND_MARKER = 'data-outbound'; // attribute on outbound message blocks
export const MESSAGE_INPUT_SELECTOR = '[data-testid="message-input"], textarea[placeholder*="message" i], .str-chat__textarea textarea';
export const SEND_BUTTON_SELECTOR = '[data-testid="send-button"], button[type="submit"], button:has-text("Send")';
export const CREATOR_PROFILE_MARKER = '[data-testid="user-username"], [data-testid="user-avatar"] [alt], a[href*="/creator"]';
