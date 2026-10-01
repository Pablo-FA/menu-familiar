/** Lado largo máximo y calidad de la portada. */
export const PHOTO_MAX_SIDE = 1600;
export const PHOTO_QUALITY = 0.82;
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

export class PhotoError extends Error {}

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  // createImageBitmap aplica la orientación EXIF (las fotos del iPhone vienen giradas).
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Se intenta con <img> (algunos formatos solo los decodifica el elemento img).
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new PhotoError("No se ha podido leer la imagen");
  }
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
}

/** Redimensiona a 1600 px en el lado largo y convierte a JPEG (calidad 0,82). */
export async function preparePhoto(file: File): Promise<Blob> {
  const image = await decode(file);
  try {
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d");
    if (!g) throw new PhotoError("No se ha podido procesar la imagen");
    g.drawImage(image.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", PHOTO_QUALITY));
    if (!blob) throw new PhotoError("No se ha podido convertir la imagen");
    if (blob.size > PHOTO_MAX_BYTES) throw new PhotoError("La foto pesa más de 10 MB incluso reducida");
    return blob;
  } finally {
    image.close();
  }
}

/** Color medio de una imagen (para el halo del modo cocina), o null si no se puede leer. */
export async function averageColor(url: string): Promise<[number, number, number] | null> {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    const g = canvas.getContext("2d", { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(img, 0, 0, 8, 8);
    const data = g.getImageData(0, 0, 8, 8).data;
    let r = 0;
    let gr = 0;
    let b = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i] ?? 0;
      gr += data[i + 1] ?? 0;
      b += data[i + 2] ?? 0;
    }
    const n = data.length / 4;
    return [Math.round(r / n), Math.round(gr / n), Math.round(b / n)];
  } catch {
    return null;
  }
}
