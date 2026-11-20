// ==========================================
// CHATSPHERE - MAIN DASHBOARD (Supabase, end-to-end encrypted)
// Depends on: js/supabase.js, js/crypto.js, js/media.js, js/emoji.js, js/calls.js
// ==========================================


// 1. DOM ELEMENTS

const sidebarName = document.getElementById("sidebarName");
const headerName = document.getElementById("headerName");
const sidebarAvatar = document.getElementById("sidebarAvatar");
const headerAvatar = document.getElementById("headerAvatar");

const logoutBtn = document.getElementById("logoutBtn");
const profileMenuBtn = document.getElementById("profileMenuBtn");
const headerProfileBtn = document.getElementById("headerProfileBtn");
const newChatBtn = document.getElementById("newChatBtn");
const newGroupBtn = document.getElementById("newGroupBtn");
const startChatBtn = document.getElementById("startChatBtn");

const navItems = document.querySelectorAll(".nav-item");
const navUnreadCount = document.getElementById("navUnreadCount");
const sectionHeading = document.getElementById("sectionHeading");
const sectionSubtitle = document.getElementById("sectionSubtitle");
const listTitle = document.getElementById("listTitle");

const chatList = document.getElementById("chatList");
const searchChats = document.getElementById("searchChats");

const welcomePanel = document.getElementById("welcomePanel");
const chatWindow = document.getElementById("chatWindow");
const otherSection = document.getElementById("otherSection");
const otherSectionTitle = document.getElementById("otherSectionTitle");
const otherSectionDescription = document.getElementById("otherSectionDescription");
const otherSectionIcon = document.getElementById("otherSectionIcon");

const conversationName = document.getElementById("conversationName");
const conversationAvatar = document.getElementById("conversationAvatar");
const conversationStatus = document.getElementById("conversationStatus");
const voiceCallBtn = document.getElementById("voiceCallBtn");
const videoCallBtn = document.getElementById("videoCallBtn");
const moreChatBtn = document.getElementById("moreChatBtn");
const messagesArea = document.getElementById("messagesArea");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const emojiBtn = document.getElementById("emojiBtn");
const emojiPanel = document.getElementById("emojiPanel");
const attachmentBtn = document.getElementById("attachmentBtn");
const fileInput = document.getElementById("fileInput");
const uploadStatus = document.getElementById("uploadStatus");

const groupModal = document.getElementById("groupModal");
const groupModalTitle = document.getElementById("groupModalTitle");
const groupNameLabel = document.getElementById("groupNameLabel");
const groupName = document.getElementById("groupName");
const groupSearch = document.getElementById("groupSearch");
const groupChips = document.getElementById("groupChips");
const groupResults = document.getElementById("groupResults");
const groupMessage = document.getElementById("groupMessage");
const cancelGroupBtn = document.getElementById("cancelGroupBtn");
const saveGroupBtn = document.getElementById("saveGroupBtn");

const groupInfoModal = document.getElementById("groupInfoModal");
const groupInfoTitle = document.getElementById("groupInfoTitle");
const groupInfoMeta = document.getElementById("groupInfoMeta");
const memberList = document.getElementById("memberList");
const addMembersBtn = document.getElementById("addMembersBtn");
const leaveGroupBtn = document.getElementById("leaveGroupBtn");
const closeGroupInfoBtn = document.getElementById("closeGroupInfoBtn");
const groupInfoMessage = document.getElementById("groupInfoMessage");

const incomingCall = document.getElementById("incomingCall");
const incomingAvatar = document.getElementById("incomingAvatar");
const incomingName = document.getElementById("incomingName");
const incomingKind = document.getElementById("incomingKind");
const acceptCallBtn = document.getElementById("acceptCallBtn");
const declineCallBtn = document.getElementById("declineCallBtn");

const callScreen = document.getElementById("callScreen");
const remoteVideo = document.getElementById("remoteVideo");
const localVideo = document.getElementById("localVideo");
const callAvatar = document.getElementById("callAvatar");
const callName = document.getElementById("callName");
const callStatusText = document.getElementById("callStatusText");
const muteCallBtn = document.getElementById("muteCallBtn");
const cameraCallBtn = document.getElementById("cameraCallBtn");
const hangUpBtn = document.getElementById("hangUpBtn");

const toast = document.getElementById("toast");

const themeBtn = document.getElementById("themeBtn");


// 2. CONSTANTS AND STATE

const MESSAGE_COLUMNS =
    "id, conversation_id, sender_id, body, is_encrypted, key_version, kind, attachment_path, deleted_at, created_at";

const sectionData = {

    messages: {
        title: "Messages",
        subtitle: "Stay connected with your people.",
        icon: "fa-comments",
        description: "Select a conversation to start chatting."
    },

    contacts: {
        title: "Contacts",
        subtitle: "Connect with your friends.",
        icon: "fa-users",
        description: "Your contacts will appear here."
    },

    groups: {
        title: "Groups",
        subtitle: "Stay connected with your communities.",
        icon: "fa-user-group",
        description: "Your group conversations appear in the list."
    },

    calls: {
        title: "Calls",
        subtitle: "Stay connected through calls.",
        icon: "fa-phone",
        description: "Start a voice or video call from any direct chat."
    },

    settings: {
        title: "Settings",
        subtitle: "Manage your ChatSphere experience.",
        icon: "fa-gear",
        description: "Account and application settings will appear here."
    }

};

let currentUser = null;           // { id, name, email, profile_image, public_key, google_photo }
let myIdentity = null;            // { privateKey, publicJwk } for this browser
let conversations = [];           // rows from get_my_conversations()
let previewById = new Map();      // conversation id -> decrypted preview text
let activeConversation = null;    // the conversation row that is open
let activeMembers = [];           // members of the open conversation
let messageCache = new Map();     // message id -> row, for the open conversation
let viewCache = new Map();        // message id -> decoded view (text, file, deleted, locked)
let keyCache = new Map();         // "<conversation>:<version>" -> AES key
let attachmentUrls = new Map();   // message id -> object URL for image previews
let onlineIds = new Set();        // user ids currently online (presence)
let openRequestId = 0;
let peopleMode = false;
let peopleRequestId = 0;
let peopleTimer = null;
let refreshTimer = null;
let listFilter = "all";           // "all" or "groups"
let groupSearchTimer = null;
let groupDraft = null;            // { mode: "create" | "add", conversation, selected: Map, exclude: Set }
let groupInfoConversation = null;
let groupInfoMemberIds = [];      // member ids of the group shown in the info dialog
let conversationsLoaded = false;
let callManager = null;
let callClock = null;
let callStartedAt = 0;
let pendingIncoming = null;       // { row, name, avatar } while the incoming call is shown
let toastTimer = null;
let presenceChannel = null;


// 3. PROFILE AND ENCRYPTION IDENTITY

