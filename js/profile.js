// ==========================================
// CHATSPHERE - PROFILE PAGE (Supabase)
// Depends on: js/supabase.js
// ==========================================


// 1. DOM ELEMENTS

const profileImage = document.getElementById("profileImage");
const profileName = document.getElementById("profileName");
const profileEmail = document.getElementById("profileEmail");
const profileBio = document.getElementById("profileBio");
const profileMessage = document.getElementById("profileMessage");

const editProfileBtn = document.getElementById("editProfileBtn");
const useGooglePhotoBtn = document.getElementById("useGooglePhotoBtn");
const profileForm = document.getElementById("profileForm");
const editName = document.getElementById("editName");
const editBio = document.getElementById("editBio");
const editAvatar = document.getElementById("editAvatar");
const saveProfileBtn = document.getElementById("saveProfileBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");

const logoutBtn = document.getElementById("logoutBtn");


// 2. STATE AND CONSTANTS

let currentUserId = null;
let currentProfile = null;
let googlePhotoUrl = null;

const AVATAR_TYPES = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif"
};

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;


// 3. RENDERING

function renderProfile(profile) {

    profileName.textContent = profile.name;
    profileBio.textContent = profile.bio || "No bio added yet.";
    profileImage.src = avatarFor(profile.name, profile.profile_image);

}

function showProfileMessage(text, type) {

    profileMessage.textContent = text;
    profileMessage.className = type;

}

function openEditor() {

    editName.value = currentProfile.name;
    editBio.value = currentProfile.bio || "";
    editAvatar.value = "";

    profileForm.hidden = false;
    editName.focus();

}

function closeEditor() {

    profileForm.hidden = true;

}

// Google returns a small photo by default. The "=s96-c" suffix sets the size, so 256 px is used here.
function googlePhotoFrom(user) {

    const url = user?.user_metadata?.avatar_url || user?.user_metadata?.picture;

    if (!url) return null;

    return url.replace(/=s\d+(-c)?$/, "=s256-c");

}


// 4. LOAD PROFILE

async function fetchProfile(userId) {

    const { data, error } = await supabaseClient
        .from("profiles")
        .select("id, name, bio, profile_image")
        .eq("id", userId)
        .maybeSingle();

    if (error) throw error;

    if (!data) {
        throw new Error("Profile not found. Run the backfill section of supabase/schema.sql.");
    }

    return data;

}

async function initProfile() {

    const session = await requireSession();

    if (!session) return;

    redirectOnSignOut();

    currentUserId = session.user.id;
    profileEmail.textContent = session.user.email;

    googlePhotoUrl = googlePhotoFrom(session.user);

    if (googlePhotoUrl) {
        useGooglePhotoBtn.hidden = false;
    }

    try {

        currentProfile = await fetchProfile(currentUserId);
        renderProfile(currentProfile);

    }
    catch (error) {

        console.error("Profile load error:", error);
        showProfileMessage(`Could not load your profile: ${error.message}`, "error");

    }

}


// 5. AVATAR UPLOAD (Storage bucket "avatars", folder = user id)

async function uploadAvatar(userId, file) {

    const extension = AVATAR_TYPES[file.type];

    if (!extension) {
        throw new Error("Please choose a PNG, JPG, WEBP or GIF image.");
    }

    if (file.size > AVATAR_MAX_BYTES) {
        throw new Error("The image must be 2 MB or smaller.");
    }

    const path = `${userId}/${Date.now()}.${extension}`;

    const { error } = await supabaseClient.storage
        .from("avatars")
        .upload(path, file, {
            contentType: file.type,
            cacheControl: "3600"
        });

    if (error) throw error;

    const { data } = supabaseClient.storage
        .from("avatars")
        .getPublicUrl(path);

    return data.publicUrl;

}


// 6. SAVE PROFILE

profileForm.addEventListener("submit", async (event) => {

    event.preventDefault();

    const name = editName.value.trim();
    const bio = editBio.value.trim();
    const file = editAvatar.files[0];

    if (!name) {
        showProfileMessage("Please enter a display name.", "error");
        return;
    }

    saveProfileBtn.disabled = true;
    showProfileMessage("Saving...", "");

    try {

        const profileImageUrl = file
            ? await uploadAvatar(currentUserId, file)
            : currentProfile.profile_image;

        const { data, error } = await supabaseClient
            .from("profiles")
            .update({
                name,
                bio,
                profile_image: profileImageUrl
            })
            .eq("id", currentUserId)
            .select("id, name, bio, profile_image")
            .single();

        if (error) throw error;

        currentProfile = data;
        renderProfile(currentProfile);
        closeEditor();
        showProfileMessage("Profile updated.", "success");

    }
    catch (error) {

        console.error("Profile save error:", error);
        showProfileMessage(error.message, "error");

    }
    finally {

        saveProfileBtn.disabled = false;

    }

});


// 7. USE THE GOOGLE PROFILE PHOTO

useGooglePhotoBtn.addEventListener("click", async () => {

    if (!googlePhotoUrl || !currentProfile) return;

    useGooglePhotoBtn.disabled = true;
    showProfileMessage("Updating your picture...", "");

    try {

        const { data, error } = await supabaseClient
            .from("profiles")
            .update({ profile_image: googlePhotoUrl })
            .eq("id", currentUserId)
            .select("id, name, bio, profile_image")
            .single();

        if (error) throw error;

        currentProfile = data;
        renderProfile(currentProfile);
        showProfileMessage("Profile picture set from your Google photo.", "success");

    }
    catch (error) {

        console.error("Google photo error:", error);
        showProfileMessage(error.message, "error");

    }
    finally {

        useGooglePhotoBtn.disabled = false;

    }

});


// 8. BUTTONS

editProfileBtn.addEventListener("click", () => {

    if (!currentProfile) return;

    openEditor();

});

cancelEditBtn.addEventListener("click", closeEditor);

logoutBtn.addEventListener("click", async () => {

    logoutBtn.disabled = true;

    await signOutUser();

    window.location.replace("login.html");

});


// 9. INITIALIZE

initProfile();
