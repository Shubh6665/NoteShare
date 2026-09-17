/**
 * Room ID utilities — cryptographically random, hard-to-guess codes.
 * Format: "XXXX-XXXX" where X = alphanumeric (excluding confusing chars)
 * 32^8 = ~1.1 trillion possible combinations.
 */

// No I, O, 0, 1 — avoid visual confusion
const CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Generate a cryptographically random room ID.
 * Example: "K7XD-N4PR"
 */
export function generateRoomId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);

  let id = '';
  for (let i = 0; i < 8; i++) {
    id += CHARSET[bytes[i] % CHARSET.length];
    if (i === 3) id += '-';
  }
  return id;
}

/**
 * Validate a room ID — alphanumeric + hyphens/underscores, 1-20 chars
 */
export function isValidRoomId(id: string): boolean {
  return /^[A-Za-z0-9\-_]{1,20}$/.test(id);
}

/**
 * Get room from URL params, or generate a new one
 */
export function getRoomFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const room = params.get('room');
  if (room && isValidRoomId(room)) return room;
  return generateRoomId();
}