async function loadCurrentProfile(authUser) {

    const { data, error } = await supabaseClient
        .from("profiles")
        .select("id, name, profile_image, public_key")
        .eq("id", authUser.id)
        .maybeSingle();

    if (error) {
        console.error("Profile load error:", error.message);
    }

    const metadata = authUser.user_metadata ?? {};
    const fallbackName = metadata.name || metadata.full_name || (authUser.email ?? "user").split("@")[0];

    return {
        id: authUser.id,
        email: authUser.email ?? "",
        name: data?.name || fallbackName,
        profile_image: data?.profile_image || null,
        public_key: data?.public_key ?? null,
        google_photo: metadata.avatar_url || metadata.picture || null
    };

}

function renderSidebarProfile() {

    const avatar = avatarFor(currentUser.name, currentUser.profile_image);

    sidebarName.textContent = currentUser.name;
    headerName.textContent = currentUser.name;

    sidebarAvatar.src = avatar;
    headerAvatar.src = avatar;

}

// Each browser has its own key pair. If this browser has no key, or the published key is
// from another browser, a new key is created and published. The browser that signs in last takes over.
async function ensureIdentity(profile) {

    const local = await readLocalIdentity(profile.id);

    if (local && profile.public_key && samePublicKey(local.publicJwk, profile.public_key)) {
        return local;
    }

    const created = await createLocalIdentity(profile.id);

    const { error } = await supabaseClient
        .from("profiles")
        .update({ public_key: created.publicJwk })
        .eq("id", profile.id);

    if (error) throw error;

    return created;

}

async function touchLastSeen() {

    const { error } = await supabaseClient.rpc("touch_last_seen");

    if (error) console.warn("Last seen update failed:", error.message);

}

// Presence shows who has a ChatSphere tab open right now (the "Active now" status).
// last_seen_at is updated every minute as a fallback for "Last seen ..." text.
function startPresence() {

    presenceChannel = supabaseClient.channel("online-users", {
        config: { presence: { key: currentUser.id } }
    });

    presenceChannel
        .on("presence", { event: "sync" }, () => {

            onlineIds = new Set(Object.keys(presenceChannel.presenceState()));

            renderConversationList();
            updateConversationHeader();

        })
        .subscribe(async (status) => {

            if (status === "SUBSCRIBED") {
                await presenceChannel.track({ online_at: new Date().toISOString() });
            }

        });

    touchLastSeen();
    setInterval(touchLastSeen, 60000);

}

function describePresence(person) {

    if (onlineIds.has(person.id)) return "Active now";
    if (!person.last_seen_at) return "Offline";

    const date = new Date(person.last_seen_at);
    const minutes = Math.round((Date.now() - date.getTime()) / 60000);

    if (minutes < 1) return "Last seen just now";
    if (minutes < 60) return `Last seen ${minutes} min ago`;

    const hours = Math.round(minutes / 60);

    if (hours < 24) return `Last seen ${hours} h ago`;

    return `Last seen ${date.toLocaleDateString([], { day: "numeric", month: "short" })}`;

}


// 4. KEYS: CONVERSATION KEY VERSIONS

function keyCacheId(conversationId, version) {
    return `${conversationId}:${version}`;
}

async function fetchLatestKeyVersion(conversationId) {

    const { data, error } = await supabaseClient.rpc("get_conversation_key_version", {
        p_conversation: conversationId
    });

    if (error) throw error;

    return Number(data ?? 0);

}

// Returns this browser's copy of a key version, or null if this user has no copy.
async function getConversationKey(conversationId, version) {

    if (!version || !myIdentity) return null;

    const cacheId = keyCacheId(conversationId, version);

    if (keyCache.has(cacheId)) return keyCache.get(cacheId);

    const { data, error } = await supabaseClient
        .from("conversation_keys")
        .select("wrapped_key, wrapper_public_key")
        .eq("conversation_id", conversationId)
        .eq("key_version", version)
        .eq("user_id", currentUser.id)
        .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    const key = await unwrapConversationKey(
        data.wrapped_key,
        data.wrapper_public_key,
        myIdentity,
        conversationKeyAad(conversationId, version)
    );

    keyCache.set(cacheId, key);

    return key;

}

async function fetchMembers(conversationId) {

    const { data, error } = await supabaseClient
        .from("conversation_members")
        .select("role, profiles(id, name, profile_image, public_key, last_seen_at)")
        .eq("conversation_id", conversationId);

    if (error) throw error;

    return (data ?? [])
        .filter((row) => row.profiles)
        .map((row) => ({
            id: row.profiles.id,
            name: row.profiles.name,
            profile_image: row.profiles.profile_image,
            public_key: row.profiles.public_key,
            last_seen_at: row.profiles.last_seen_at,
            role: row.role
        }))
        .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "admin" ? -1 : 1));

}

async function fetchPeopleByIds(ids) {

    const { data, error } = await supabaseClient
        .from("profiles")
        .select("id, name, profile_image, public_key")
        .in("id", ids);

    if (error) throw error;

    return data ?? [];

}

function assertRecipientsHaveKeys(recipients) {

    const missing = recipients.filter((person) => !person.public_key);

    if (missing.length > 0) {
        throw new Error(
            `${missing.map((person) => person.name).join(", ")} must open ChatSphere once after the update before they can receive encrypted messages.`
        );
    }

}

// Creates a new key version and wraps it for each recipient.
async function publishKeyVersion(conversationId, version, recipients) {

    assertRecipientsHaveKeys(recipients);

    const key = await createConversationKey();
    const aad = conversationKeyAad(conversationId, version);
    const rows = [];

    for (const person of recipients) {

        const wrap = await wrapConversationKey(key, myIdentity, person.public_key, aad);

        rows.push({
            conversation_id: conversationId,
            user_id: person.id,
            key_version: version,
            wrapped_key: wrap.wrappedKey,
            wrapper_public_key: wrap.wrapperPublicKey,
            recipient_public_key: wrap.recipientPublicKey,
            wrapped_by: currentUser.id
        });

    }

    const { error } = await supabaseClient.from("conversation_keys").insert(rows);

    if (error) throw error;

    keyCache.set(keyCacheId(conversationId, version), key);

    return key;

}

// Used before sending: the first message in a chat creates version 1.
async function ensureConversationKey(conversationId) {

    const latest = await fetchLatestKeyVersion(conversationId);

    if (latest > 0) return latest;

    const members = await fetchMembers(conversationId);

    try {
        await publishKeyVersion(conversationId, 1, members);
        return 1;
    }
    catch (error) {

        // Both sides may have created version 1 at the same moment. Use the one that won.
        if (error.code !== "23505") throw error;

        const retry = await fetchLatestKeyVersion(conversationId);

        if (retry > 0) return retry;

        throw error;

    }

}

// Used when members are added or removed. The new key is never shared with removed members.
async function rotateConversationKey(conversationId, recipients) {

    const latest = await fetchLatestKeyVersion(conversationId);

    try {
        await publishKeyVersion(conversationId, latest + 1, recipients);
    }
    catch (error) {

        if (error.code !== "23505") throw error;

        const newest = await fetchLatestKeyVersion(conversationId);

        await publishKeyVersion(conversationId, newest + 1, recipients);

    }

}

