// ==========================================
// CHATSPHERE - LOGIN, SIGN UP AND GOOGLE SIGN IN (Supabase Auth)
// Depends on: js/supabase.js
// ==========================================

const DASHBOARD_PAGE = "index.html";


// 1. UI HELPERS

function showAuthMessage(element, text, type) {

    element.textContent = text;
    element.className = `auth-message ${type}`;

}

// Keeps the button's original label (it contains an icon) and restores it afterwards.
function setButtonBusy(button, busy, busyText = "") {

    if (!button.dataset.idleHtml) {
        button.dataset.idleHtml = button.innerHTML;
    }

    button.disabled = busy;

    if (busy) {
        button.textContent = busyText;
    }
    else {
        button.innerHTML = button.dataset.idleHtml;
    }

}


// 2. ALREADY SIGNED IN? GO STRAIGHT TO THE DASHBOARD

(async () => {

    const session = await getSession();

    if (session) {
        window.location.replace(DASHBOARD_PAGE);
    }

})();


// 3. SIGN UP

const signupForm = document.getElementById("signupForm");

if (signupForm) {

    signupForm.addEventListener("submit", async (event) => {

        event.preventDefault();

        const message = document.getElementById("authMessage");
        const button = document.getElementById("signupBtn");

        const name = document.getElementById("name").value.trim();
        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;
        const confirmPassword = document.getElementById("confirmPassword").value;

        if (password !== confirmPassword) {
            showAuthMessage(message, "Passwords do not match.", "error");
            return;
        }

        setButtonBusy(button, true, "Creating Account...");

        try {

            // The trigger in schema.sql reads "name" from the metadata and creates the profile.
            setRememberMe(true);

            const { data, error } = await supabaseClient.auth.signUp({
                email,
                password,
                options: {
                    data: { name }
                }
            });

            if (error) throw error;

            if (data.session) {

                // Email confirmation is OFF in Supabase: the user is signed in right away.
                showAuthMessage(message, "Account created. Redirecting...", "success");

                setTimeout(() => {
                    window.location.replace(DASHBOARD_PAGE);
                }, 800);

            }
            else {

                // Email confirmation is ON: the user must click the link first.
                showAuthMessage(
                    message,
                    "Account created. Check your email to confirm your address, then sign in.",
                    "success"
                );

            }

        }
        catch (error) {

            showAuthMessage(message, error.message, "error");

        }
        finally {

            setButtonBusy(button, false);

        }

    });

}


// 4. LOGIN

const loginForm = document.getElementById("loginForm");

if (loginForm) {

    loginForm.addEventListener("submit", async (event) => {

        event.preventDefault();

        const message = document.getElementById("authMessage");
        const button = document.getElementById("loginBtn");

        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;
        const remember = document.getElementById("rememberMe")?.checked ?? false;

        setButtonBusy(button, true, "Signing In...");

        try {

            // Decide where the session is stored before signing in.
            setRememberMe(remember);

            const { error } = await supabaseClient.auth.signInWithPassword({
                email,
                password
            });

            if (error) throw error;

            showAuthMessage(message, "Signed in successfully.", "success");

            setTimeout(() => {
                window.location.replace(DASHBOARD_PAGE);
            }, 600);

        }
        catch (error) {

            showAuthMessage(message, error.message, "error");

        }
        finally {

            setButtonBusy(button, false);

        }

    });

}


// 5. GOOGLE SIGN IN
// Redirects to Google, then back to index.html. Supabase creates the profile on the first
// sign in, with the Google name and profile photo (see handle_new_user in schema.sql).

const googleSignInBtn = document.getElementById("googleSignInBtn");

if (googleSignInBtn) {

    googleSignInBtn.addEventListener("click", async () => {

        const message = document.getElementById("authMessage");
        const remember = document.getElementById("rememberMe")?.checked ?? true;

        setRememberMe(remember);

        const redirectTo = new URL(DASHBOARD_PAGE, window.location.href).href;

        const { error } = await supabaseClient.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo }
        });

        if (error) {
            showAuthMessage(message, error.message, "error");
        }

    });

}


// 6. FORGOT PASSWORD (placeholder, as in the original design)

const forgotPassword = document.getElementById("forgotPassword");

if (forgotPassword) {

    forgotPassword.addEventListener("click", (event) => {

        event.preventDefault();

        alert("Password reset feature will be implemented in a future step.");

    });

}
