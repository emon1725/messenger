// ==========================================
// CHATSPHERE - FILE COMPRESSION BEFORE UPLOAD
// Depends on: nothing (browser APIs only). Load before script.js.
//
// Rules
//   - Photos (JPEG, PNG, WEBP, BMP) are resized to at most 1600 px and re-encoded as WEBP
//     (quality 0.8). The WEBP is used only when it is smaller than the original.
//   - Other files are gzip-compressed with CompressionStream. Gzip is used only when smaller.
//   - Videos, audio, archives and GIFs are sent as they are. Re-encoding video in the browser
//     is slow and lossy, so it is not done here.
//   - Compression happens BEFORE encryption, because encrypted data does not compress.
// ==========================================


const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;
const MAX_IMAGE_SIDE = 1600;
const WEBP_QUALITY = 0.8;
const RECOMPRESS_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/bmp"];


function formatBytes(bytes) {

    if (typeof bytes !== "number" || Number.isNaN(bytes)) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

}

function canUseGzipStreams() {
    return typeof CompressionStream === "function" && typeof DecompressionStream === "function";
}

async function compressImageToWebp(file) {

    const bitmap = await createImageBitmap(file);

    try {

        const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");

        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));

        canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);

        return await new Promise((resolve, reject) => {

            canvas.toBlob(
                (blob) => {
                    // Some browsers cannot encode WEBP and silently return PNG.
                    if (blob && blob.type === "image/webp") resolve(blob);
                    else reject(new Error("WEBP encoding is not supported in this browser."));
                },
                "image/webp",
                WEBP_QUALITY
            );

        });

    }
    finally {

        bitmap.close();

    }

}

async function gzipBlob(blob) {

    const stream = blob.stream().pipeThrough(new CompressionStream("gzip"));

    return new Response(stream).blob();

}

async function gunzipBytes(bytes) {

    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));

    return new Uint8Array(await new Response(stream).arrayBuffer());

}

// Returns what will be encrypted and uploaded, plus the metadata the recipient needs.
async function prepareUpload(file) {

    if (file.size > MAX_UPLOAD_BYTES) {
        throw new Error(`Files must be ${formatBytes(MAX_UPLOAD_BYTES)} or smaller.`);
    }

    let blob = file;
    let mime = file.type || "application/octet-stream";
    let encoding = "none";
    let name = file.name || "file";

    if (RECOMPRESS_IMAGE_TYPES.includes(file.type)) {

        try {

            const webp = await compressImageToWebp(file);

            if (webp.size < file.size) {
                blob = webp;
                mime = "image/webp";
                name = name.replace(/\.[^.]*$/, "") + ".webp";
            }

        }
        catch (error) {

            console.warn("Image compression skipped:", error.message);

        }

    }

    if (blob === file && canUseGzipStreams()) {

        const gzipped = await gzipBlob(file);

        if (gzipped.size < file.size) {
            blob = gzipped;
            encoding = "gzip";
        }

    }

    return {
        blob,
        mime,
        encoding,
        name,
        originalSize: file.size
    };

}