// Re-shares key copies with members whose key changed (a new browser).
// Runs when a member who holds the key opens the chat.
async function healStaleKeys(conversationId, members) {

    const { data: stale, error } = await supabaseClient.rpc("get_stale_key_rows", {
        p_conversation: conversationId
    });

    if (error) {
        console.warn("Key check failed:", error.message);
        return;
    }

    if (!stale || stale.length === 0) return;

    const byId = new Map(members.map((person) => [person.id, person]));

    for (const row of stale) {

        const target = byId.get(row.user_id);

        if (!target?.public_key || row.user_id === currentUser.id) continue;

        const key = await getConversationKey(conversationId, row.key_version).catch(() => null);

        if (!key) continue;

        const wrap = await wrapConversationKey(
            key,
            myIdentity,
            target.public_key,
            conversationKeyAad(conversationId, row.key_version)
        );

        const { error: rewrapError } = await supabaseClient.rpc("rewrap_key", {
            p_conversation: conversationId,
            p_user: row.user_id,
            p_version: row.key_version,
            p_wrapped_key: wrap.wrappedKey,
            p_wrapper_public_key: wrap.wrapperPublicKey,
            p_recipient_public_key: target.public_key
        });

        if (rewrapError) console.warn("Key re-share skipped:", rewrapError.message);

    }

}

// Everything needed to send: the latest version and this browser's copy of it.
async function conversationCryptoContext(conversationId) {

    if (!myIdentity) {
        throw new Error("Encryption is not available in this browser.");
    }

    const version = await ensureConversationKey(conversationId);
    const key = await getConversationKey(conversationId, version);

    if (!key) {
        throw new Error("This browser does not have the chat key yet. Ask a member to open this chat.");
    }

    return { version, key };

}


// 5. DECODING MESSAGES AND PREVIEWS

async function decodeMessageRow(row) {

    if (row.deleted_at) return { deleted: true };

    // Messages sent before encryption was added (v1) are stored as plain text.
    if (!row.is_encrypted) return { text: row.body ?? "", file: null };

    try {

        const key = await getConversationKey(row.conversation_id, row.key_version);

        if (!key) return { locked: true };

        const payload = parseMessageBody(await decryptText(key, row.body));

        return { text: payload.text, file: payload.file };

    }
    catch (error) {

        return { locked: true };

    }

}

async function previewFor(conv) {

    if (conv.last_deleted) return "Message unsent";
    if (!conv.last_body) return "No messages yet";

    if (!conv.last_is_encrypted) return conv.last_body;

    const cacheId = `${conv.conversation_id}|${conv.last_message_at}`;

    if (previewById.has(cacheId)) return previewById.get(cacheId);

    // Only successful reads are cached, so a preview becomes readable once the key arrives.
    const key = await getConversationKey(conv.conversation_id, conv.last_key_version);

    if (!key) return "Encrypted message";

    const payload = parseMessageBody(await decryptText(key, conv.last_body));
    const text = payload.file
        ? (payload.text ? `📎 ${payload.text}` : "📎 File")
        : payload.text;

    previewById.set(cacheId, text);

    return text;

}


// 6. CONVERSATION LIST

async function refreshConversations() {

    const { data, error } = await supabaseClient.rpc("get_my_conversations");

    if (error) {
        console.error("Conversation load error:", error.message);
        return;
    }

    conversations = data ?? [];
    conversationsLoaded = true;

    const previews = await Promise.all(
        conversations.map((conv) => previewFor(conv).catch(() => "Encrypted message"))
    );

    conversations.forEach((conv, index) => {
        previewById.set(conv.conversation_id, previews[index]);
    });

    renderConversationList();
    updateUnreadBadge();
    updateConversationHeader();

}

// Several realtime events can arrive together; this merges them into one reload.
function scheduleRefresh() {

    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshConversations, 300);

}

function updateUnreadBadge() {

    const total = conversations.reduce(
        (sum, conv) => sum + Number(conv.unread_count || 0),
        0
    );

    navUnreadCount.textContent = total;
    navUnreadCount.hidden = total === 0;

}

function visibleConversations() {

    const term = searchChats.value.trim().toLowerCase();

    return conversations.filter((conv) => {

        if (listFilter === "groups" && !conv.is_group) return false;

        return !term || conv.display_name.toLowerCase().includes(term);

    });

}

function renderConversationList() {

    if (peopleMode || !conversationsLoaded) return;

    const visible = visibleConversations();

    chatList.replaceChildren();

    if (visible.length === 0) {

        chatList.append(
            el(
                "p",
                "list-note",
                conversations.length
                    ? "No chats match your search."
                    : "No conversations yet. Tap the pen icon to start one."
            )
        );

        return;

    }

    visible.forEach((conv) => {
        chatList.append(buildConversationButton(conv));
    });

}

function buildConversationButton(conv) {

    const button = el("button", "chat-item");

    button.type = "button";
    button.dataset.conversationId = conv.conversation_id;

    if (activeConversation?.conversation_id === conv.conversation_id) {
        button.classList.add("active");
    }

    const avatar = el("div", "chat-avatar");
    avatar.append(makeImg(avatarFor(conv.display_name, conv.display_avatar), conv.display_name));

    if (!conv.is_group && onlineIds.has(conv.other_user_id)) {
        avatar.classList.add("is-online");
    }

    const details = el("div", "chat-details");

    const top = el("div", "chat-top");
    const title = el("h4", null, conv.display_name);

    if (conv.is_group) {
        title.prepend(el("i", "fas fa-user-group group-icon"), " ");
    }

    top.append(title, el("span", null, formatListTime(conv.last_message_at)));

    const bottom = el("div", "chat-bottom");
    bottom.append(el("p", null, previewById.get(conv.conversation_id) ?? ""));

    if (conv.unread_count > 0) {
        bottom.append(el("span", "unread-count", String(conv.unread_count)));
    }

    details.append(top, bottom);
    button.append(avatar, details);

    button.addEventListener("click", () => openConversation(conv));

    return button;

}

function highlightActiveConversation() {

    chatList.querySelectorAll(".chat-item").forEach((item) => {
        item.classList.toggle(
            "active",
            item.dataset.conversationId === activeConversation?.conversation_id
        );
    });

}


// 7. OPEN A CONVERSATION

function memberById(id) {
    return activeMembers.find((member) => member.id === id) ?? null;
}

function memberName(id) {
    return memberById(id)?.name ?? "Member";
}

function clearAttachmentUrls() {

    attachmentUrls.forEach((url) => URL.revokeObjectURL(url));
    attachmentUrls.clear();

}

function updateConversationHeader() {

    if (!activeConversation) return;

    conversationName.textContent = activeConversation.display_name;
    conversationAvatar.src = avatarFor(activeConversation.display_name, activeConversation.display_avatar);

    if (activeConversation.is_group) {

        const online = activeMembers.filter((member) => onlineIds.has(member.id)).length;

        conversationStatus.textContent =
            `${activeMembers.length} members${online ? `, ${online} active now` : ""}`;

    }
    else {

        const other = activeMembers.find((member) => member.id !== currentUser.id);

        conversationStatus.textContent = other ? describePresence(other) : "";

    }

    const isGroup = Boolean(activeConversation.is_group);

    voiceCallBtn.hidden = isGroup;
    videoCallBtn.hidden = isGroup;

}

