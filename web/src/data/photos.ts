import { ApiError } from './api';

/** Reduce la imagen (máx. 900 px, WebP) para que pese poco y no se suban fotos gigantes. */
export async function downscale(file: File, max = 900, quality = 0.82): Promise<File> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new ApiError('Usá una imagen PNG, JPG o WebP.');
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  const blob: Blob = await new Promise((r, j) => c.toBlob((b) => (b ? r(b) : j(new ApiError('No se pudo procesar la imagen'))), 'image/webp', quality));
  return new File([blob], 'foto.webp', { type: 'image/webp' });
}
