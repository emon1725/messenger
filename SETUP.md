# ChatSphere v2 setup

## 1. Database
Supabase Dashboard > SQL Editor > New query. Paste `supabase/schema.sql` and run it.
The script is safe to run again, on a new project or on a project that already ran v1.

## 2. Google sign in
1. Google Cloud Console > APIs & Services > Credentials > Create OAuth client ID (Web application).
2. Add this Authorized redirect URI: `https://xsxueijifrduadpycngp.supabase.co/auth/v1/callback`
3. Supabase Dashboard > Authentication > Providers > Google: enable it and paste the Client ID and Client Secret.
4. Supabase Dashboard > Authentication > URL Configuration: set the Site URL and add the URL where
   `index.html` is hosted (for example `https://your-site.example/index.html`) to the Redirect URLs.

## 3. Hosting
Open the app over HTTPS or on localhost. Encryption (Web Crypto) and calls (WebRTC) need a secure context.

## 4. Calls across strict networks (optional)
Calls use a public STUN server. For users behind strict firewalls, add a TURN server in
`js/calls.js` (`CALL_ICE_SERVERS`).

## Notes
- Each browser creates its own encryption key. Signing in on a new browser takes over encryption
  there, and other members re-share chat keys the next time they open the chat.
- Messages sent before this update stay as plain text. New messages, files and group keys are encrypted.