async function openConversation(conv) {

    const requestId = ++openRequestId;

    activeConversation = conv;
    activeMembers = [];
    messageCache = new Map();
    viewCache = new Map();
    clearAttachmentUrls();

    // Keep the nav on the list the user is browsing (all chats or groups only).
    showSection(listFilter === "groups" ? "groups" : "messages");

    conversationName.textContent = conv.display_name;
    conversationAvatar.src = avatarFor(conv.display_name, conv.display_avatar);
    conversationStatus.textContent = "";

    highlightActiveConversation();

    messagesArea.replaceChildren(el("p", "list-note", "Loading messages..."));

    try {

        const members = await fetchMembers(conv.conversation_id);

        if (requestId !== openRequestId) return;

        activeMembers = members;
        updateConversationHeader();

        // Latest 200 messages, newest first, then put back in chronological order.
        const { data, error } = await supabaseClient
            .from("messages")
            .select(MESSAGE_COLUMNS)
            .eq("conversation_id", conv.conversation_id)
            .order("created_at", { ascending: false })
            .limit(200);

        if (error) throw error;

        if (requestId !== openRequestId) return;

        const rows = (data ?? []).reverse();
        const views = await Promise.all(rows.map(decodeMessageRow));

        if (requestId !== openRequestId) return;

        rows.forEach((row, index) => {
            messageCache.set(row.id, row);
            viewCache.set(row.id, views[index]);
        });

        renderMessages({ forceScroll: true });

        // Background: re-share keys with members on a new browser.
        healStaleKeys(conv.conversation_id, members).catch((error) => {
            console.warn("Key check error:", error);
        });

        await markActiveAsRead();

    }
    catch (error) {

        console.error("Message load error:", error);
        messagesArea.replaceChildren(el("p", "list-note", "Could not load messages."));

    }

}

// Redraws the open conversation from messageCache, sorted by time.
function renderMessages({ forceScroll = false } = {}) {

    const nearBottom =
        messagesArea.scrollHeight - messagesArea.scrollTop - messagesArea.clientHeight < 120;

    const rows = [...messageCache.values()].sort(
        (a, b) => new Date(a.created_at) - new Date(b.created_at)
    );

    messagesArea.replaceChildren();

    if (rows.length === 0) {
        messagesArea.append(el("p", "list-note", "No messages yet. Say hello!"));
    }

    let lastDay = null;

    rows.forEach((row) => {

        const created = new Date(row.created_at);

        if (!isSameDay(created, lastDay ?? new Date(0))) {

            lastDay = created;

            const divider = el("div", "date-divider");
            divider.append(el("span", null, formatDayLabel(created)));
            messagesArea.append(divider);

        }

        messagesArea.append(buildMessageRow(row, viewCache.get(row.id) ?? { locked: true }));

    });

    if (forceScroll || nearBottom) {
        messagesArea.scrollTop = messagesArea.scrollHeight;
    }

}

function buildMessageRow(row, view) {

    const mine = row.sender_id === currentUser.id;
    const created = new Date(row.created_at);

    const wrapper = el("div", `message-row ${mine ? "sent" : "received"}`);

    wrapper.dataset.messageId = row.id;

    if (!mine) {

        const sender = memberById(row.sender_id);

        wrapper.append(makeImg(avatarFor(sender?.name, sender?.profile_image), sender?.name ?? "User"));

    }

    const content = el("div", "message-content");

    if (!mine && activeConversation?.is_group) {
        content.append(el("span", "message-sender", memberName(row.sender_id)));
    }

    const bubble = el("div", "message-bubble");

    renderBubbleBody(bubble, row, view);

    content.append(bubble);

    const meta = el("div", "message-meta");

    meta.append(el("span", "message-time", formatClock(created)));

    if (mine) {
        meta.append(el("i", "fas fa-check-double sent-check"));
    }

    if (mine && !view.deleted) {

        const unsend = el("button", "unsend-btn");

        unsend.type = "button";
        unsend.title = "Unsend";
        unsend.append(el("i", "fas fa-rotate-left"));
        unsend.addEventListener("click", () => unsendMessage(row.id));

        meta.append(unsend);

    }

    content.append(meta);
    wrapper.append(content);

    return wrapper;

}

function renderBubbleBody(bubble, row, view) {

    if (view.deleted) {
        bubble.classList.add("unsent");
        bubble.append(el("i", "fas fa-ban"), " ", el("span", null, "This message was unsent"));
        return;
    }

    if (view.locked) {
        bubble.classList.add("locked");
        bubble.append(el("i", "fas fa-lock"), " ", el("span", null, "Encrypted message. This browser cannot read it."));
        return;
    }

    if (view.file) {
        bubble.classList.add("has-file");
        bubble.append(buildFileCard(row, view));
    }

    if (view.text) {
        bubble.append(el("span", "message-text", view.text));
    }

}

function isImageMime(mime) {
    return typeof mime === "string" && mime.startsWith("image/");
}

function buildFileCard(row, view) {

    const file = view.file;
    const image = isImageMime(file.m);
    const card = el("div", "file-card");

    if (image) {

        const img = el("img", "message-image");

        img.alt = file.n || "Image";
        img.addEventListener("click", () => openAttachment(row, view, false));

        card.append(img);
        hydrateImage(row, view, img);

    }

    const info = el("div", "file-info");

    info.append(
        el("i", image ? "fas fa-image" : "fas fa-file"),
        el("span", "file-name", file.n || "File"),
        el("span", "file-size", formatBytes(file.s))
    );

    const download = el("button", "file-download");

    download.type = "button";
    download.title = "Download";
    download.append(el("i", "fas fa-download"));
    download.addEventListener("click", () => openAttachment(row, view, true));

    info.append(download);
    card.append(info);

    return card;

}

async function downloadAttachmentBlob(row, view) {

    const key = await getConversationKey(row.conversation_id, row.key_version);

    if (!key) throw new Error("This browser cannot read this file.");

    const { data, error } = await supabaseClient.storage
        .from("chat-files")
        .download(row.attachment_path);

    if (error) throw error;

    let bytes = await decryptBytes(key, new Uint8Array(await data.arrayBuffer()));

    if (view.file.c === "gzip") {
        bytes = await gunzipBytes(bytes);
    }

    return new Blob([bytes], { type: view.file.m || "application/octet-stream" });

}

async function hydrateImage(row, view, img) {

    try {

        if (!attachmentUrls.has(row.id)) {
            const blob = await downloadAttachmentBlob(row, view);
            attachmentUrls.set(row.id, URL.createObjectURL(blob));
        }

        img.src = attachmentUrls.get(row.id);

    }
    catch (error) {

        console.warn("Image preview failed:", error.message);
        img.alt = "Image could not be loaded";

    }

}

async function openAttachment(row, view, asDownload) {

    try {

        const blob = await downloadAttachmentBlob(row, view);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;

        if (asDownload || !isImageMime(view.file.m)) {
            link.download = view.file.n || "file";
        }
        else {
            link.target = "_blank";
            link.rel = "noopener";
        }

        document.body.append(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(url), 60000);

    }
    catch (error) {

        console.error("Open file error:", error);
        showToast("Could not open this file.");

    }

}

