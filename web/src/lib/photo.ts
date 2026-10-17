/**
 * Photo de profil préparée dans le navigateur : recadrage carré au centre, 400 × 400, JPEG.
 * Le nouvel encodage retire aussi les métadonnées (position GPS, appareil) de la photo d'origine.
 */
export const PHOTO_SIZE = 400;

export async function squarePhoto(file: File, size = PHOTO_SIZE): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Choisissez une image (JPG, PNG…).');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Image illisible : essayez une autre photo (JPG ou PNG).'));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Photo impossible à préparer sur cet appareil.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Photo impossible à préparer.'))), 'image/jpeg', 0.85));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Photo jointe (réclamation…) : côté le plus long réduit à `max` px, proportions gardées, JPEG sans métadonnées. */
export async function resizedPhoto(file: File, max = 1280): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Choisissez une image (JPG, PNG…).');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Image illisible : essayez une autre photo (JPG ou PNG).'));
      i.src = url;
    });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * k);
    canvas.height = Math.round(img.naturalHeight * k);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Photo impossible à préparer sur cet appareil.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Photo impossible à préparer.'))), 'image/jpeg', 0.82));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Photo d'album : grande (1600 px au plus, proportions gardées) et vignette carrée 400 px, JPEG sans métadonnées.
 */
export async function albumPhoto(file: File): Promise<{ full: Blob; thumb: Blob; width: number; height: number }> {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} : ce n’est pas une image.`);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(`${file.name} : image illisible.`));
      i.src = url;
    });
    const draw = (w: number, h: number, sx: number, sy: number, sw: number, sh: number, quality: number) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('Photo impossible à préparer sur cet appareil.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
      return new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Photo impossible à préparer.'))), 'image/jpeg', quality));
    };
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    const k = Math.min(1, 1600 / Math.max(W, H));
    const width = Math.round(W * k);
    const height = Math.round(H * k);
    const side = Math.min(W, H);
    const [full, thumb] = await Promise.all([draw(width, height, 0, 0, W, H, 0.82), draw(400, 400, (W - side) / 2, (H - side) / 2, side, side, 0.78)]);
    return { full, thumb, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
