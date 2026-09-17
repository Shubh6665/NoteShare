/**
 * Room ID utilities — generates human-readable, easy-to-type room codes.
 */

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // No I, O (avoid confusion with 1, 0)

/**
 * Generate a room ID like "KXDF-42"
 */
export function generateRoomId(): string {
  let id = '';
  for (let i = 0; i < 4; i++) {
    id += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  const num = Math.floor(Math.random() * 90) + 10; // 10-99
  return `${id}-${num}`;
}

/**
 * Validate a room ID — alphanumeric + hyphens, max 20 chars
 */
export function isValidRoomId(id: string): boolean {
  return /^[A-Za-z0-9\-_]{1,20}$/.test(id);
}

/**
 * Extract room ID from URL search params, or generate a new one
 */
export function getRoomFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const room = params.get('room');
  if (room && isValidRoomId(room)) return room;
  return generateRoomId();
}