async function markActiveAsRead() {

    if (!activeConversation) return;

    const { error } = await supabaseClient.rpc("mark_conversation_read", {
        conv_id: activeConversation.conversation_id
    });

    if (error) {
        console.error("Mark as read error:", error.message);
        return;
    }

    scheduleRefresh();

}


// 8. SEND TEXT AND FILES

async function insertEncryptedMessage(conversationId, context, { text, file = null, attachmentPath = null }) {

    const body = await encryptText(context.key, packMessageBody(text, file));

    const { data, error } = await supabaseClient
        .from("messages")
        .insert({
            conversation_id: conversationId,
            sender_id: currentUser.id,
            body,
            is_encrypted: true,
            key_version: context.version,
            kind: file ? "file" : "text",
            attachment_path: attachmentPath
        })
        .select(MESSAGE_COLUMNS)
        .single();

    if (error) throw error;

    return data;

}

function applyNewMessageLocally(conversationId, row, view) {

    if (activeConversation?.conversation_id !== conversationId) return;

    messageCache.set(row.id, row);
    viewCache.set(row.id, view);
    renderMessages({ forceScroll: true });

}

async function sendMessage() {

    const text = messageInput.value.trim();

    if (!text || !activeConversation || !currentUser) return;

    const conversationId = activeConversation.conversation_id;

    messageInput.value = "";
    sendBtn.disabled = true;

    try {

        const context = await conversationCryptoContext(conversationId);
        const row = await insertEncryptedMessage(conversationId, context, { text });

        applyNewMessageLocally(conversationId, row, { text, file: null });
        scheduleRefresh();

    }
    catch (error) {

        console.error("Send error:", error);
        messageInput.value = text;
        showToast(`Message not sent: ${error.message}`);

    }
    finally {

        sendBtn.disabled = false;
        messageInput.focus();

    }

}

function setUploadStatus(text) {

    uploadStatus.textContent = text;
    uploadStatus.hidden = !text;

}

async function sendFile(file) {

    if (!activeConversation || !currentUser) return;

    const conversationId = activeConversation.conversation_id;
    const caption = messageInput.value.trim();

    sendBtn.disabled = true;
    attachmentBtn.disabled = true;

    try {

        setUploadStatus(`Compressing ${file.name}...`);

        const prepared = await prepareUpload(file);
        const context = await conversationCryptoContext(conversationId);

        setUploadStatus(`Encrypting and uploading ${prepared.name} (${formatBytes(prepared.blob.size)})...`);

        const plainBytes = new Uint8Array(await prepared.blob.arrayBuffer());
        const encrypted = await encryptBytes(context.key, plainBytes);
        const path = `${conversationId}/${crypto.randomUUID()}.bin`;

        const { error: uploadError } = await supabaseClient.storage
            .from("chat-files")
            .upload(path, new Blob([encrypted], { type: "application/octet-stream" }), {
                contentType: "application/octet-stream",
                upsert: false
            });

        if (uploadError) throw uploadError;

        const fileMeta = {
            n: prepared.name,
            m: prepared.mime,
            c: prepared.encoding,
            s: prepared.originalSize
        };

        const row = await insertEncryptedMessage(conversationId, context, {
            text: caption,
            file: fileMeta,
            attachmentPath: path
        });

        messageInput.value = "";
        applyNewMessageLocally(conversationId, row, { text: caption, file: fileMeta });
        scheduleRefresh();

    }
    catch (error) {

        console.error("File send error:", error);
        showToast(`File not sent: ${error.message}`);

    }
    finally {

        setUploadStatus("");
        sendBtn.disabled = false;
        attachmentBtn.disabled = false;
        fileInput.value = "";

    }

}

async function unsendMessage(messageId) {

    if (!confirm("Unsend this message for everyone?")) return;

    const { data: attachmentPath, error } = await supabaseClient.rpc("unsend_message", {
        p_message: messageId
    });

    if (error) {
        showToast(`Could not unsend: ${error.message}`);
        return;
    }

    // The file is removed from storage. The message row keeps no content.
    if (attachmentPath) {
        await supabaseClient.storage.from("chat-files").remove([attachmentPath]);
    }

    applyDeletedLocally(messageId);

}

function applyDeletedLocally(messageId) {

    const row = messageCache.get(messageId);

    if (row) {
        row.deleted_at = new Date().toISOString();
        row.body = null;
    }

    viewCache.set(messageId, { deleted: true });

    const url = attachmentUrls.get(messageId);

    if (url) {
        URL.revokeObjectURL(url);
        attachmentUrls.delete(messageId);
    }

    renderMessages();
    scheduleRefresh();

}


// 9. REALTIME

function subscribeToMessages() {

    supabaseClient
        .channel("chatsphere-messages")
        .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "messages" },
            (payload) => onNewMessage(payload.new)
        )
        .on(
            "postgres_changes",
            { event: "UPDATE", schema: "public", table: "messages" },
            (payload) => onMessageChanged(payload.new)
        )
        .subscribe((status, err) => {

            if (status === "CHANNEL_ERROR") {
                console.error("Realtime error:", err);
            }

        });

}

async function onNewMessage(row) {

    if (activeConversation?.conversation_id === row.conversation_id && !messageCache.has(row.id)) {

        const view = await decodeMessageRow(row);

        applyNewMessageLocally(row.conversation_id, row, view);

        if (row.sender_id !== currentUser.id) {
            markActiveAsRead();
        }

    }

    // Keeps previews, ordering and unread badges up to date.
    scheduleRefresh();

}

function onMessageChanged(row) {

    if (row.deleted_at && messageCache.has(row.id)) {
        applyDeletedLocally(row.id);
        return;
    }

    scheduleRefresh();

}

function subscribeToKeys() {

    supabaseClient
        .channel("chatsphere-keys")
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "conversation_keys" },
            (payload) => onKeyRowChanged(payload.new?.conversation_id ?? payload.old?.conversation_id)
        )
        .subscribe();

}

// A key copy for me was created or re-shared. Retry messages that were locked.
function onKeyRowChanged(conversationId) {

    if (!conversationId) return;

    for (const id of [...keyCache.keys()]) {
        if (id.startsWith(`${conversationId}:`)) keyCache.delete(id);
    }

    if (activeConversation?.conversation_id === conversationId) {
        openConversation(activeConversation);
    }

    scheduleRefresh();

}

function subscribeToMembership() {

    // New groups and added members appear without a page reload.
    supabaseClient
        .channel("chatsphere-membership")
        .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "conversation_members" },
            () => scheduleRefresh()
        )
        .subscribe();

}


// 10. VIEWS AND NAVIGATION

function exitPeopleMode() {

    if (!peopleMode) return;

    peopleMode = false;
    clearTimeout(peopleTimer);

    listTitle.textContent = listFilter === "groups" ? "Groups" : "Messages";
    searchChats.placeholder = "Search chats...";
    searchChats.value = "";

    renderConversationList();

}

