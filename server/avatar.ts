// Avatars are small inline thumbnails, never external URLs or SVG/HTML content.
export function validAvatar(value: string): boolean {
  if (value === '') return true;
  if (value.length > 48 * 1024) return false;
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  try {
    const bytes = atob(match[2]);
    if (match[1] === 'jpeg')
      return bytes.length > 4 && bytes.startsWith('\xff\xd8\xff') && bytes.endsWith('\xff\xd9');
    return bytes.length > 24 && bytes.startsWith('\x89PNG\r\n\x1a\n') && bytes.slice(12, 16) === 'IHDR';
  } catch {
    return false;
  }
}
