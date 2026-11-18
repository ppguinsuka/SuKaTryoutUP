/** Membuat hash biner SHA-256 yang diharapkan untuk request SEB. */
export declare function buatHashRequestSeb(url: string, bekHex: string): Buffer;
/** Memverifikasi RequestHash dengan perbandingan constant time. */
export declare function cocokHashRequestSeb(url: string, bekHex: string, receivedHex: string): boolean;