function showSection(section) {

    const data = sectionData[section];

    if (!data) return;

    exitPeopleMode();

    navItems.forEach((item) => {
        item.classList.toggle("active", item.dataset.section === section);
    });

    sectionHeading.textContent = data.title;
    sectionSubtitle.textContent = data.subtitle;
    listTitle.textContent = section === "groups" ? "Groups" : "Messages";

    if (section === "messages" || section === "groups") {

        otherSection.hidden = true;
        welcomePanel.hidden = Boolean(activeConversation);
        chatWindow.hidden = !activeConversation;

        return;

    }

    welcomePanel.hidden = true;
    chatWindow.hidden = true;
    otherSection.hidden = false;

    otherSectionTitle.textContent = data.title;
    otherSectionDescription.textContent = data.description;
    otherSectionIcon.className = `fas ${data.icon}`;

}

navItems.forEach((item) => {

    item.addEventListener("click", () => {

        listFilter = item.dataset.section === "groups" ? "groups" : "all";

        showSection(item.dataset.section);
        renderConversationList();

    });

});


// 11. NEW CHAT: SEARCH PEOPLE BY NAME

function enterPeopleMode() {

    showSection("messages");

    peopleMode = true;

    listTitle.textContent = "New chat";
    searchChats.placeholder = "Search people by name...";
    searchChats.value = "";

    chatList.replaceChildren(el("p", "list-note", "Type a name to find someone."));
    searchChats.focus();

}

async function searchPeople(rawTerm) {

    const term = rawTerm.trim();
    const requestId = ++peopleRequestId;

    if (!term) {
        chatList.replaceChildren(el("p", "list-note", "Type a name to find someone."));
        return;
    }

    const { data, error } = await supabaseClient
        .from("profiles")
        .select("id, name, profile_image")
        .ilike("name", `%${escapeLike(term)}%`)
        .neq("id", currentUser.id)
        .order("name", { ascending: true })
        .limit(20);

    // Ignore results if the user left this mode or typed something newer.
    if (!peopleMode || requestId !== peopleRequestId) return;

    if (error) {
        console.error("People search error:", error.message);
        chatList.replaceChildren(el("p", "list-note", "Search failed. Please try again."));
        return;
    }

    if (data.length === 0) {
        chatList.replaceChildren(el("p", "list-note", "No people found."));
        return;
    }

    chatList.replaceChildren(...data.map(buildPersonButton));

}

function buildPersonButton(person) {

    const button = el("button", "chat-item");

    button.type = "button";

    const avatar = el("div", "chat-avatar");
    avatar.append(makeImg(avatarFor(person.name, person.profile_image), person.name));

    const details = el("div", "chat-details");

    const top = el("div", "chat-top");
    top.append(el("h4", null, person.name));

    const bottom = el("div", "chat-bottom");
    bottom.append(el("p", null, "Start a conversation"));

    details.append(top, bottom);
    button.append(avatar, details);

    button.addEventListener("click", () => startConversationWith(person));

    return button;

}

async function startConversationWith(person) {

    const { data: conversationId, error } = await supabaseClient.rpc(
        "create_direct_conversation",
        { other_user: person.id }
    );

    if (error) {
        showToast(`Could not start the chat: ${error.message}`);
        return;
    }

    exitPeopleMode();
    await refreshConversations();

    const conv = conversations.find((c) => c.conversation_id === conversationId);

    if (conv) {
        await openConversation(conv);
    }

}

newChatBtn?.addEventListener("click", enterPeopleMode);
startChatBtn?.addEventListener("click", enterPeopleMode);
newGroupBtn?.addEventListener("click", () => openGroupModal("create", null));


// 12. GROUPS: CREATE, ADD MEMBERS, REMOVE, LEAVE

function openGroupModal(mode, conversation) {

    // In "add" mode, people already in the group are hidden from the results.
    const exclude = new Set(mode === "add" ? groupInfoMemberIds : []);

    groupDraft = { mode, conversation, selected: new Map(), exclude };

    groupModalTitle.textContent = mode === "create" ? "New group" : "Add members";
    groupNameLabel.hidden = mode !== "create";
    saveGroupBtn.textContent = mode === "create" ? "Create group" : "Add to group";
    groupName.value = "";
    groupSearch.value = "";
    groupMessage.textContent = "";

    renderGroupChips();
    groupResults.replaceChildren(el("p", "list-note", "Type a name to find people."));

    groupModal.hidden = false;

    (mode === "create" ? groupName : groupSearch).focus();

}

function closeGroupModal() {

    groupModal.hidden = true;
    groupDraft = null;

}

function renderGroupChips() {

    if (!groupDraft) return;

    groupChips.replaceChildren();

    groupDraft.selected.forEach((person) => {

        const chip = el("button", "picker-chip");

        chip.type = "button";
        chip.title = "Remove";
        chip.append(el("span", null, person.name), el("i", "fas fa-xmark"));

        chip.addEventListener("click", () => {
            groupDraft.selected.delete(person.id);
            renderGroupChips();
        });

        groupChips.append(chip);

    });

}

function buildPickerRow(person) {

    const row = el("button", "picker-row");
    const checked = groupDraft.selected.has(person.id);

    row.type = "button";
    row.append(
        makeImg(avatarFor(person.name, person.profile_image), person.name),
        el("span", "picker-name", person.name),
        el("i", checked ? "fas fa-circle-check" : "far fa-circle")
    );

    if (!person.public_key) {
        row.disabled = true;
        row.append(el("span", "picker-note", "Must open ChatSphere first"));
    }

    row.addEventListener("click", () => {

        if (groupDraft.selected.has(person.id)) groupDraft.selected.delete(person.id);
        else groupDraft.selected.set(person.id, person);

        renderGroupChips();

        const icon = row.querySelector("i:last-child");
        icon.className = groupDraft.selected.has(person.id) ? "fas fa-circle-check" : "far fa-circle";

    });

    return row;

}

async function searchGroupPeople(rawTerm) {

    if (!groupDraft) return;

    const term = rawTerm.trim();

    if (!term) {
        groupResults.replaceChildren(el("p", "list-note", "Type a name to find people."));
        return;
    }

    const { data, error } = await supabaseClient
        .from("profiles")
        .select("id, name, profile_image, public_key")
        .ilike("name", `%${escapeLike(term)}%`)
        .neq("id", currentUser.id)
        .order("name", { ascending: true })
        .limit(20);

    if (!groupDraft) return;

    if (error) {
        groupResults.replaceChildren(el("p", "list-note", "Search failed. Please try again."));
        return;
    }

    const people = (data ?? []).filter((person) => !groupDraft.exclude.has(person.id));

    if (people.length === 0) {
        groupResults.replaceChildren(el("p", "list-note", "No people found."));
        return;
    }

    groupResults.replaceChildren(...people.map(buildPickerRow));

}

