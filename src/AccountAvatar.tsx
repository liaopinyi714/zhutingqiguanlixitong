import { UserRound } from 'lucide-react';

export function AccountAvatar({ avatar, name, className = 'account-avatar' }: {
  avatar?: string; name?: string; className?: string;
}) {
  return <span className={className}>
    {avatar ? <img src={avatar} alt="" /> : name ? name.slice(0, 1) : <UserRound size={18} />}
  </span>;
}

export async function avatarThumbnail(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('请选择 JPG、PNG 或 WebP 图片');
  if (file.size > 5 * 1024 * 1024) throw new Error('请选择小于 5 MB 的图片');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 96;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器无法处理图片，请更换浏览器后重试');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 96, 96);
    const size = Math.min(image.naturalWidth, image.naturalHeight);
    if (!size) throw new Error('图片无法读取');
    ctx.drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2,
      size, size, 0, 0, 96, 96);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch (error) {
    if (error instanceof Error && error.name === 'EncodingError') throw new Error('图片无法读取，请选择其他图片');
    throw error;
  } finally {
    URL.revokeObjectURL(url);
  }
}
