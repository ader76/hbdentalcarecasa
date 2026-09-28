// Limites partagées entre le téléphone et le serveur.
export const MAX_PAGES_PER_DOCUMENT = 50;
/** Taille maximale d'une page après compression (octets). */
export const MAX_PAGE_BYTES = 8 * 1024 * 1024;
/** Taille maximale acceptée pour la photo brute prise par l'appareil. */
export const MAX_CAPTURE_BYTES = 40 * 1024 * 1024;
/** Plus grand côté de l'image conservée : ~200 dpi sur une feuille A4, lisible pour l'écriture manuscrite. */
export const PAGE_MAX_EDGE = 2400;
export const PAGE_JPEG_QUALITY = 0.85;
export const THUMB_MAX_EDGE = 360;
export const MIN_PAGE_EDGE = 300;
/** Au-delà, refusé avant décodage (le téléphone envoie au plus PAGE_MAX_EDGE). */
export const MAX_PAGE_EDGE = 4000;
export const NOTE_MAX_LENGTH = 500;
export const STORAGE_BUCKET = "fiches";
export const SIGNED_URL_TTL_SECONDS = 300;