async function createGroup(title, people) {

    if (!title) throw new Error("Please enter a group name.");
    if (!myIdentity) throw new Error("Encryption is not available in this browser.");

    assertRecipientsHaveKeys(people);

    const { data: conversationId, error } = await supabaseClient.rpc("create_group", {
        p_title: title,
        p_members: people.map((person) => person.id)
    });

    if (error) throw error;

    const members = await fetchMembers(conversationId);

    await publishKeyVersion(conversationId, 1, members);

    await refreshConversations();

    const conv = conversations.find((c) => c.conversation_id === conversationId);

    if (conv) await openConversation(conv);

}

async function addMembersToGroup(conversation, people) {

    assertRecipientsHaveKeys(people);

    const { error } = await supabaseClient.rpc("add_group_members", {
        p_conversation: conversation.conversation_id,
        p_members: people.map((person) => person.id)
    });

    if (error) throw error;

    // New members get only the new key, so they cannot read older messages.
    const members = await fetchMembers(conversation.conversation_id);

    await rotateConversationKey(conversation.conversation_id, members);

}

async function removeMemberFromGroup(conversation, targetId) {

    const members = await fetchMembers(conversation.conversation_id);
    const remaining = members.filter((member) => member.id !== targetId);

    assertRecipientsHaveKeys(remaining);

    // Rotate first, so the removed person never receives the new key.
    if (remaining.length > 0) {
        await rotateConversationKey(conversation.conversation_id, remaining);
    }

    const { error } = await supabaseClient.rpc("remove_group_member", {
        p_conversation: conversation.conversation_id,
        p_user: targetId
    });

    if (error) throw error;

}

async function saveGroupDraft() {

    if (!groupDraft) return;

    const { mode, conversation, selected } = groupDraft;
    const people = [...selected.values()];
    const title = groupName.value.trim();

    if (people.length === 0) {
        groupMessage.textContent = "Choose at least one person.";
        return;
    }

    saveGroupBtn.disabled = true;
    groupMessage.textContent = "Working...";

    try {

        if (mode === "create") {

            await createGroup(title, people);
            closeGroupModal();

        }
        else {

            await addMembersToGroup(conversation, people);
            closeGroupModal();
            await refreshConversations();
            await openGroupInfo(conversation);

        }

    }
    catch (error) {

        console.error("Group save error:", error);
        groupMessage.textContent = error.message;

    }
    finally {

        saveGroupBtn.disabled = false;

    }

}

saveGroupBtn?.addEventListener("click", saveGroupDraft);
cancelGroupBtn?.addEventListener("click", closeGroupModal);

groupSearch?.addEventListener("input", () => {

    clearTimeout(groupSearchTimer);
    groupSearchTimer = setTimeout(() => searchGroupPeople(groupSearch.value), 250);

});

// Group info

async function openGroupInfo(conversation) {

    groupInfoConversation = conversation;
    groupInfoTitle.textContent = conversation.display_name;
    groupInfoMessage.textContent = "";
    groupInfoModal.hidden = false;

    await renderGroupMembers();

}

async function renderGroupMembers() {

    const conv = groupInfoConversation;

    if (!conv) return;

    const members = await fetchMembers(conv.conversation_id);

    if (activeConversation?.conversation_id === conv.conversation_id) {
        activeMembers = members;
        updateConversationHeader();
    }

    const me = members.find((member) => member.id === currentUser.id);
    const isAdmin = me?.role === "admin";

    groupInfoMemberIds = members.map((member) => member.id);
    groupInfoMeta.textContent = `${members.length} members`;
    addMembersBtn.hidden = !isAdmin;

    memberList.replaceChildren(...members.map((member) => buildMemberRow(member, isAdmin, conv)));

}

function buildMemberRow(member, isAdmin, conv) {

    const row = el("div", "member-row");

    const details = el("div", "member-details");
    details.append(el("span", "member-name", member.name));

    if (member.role === "admin") {
        details.append(el("span", "member-badge", "Admin"));
    }

    details.append(el("span", "member-presence", onlineIds.has(member.id) ? "Active now" : describePresence(member)));

    row.append(makeImg(avatarFor(member.name, member.profile_image), member.name), details);

    if (isAdmin && member.id !== currentUser.id) {

        const remove = el("button", "member-remove", "Remove");

        remove.type = "button";
        remove.addEventListener("click", async () => {

            if (!confirm(`Remove ${member.name} from this group?`)) return;

            try {
                await removeMemberFromGroup(conv, member.id);
                await renderGroupMembers();
                await refreshConversations();
            }
            catch (error) {
                groupInfoMessage.textContent = error.message;
            }

        });

        row.append(remove);

    }

    return row;

}

addMembersBtn?.addEventListener("click", () => {

    if (!groupInfoConversation) return;

    const conversation = groupInfoConversation;

    groupInfoModal.hidden = true;
    openGroupModal("add", conversation);

});

leaveGroupBtn?.addEventListener("click", async () => {

    const conv = groupInfoConversation;

    if (!conv || !confirm("Leave this group?")) return;

    try {

        await removeMemberFromGroup(conv, currentUser.id);

        groupInfoModal.hidden = true;
        groupInfoConversation = null;

        if (activeConversation?.conversation_id === conv.conversation_id) {
            activeConversation = null;
            activeMembers = [];
            showSection(listFilter === "groups" ? "groups" : "messages");
        }

        await refreshConversations();

    }
    catch (error) {
        groupInfoMessage.textContent = error.message;
    }

});

closeGroupInfoBtn?.addEventListener("click", () => {

    groupInfoModal.hidden = true;
    groupInfoConversation = null;

});

moreChatBtn?.addEventListener("click", () => {

    if (activeConversation?.is_group) {
        openGroupInfo(activeConversation);
        return;
    }

    showToast("Conversation options are coming soon.");

});

conversationName?.addEventListener("click", () => {

    if (activeConversation?.is_group) openGroupInfo(activeConversation);

});


// 13. CALLS

function formatDuration(ms) {

    const total = Math.floor(ms / 1000);
    const minutes = String(Math.floor(total / 60)).padStart(2, "0");
    const seconds = String(total % 60).padStart(2, "0");

    return `${minutes}:${seconds}`;

}

function openCallScreen(context) {

    callName.textContent = context.name;
    callAvatar.src = context.avatar;
    callScreen.classList.toggle("audio-only", context.media === "audio");
    cameraCallBtn.hidden = context.media !== "video";

    muteCallBtn.classList.remove("off");
    cameraCallBtn.classList.remove("off");
    muteCallBtn.querySelector("i").className = "fas fa-microphone";
    cameraCallBtn.querySelector("i").className = "fas fa-video";

    callStatusText.textContent = "Calling...";
    callScreen.hidden = false;

}

function updateCallScreen(state) {

    if (callScreen.hidden) return;

    if (state === "ringing-out") {
        callStatusText.textContent = "Ringing...";
    }
    else if (state === "connecting") {
        callStatusText.textContent = "Connecting...";
    }
    else if (state === "connected") {

        clearInterval(callClock);
        callStartedAt = Date.now();
        callStatusText.textContent = "Connected 00:00";

        callClock = setInterval(() => {
            callStatusText.textContent = `Connected ${formatDuration(Date.now() - callStartedAt)}`;
        }, 1000);

    }

}

