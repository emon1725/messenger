// ==========================================
// CHATSPHERE - SUPABASE CLIENT AND SHARED HELPERS
// Load order on every page:
//   1. supabase-js (CDN)
//   2. js/supabase.js   (this file)
//   3. the page script  (auth.js, script.js or profile.js)
// ==========================================


// 1. CONFIGURATION
// These two values are public and safe in the browser.
// Row Level Security (supabase/schema.sql) is what protects the data.
// Never put the service_role key in frontend code.

const SUPABASE_URL = "https://xsxueijifrduadpycngp.supabase.co";

const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhzeHVlaWppZnJkdWFkcHljbmdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxNjA4MzgsImV4cCI6MjExMDczNjgzOH0.c_MPBjgXr2yoGu1OaVEpcpa9Duq3vivQ9HOXbdifdy4";

const REMEMBER_KEY = "chat_remember_me";


// 2. SESSION STORAGE
// "Remember me" ticked  -> session stored in localStorage (survives browser restarts)
// "Remember me" not set -> session stored in sessionStorage (cleared when the tab closes)

const sessionStore = {

    getItem(key) {
        return sessionStorage.getItem(key) ?? localStorage.getItem(key);
    },

    setItem(key, value) {
        const remember = localStorage.getItem(REMEMBER_KEY) === "1";

        const target = remember ? localStorage : sessionStorage;
        const other = remember ? sessionStorage : localStorage;

        other.removeItem(key);
        target.setItem(key, value);
    },

    removeItem(key) {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
    }

};

function setRememberMe(enabled) {
    localStorage.setItem(REMEMBER_KEY, enabled ? "1" : "0");
}


// 3. CLIENT

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
        auth: {
            storage: sessionStore,
            storageKey: "chatsphere-auth",
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
        }
    }
);


// 4. SESSION HELPERS

async function getSession() {

    const { data, error } = await supabaseClient.auth.getSession();

    if (error) {
        console.error("Session error:", error.message);
    }

    return data?.session ?? null;

}

// Returns the session, or sends the visitor to the login page.
async function requireSession(loginPage = "login.html") {

    const session = await getSession();

    if (!session) {
        window.location.replace(loginPage);
    }

    return session;

}

// Sends the visitor to the login page when the session ends
// (for example, after logging out in another tab).
function redirectOnSignOut(loginPage = "login.html") {

    supabaseClient.auth.onAuthStateChange((event) => {

        if (event === "SIGNED_OUT") {
            window.location.replace(loginPage);
        }

    });

}

// Signs out on this device only.
async function signOutUser() {

    const { error } = await supabaseClient.auth.signOut({ scope: "local" });

    if (error) {
        console.error("Sign out error:", error.message);
    }

}


// 5. UI HELPERS

// Creates an element. Text is set with textContent, so user input is never parsed as HTML.
function el(tag, className, text) {

    const node = document.createElement(tag);

    if (className) node.className = className;

    if (text !== undefined) node.textContent = text;

    return node;

}

function makeImg(src, alt) {

    const img = document.createElement("img");

    img.src = src;
    img.alt = alt || "";
    img.loading = "lazy";

    return img;

}

function avatarFor(name, imageUrl) {

    if (imageUrl) return imageUrl;

    return `https://ui-avatars.com/api/?background=random&name=${encodeURIComponent(name || "User")}`;

}

function isSameDay(a, b) {
    return a.toDateString() === b.toDateString();
}

function formatClock(date) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Chat list timestamp: clock time today, "Yesterday", or a short date.
function formatListTime(iso) {

    if (!iso) return "";

    const date = new Date(iso);
    const now = new Date();

    if (isSameDay(date, now)) return formatClock(date);

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    if (isSameDay(date, yesterday)) return "Yesterday";

    return date.toLocaleDateString([], { day: "numeric", month: "short" });

}

// Divider label between messages from different days.
function formatDayLabel(date) {

    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    if (isSameDay(date, now)) return "Today";
    if (isSameDay(date, yesterday)) return "Yesterday";

    return date.toLocaleDateString([], {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
    });

}

// Escapes % _ and \ so user input is matched literally in ilike searches.
function escapeLike(text) {
    return text.replace(/[\\%_]/g, (char) => "\\" + char);
}
