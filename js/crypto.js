// ==========================================
// CHATSPHERE - END-TO-END ENCRYPTION (Web Crypto API)
// Depends on: nothing (browser APIs only). Load before script.js.
//
// Model
//   - Each browser creates an ECDH P-256 identity key pair. The private key is
//     non-extractable and stored in IndexedDB on this browser only. The public key
//     (JWK) is published in profiles.public_key.
//   - Each conversation has an AES-256-GCM conversation key per version.
//   - The conversation key is wrapped (encrypted) separately for every member, using an
//     ECDH shared secret between the wrapper and the member. The server only stores the
//     wrapped copies, so it cannot read messages.
//   - Messages and files are encrypted with the conversation key before they leave the browser.
// ==========================================


const CHAT_KEY_DB_NAME = "chatsphere-e2ee";
const CHAT_KEY_DB_STORE = "keys";

const CHAT_TEXT_ENCODER = new TextEncoder();
const CHAT_TEXT_DECODER = new TextDecoder();


// 1. BYTE HELPERS

function bytesToBase64(bytes) {

    let binary = "";
    const step = 0x8000;

    for (let i = 0; i < bytes.length; i += step) {
        binary += String.fromCharCode(...bytes.subarray(i, i + step));
    }

    return btoa(binary);

}

function base64ToBytes(base64) {

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;

}

function joinBytes(first, second) {

    const joined = new Uint8Array(first.length + second.length);

    joined.set(first, 0);
    joined.set(second, first.length);

    return joined;

}

// Only the public part of a JWK is stored or shared.
function publicJwkFrom(jwk) {
    return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
}

function samePublicKey(a, b) {
    return Boolean(a && b && a.x === b.x && a.y === b.y);
}

// Binds a wrapped key to one conversation and one version.
function conversationKeyAad(conversationId, keyVersion) {
    return `${conversationId}|${keyVersion}`;
}


// 2. IDENTITY KEYS (per browser, stored in IndexedDB)

async function generateIdentityKeyPair() {

    const pair = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        false,
        ["deriveKey"]
    );

    const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);

    return {
        privateKey: pair.privateKey,
        publicJwk: publicJwkFrom(jwk)
    };

}

function openChatKeyDatabase() {

    return new Promise((resolve, reject) => {

        const request = indexedDB.open(CHAT_KEY_DB_NAME, 1);

        request.onupgradeneeded = () => {
            request.result.createObjectStore(CHAT_KEY_DB_STORE);
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);

    });

}

// Runs one IndexedDB request in its own transaction and returns its result.
async function chatKeyDbRun(mode, operation) {

    const db = await openChatKeyDatabase();

    try {

        return await new Promise((resolve, reject) => {

            const transaction = db.transaction(CHAT_KEY_DB_STORE, mode);
            const request = operation(transaction.objectStore(CHAT_KEY_DB_STORE));

            transaction.oncomplete = () => resolve(request.result);
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);

        });

    }
    finally {

        db.close();

    }

}

function identityRecordKey(userId) {
    return `identity:${userId}`;
}

async function readLocalIdentity(userId) {

    const record = await chatKeyDbRun("readonly", (store) => store.get(identityRecordKey(userId)));

    return record ?? null;

}

async function createLocalIdentity(userId) {

    const identity = await generateIdentityKeyPair();

    await chatKeyDbRun("readwrite", (store) => store.put(identity, identityRecordKey(userId)));

    return identity;

}


// 3. CONVERSATION KEYS

// Extractable, so it can be wrapped for other members. It never leaves this browser unwrapped.
async function createConversationKey() {

    return crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );

}

// ECDH shared secret between my private key and a peer's public JWK.
async function deriveWrappingKey(privateKey, peerPublicJwk) {

    const peerKey = await crypto.subtle.importKey(
        "jwk",
        { kty: "EC", crv: "P-256", x: peerPublicJwk.x, y: peerPublicJwk.y, ext: true },
        { name: "ECDH", namedCurve: "P-256" },
        false,
        []
    );

    return crypto.subtle.deriveKey(
        { name: "ECDH", public: peerKey },
        privateKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );

}

// Encrypts a conversation key for one recipient. Returns the values stored in conversation_keys.
async function wrapConversationKey(conversationKey, myIdentity, recipientPublicJwk, aad) {

    const wrappingKey = await deriveWrappingKey(myIdentity.privateKey, recipientPublicJwk);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", conversationKey));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const cipher = new Uint8Array(await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: CHAT_TEXT_ENCODER.encode(aad) },
        wrappingKey,
        raw
    ));

    return {
        wrappedKey: bytesToBase64(joinBytes(iv, cipher)),
        wrapperPublicKey: publicJwkFrom(myIdentity.publicJwk),
        recipientPublicKey: publicJwkFrom(recipientPublicJwk)
    };

}

// Reverses wrapConversationKey. Returns an extractable AES key.
async function unwrapConversationKey(wrappedKeyBase64, wrapperPublicJwk, myIdentity, aad) {

    const packed = base64ToBytes(wrappedKeyBase64);
    const iv = packed.slice(0, 12);
    const cipher = packed.slice(12);

    const wrappingKey = await deriveWrappingKey(myIdentity.privateKey, wrapperPublicJwk);

    const raw = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv, additionalData: CHAT_TEXT_ENCODER.encode(aad) },
        wrappingKey,
        cipher
    );

    return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);

}


// 4. DATA ENCRYPTION (messages and files)

async function encryptBytes(key, bytes) {

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));

    return joinBytes(iv, cipher);

}

async function decryptBytes(key, packed) {

    const iv = packed.slice(0, 12);

    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, packed.slice(12)));

}

async function encryptText(key, text) {
    return bytesToBase64(await encryptBytes(key, CHAT_TEXT_ENCODER.encode(text)));
}

async function decryptText(key, base64) {
    return CHAT_TEXT_DECODER.decode(await decryptBytes(key, base64ToBytes(base64)));
}


// 5. MESSAGE PAYLOAD
// The encrypted body is JSON: { t: text, f: file metadata or null }.
// File names and types are encrypted too, so the server never sees them.

function packMessageBody(text, file) {
    return JSON.stringify({ t: text ?? "", f: file ?? null });
}

function parseMessageBody(json) {

    const data = JSON.parse(json);

    return {
        text: typeof data.t === "string" ? data.t : "",
        file: data.f && typeof data.f === "object" ? data.f : null
    };

}