function closeCallScreen(message) {

    clearInterval(callClock);

    callScreen.hidden = true;

    localVideo.srcObject = null;
    remoteVideo.srcObject = null;

    if (message) showToast(message);

}

async function startCallFromHeader(media) {

    if (!activeConversation || activeConversation.is_group) {
        showToast("Calls work between two people. Open a direct chat to call.");
        return;
    }

    if (!callManager || callManager.isBusy()) {
        showToast("You are already in a call.");
        return;
    }

    const other = activeMembers.find((member) => member.id !== currentUser.id);

    if (!other) return;

    openCallScreen({
        name: other.name,
        avatar: avatarFor(other.name, other.profile_image),
        media
    });

    try {

        await callManager.start({
            conversationId: activeConversation.conversation_id,
            peerId: other.id,
            media
        });

    }
    catch (error) {

        closeCallScreen();
        showToast(error.message || "Could not start the call.");

    }

}

async function showIncomingCall(row) {

    const { data: caller } = await supabaseClient
        .from("profiles")
        .select("name, profile_image")
        .eq("id", row.caller_id)
        .maybeSingle();

    const name = caller?.name ?? "Someone";

    pendingIncoming = {
        row,
        name,
        avatar: avatarFor(name, caller?.profile_image)
    };

    incomingName.textContent = name;
    incomingAvatar.src = pendingIncoming.avatar;
    incomingKind.textContent = row.media === "video" ? "Incoming video call" : "Incoming voice call";

    incomingCall.hidden = false;

}

function hideIncomingCall() {

    incomingCall.hidden = true;
    pendingIncoming = null;

}

acceptCallBtn?.addEventListener("click", async () => {

    if (!pendingIncoming) return;

    const incoming = pendingIncoming;

    hideIncomingCall();

    try {

        await callManager.acceptIncoming();

        openCallScreen({
            name: incoming.name,
            avatar: incoming.avatar,
            media: incoming.row.media
        });

    }
    catch (error) {

        showToast(error.message || "Could not answer the call.");

    }

});

declineCallBtn?.addEventListener("click", async () => {

    hideIncomingCall();
    await callManager.declineIncoming();

});

hangUpBtn?.addEventListener("click", () => callManager?.hangUp());

muteCallBtn?.addEventListener("click", () => {

    const muted = !muteCallBtn.classList.contains("off");

    muteCallBtn.classList.toggle("off", !muted);
    muteCallBtn.querySelector("i").className = muted ? "fas fa-microphone" : "fas fa-microphone-slash";
    callManager?.setMuted(!muted);

});

cameraCallBtn?.addEventListener("click", () => {

    const off = !cameraCallBtn.classList.contains("off");

    cameraCallBtn.classList.toggle("off", off);
    cameraCallBtn.querySelector("i").className = off ? "fas fa-video-slash" : "fas fa-video";
    callManager?.setCameraOff(off);

});

voiceCallBtn?.addEventListener("click", () => startCallFromHeader("audio"));
videoCallBtn?.addEventListener("click", () => startCallFromHeader("video"));

function setupCallManager() {

    callManager = createCallManager({
        userId: currentUser.id,
        onIncoming: (row) => showIncomingCall(row),
        onIncomingExpired: (row, status) => {

            if (pendingIncoming?.row.id === row.id) hideIncomingCall();

            if (CALL_END_TEXT[status]) showToast(CALL_END_TEXT[status]);

        },
        onState: (row, state) => updateCallScreen(state),
        onLocalStream: (stream) => { localVideo.srcObject = stream; },
        onRemoteStream: (stream) => { remoteVideo.srcObject = stream; },
        onEnded: (row, status) => closeCallScreen(CALL_END_TEXT[status] ?? "Call ended")
    });

    callManager.init();

}


// 14. SEND BUTTON, EMOJI, FILES, KEYBOARD

sendBtn?.addEventListener("click", sendMessage);

messageInput.addEventListener("keydown", (event) => {

    if (event.key === "Enter") {
        event.preventDefault();
        sendMessage();
    }

});

emojiPanel.replaceChildren(buildEmojiPanel((emoji) => insertTextAtCaret(messageInput, emoji)));

emojiBtn?.addEventListener("click", () => {
    emojiPanel.hidden = !emojiPanel.hidden;
});

attachmentBtn?.addEventListener("click", () => {

    if (activeConversation) fileInput.click();

});

fileInput?.addEventListener("change", () => {

    const file = fileInput.files[0];

    if (file) sendFile(file);

});

searchChats.addEventListener("input", () => {

    if (!peopleMode) {
        renderConversationList();
        return;
    }

    clearTimeout(peopleTimer);

    peopleTimer = setTimeout(() => {
        searchPeople(searchChats.value);
    }, 250);

});

searchChats.addEventListener("keydown", (event) => {

    if (event.key === "Escape") {
        exitPeopleMode();
    }

});


// 15. TOAST

function showToast(text) {

    toast.textContent = text;
    toast.hidden = false;

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
        toast.hidden = true;
    }, 3500);

}


// 16. LOGOUT AND PROFILE SHORTCUTS

logoutBtn?.addEventListener("click", async () => {

    if (!confirm("Are you sure you want to logout?")) return;

    logoutBtn.disabled = true;

    callManager?.hangUp();
    await signOutUser();

    window.location.replace("login.html");

});

function openProfile() {
    window.location.href = "profile.html";
}

profileMenuBtn?.addEventListener("click", openProfile);
headerProfileBtn?.addEventListener("click", openProfile);

window.addEventListener("pagehide", () => {
    callManager?.hangUp();
});


// 17. THEME TOGGLE

themeBtn?.addEventListener("click", () => {

    document.body.classList.toggle("dark-theme");

    const icon = themeBtn.querySelector("i");

    icon.className = document.body.classList.contains("dark-theme")
        ? "fas fa-sun"
        : "far fa-moon";

});


// 18. NOTIFICATIONS, HELP AND PLACEHOLDERS

document.getElementById("notificationBtn")?.addEventListener("click", () => {
    showToast("You have no new notifications.");
});

document.getElementById("helpBtn")?.addEventListener("click", () => {
    showToast("ChatSphere Help & Support will be available soon.");
});


// 19. INITIALIZE

async function initDashboard() {

    const session = await requireSession();

    if (!session) return;

    redirectOnSignOut();

    try {

        currentUser = await loadCurrentProfile(session.user);
        renderSidebarProfile();

        try {
            myIdentity = await ensureIdentity(currentUser);
        }
        catch (error) {
            console.error("Encryption setup error:", error);
            showToast("Encryption could not start in this browser. Messages cannot be sent here.");
        }

        startPresence();
        setupCallManager();

        subscribeToMessages();
        subscribeToKeys();
        subscribeToMembership();

        await refreshConversations();

        // Fallback for membership changes that realtime does not deliver (removals).
        setInterval(refreshConversations, 60000);

    }
    catch (error) {

        console.error("Dashboard error:", error);

        alert("Unable to connect to ChatSphere. Please check your Supabase settings.");

    }

}

initDashboard();
