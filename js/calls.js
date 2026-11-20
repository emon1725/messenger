// ==========================================
// CHATSPHERE - VOICE AND VIDEO CALLS (WebRTC + Supabase Realtime)
// Depends on: js/supabase.js (supabaseClient). Load before script.js.
//
// Signaling lives in two tables (see supabase/schema.sql):
//   call_sessions  - one row per call: ringing, accepted, ended, declined, missed, failed
//   call_signals   - SDP offer/answer and ICE candidates, addressed to the other person
// Media flows peer to peer. STUN finds the route; users behind strict firewalls need TURN.
// ==========================================


const CALL_ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" }
    // For strict networks add a TURN server, for example:
    // { urls: "turn:turn.example.com:3478", username: "user", credential: "secret" }
];

const CALL_RING_MS = 45000;

const CALL_END_TEXT = {
    ended: "Call ended",
    declined: "Call declined",
    missed: "No answer",
    failed: "Connection failed"
};

const CALL_TERMINAL_STATUSES = ["ended", "declined", "missed", "failed"];

function callMediaConstraints(media) {

    return {
        audio: true,
        video: media === "video" ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false
    };

}

function stopMediaStream(stream) {
    stream?.getTracks().forEach((track) => track.stop());
}

async function requestCallMedia(media) {

    if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser cannot access the microphone or camera.");
    }

    try {
        return await navigator.mediaDevices.getUserMedia(callMediaConstraints(media));
    }
    catch (error) {
        throw new Error(
            error.name === "NotAllowedError"
                ? "Microphone or camera permission was denied."
                : "Could not access the microphone or camera."
        );
    }

}

function createCallManager(options) {

    const {
        userId,
        onIncoming,          // (row) an incoming call is ringing
        onIncomingExpired,   // (row, status) an incoming call stopped ringing
        onState,             // (row, state) states: ringing-out, connecting, connected
        onLocalStream,       // (stream)
        onRemoteStream,      // (stream)
        onEnded              // (row, status) the call finished
    } = options;

    let channel = null;
    let active = null;      // the call in progress
    let incoming = null;    // { row, timer } while a call is ringing for me
    const seenSignals = new Set();


    // 1. HELPERS

    function setState(call, state) {

        if (active !== call) return;

        call.state = state;
        onState?.(call.row, state);

    }

    function otherUserId(call) {
        return call.role === "caller" ? call.row.callee_id : call.row.caller_id;
    }

    async function sendSignal(call, kind, payload) {

        const { error } = await supabaseClient.from("call_signals").insert({
            call_id: call.row.id,
            from_user: userId,
            to_user: otherUserId(call),
            kind,
            payload
        });

        if (error) console.warn("Call signal not sent:", error.message);

    }

    function createPeer(call) {

        const pc = new RTCPeerConnection({ iceServers: CALL_ICE_SERVERS });

        call.pc = pc;

        call.localStream.getTracks().forEach((track) => {
            pc.addTrack(track, call.localStream);
        });

        pc.onicecandidate = (event) => {
            if (event.candidate) sendSignal(call, "ice", event.candidate.toJSON());
        };

        pc.ontrack = (event) => {
            onRemoteStream?.(event.streams[0] ?? new MediaStream([event.track]));
        };

        pc.onconnectionstatechange = () => {

            if (active !== call) return;

            if (pc.connectionState === "connected") {
                clearTimeout(call.timer);
                setState(call, "connected");
            }
            else if (pc.connectionState === "failed") {
                finishCall(call, "failed", true);
            }

        };

    }

    // Ends the call on this device. notifyServer also writes the final status for both sides.
    async function finishCall(call, status, notifyServer) {

        if (active !== call) return;

        active = null;
        clearTimeout(call.timer);

        try { call.pc?.close(); } catch (error) { /* already closed */ }

        stopMediaStream(call.localStream);

        if (notifyServer) {

            await supabaseClient
                .from("call_sessions")
                .update({ status })
                .eq("id", call.row.id)
                .in("status", ["ringing", "accepted"]);

        }

        // Each side deletes only the signals it can see (its own sent and received rows).
        await supabaseClient.from("call_signals").delete().eq("call_id", call.row.id);

        onEnded?.(call.row, status);

    }

    async function flushPendingIce(call) {

        const queued = call.pendingIce.splice(0);

        for (const candidate of queued) {
            await call.pc.addIceCandidate(candidate).catch(() => {});
        }

    }

    async function handleSignal(call, signal) {

        if (seenSignals.has(signal.id)) return;

        seenSignals.add(signal.id);

        try {

            if (signal.kind === "offer" && call.role === "callee") {

                await call.pc.setRemoteDescription(signal.payload);
                call.remoteSet = true;
                await flushPendingIce(call);

                const answer = await call.pc.createAnswer();
                await call.pc.setLocalDescription(answer);

                await sendSignal(call, "answer", call.pc.localDescription.toJSON());

                await supabaseClient
                    .from("call_sessions")
                    .update({ status: "accepted" })
                    .eq("id", call.row.id)
                    .eq("status", "ringing");

            }
            else if (signal.kind === "answer" && call.role === "caller") {

                await call.pc.setRemoteDescription(signal.payload);
                call.remoteSet = true;
                await flushPendingIce(call);
                setState(call, "connecting");

            }
            else if (signal.kind === "ice") {

                // ICE can arrive before the remote description. Queue it until then.
                if (call.remoteSet) await call.pc.addIceCandidate(signal.payload);
                else call.pendingIce.push(signal.payload);

            }

        }
        catch (error) {

            console.warn("Call signal error:", error);

        }

    }

    // Offers go first, then answers, then ICE candidates.
    async function processSignals(call, signals) {

        const order = { offer: 0, answer: 1, ice: 2 };

        const sorted = [...signals].sort((a, b) => order[a.kind] - order[b.kind]);

        for (const signal of sorted) {
            await handleSignal(call, signal);
        }

    }


    // 2. OUTGOING CALLS (caller)

    async function start({ conversationId, peerId, media }) {

        if (active) throw new Error("You are already in a call.");

        const localStream = await requestCallMedia(media);

        const { data: row, error } = await supabaseClient
            .from("call_sessions")
            .insert({
                conversation_id: conversationId,
                caller_id: userId,
                callee_id: peerId,
                media
            })
            .select()
            .single();

        if (error) {
            stopMediaStream(localStream);
            throw error;
        }

        const call = {
            row,
            role: "caller",
            localStream,
            pc: null,
            remoteSet: false,
            pendingIce: [],
            timer: null,
            state: "ringing-out"
        };

        active = call;

        onLocalStream?.(localStream);
        setState(call, "ringing-out");

        call.timer = setTimeout(() => {
            if (call.state === "ringing-out") finishCall(call, "missed", true);
        }, CALL_RING_MS);

        createPeer(call);

        const offer = await call.pc.createOffer();
        await call.pc.setLocalDescription(offer);
        await sendSignal(call, "offer", call.pc.localDescription.toJSON());

    }


    // 3. INCOMING CALLS (callee)

    async function acceptIncoming() {

        if (!incoming || active) return;

        const row = incoming.row;

        clearTimeout(incoming.timer);
        incoming = null;

        let localStream;

        try {
            localStream = await requestCallMedia(row.media);
        }
        catch (error) {
            await supabaseClient
                .from("call_sessions")
                .update({ status: "failed" })
                .eq("id", row.id)
                .eq("status", "ringing");
            throw error;
        }

        // The caller may have hung up while the permission prompt was open.
        const { data: current } = await supabaseClient
            .from("call_sessions")
            .select("status")
            .eq("id", row.id)
            .maybeSingle();

        if (!current || current.status !== "ringing") {
            stopMediaStream(localStream);
            onIncomingExpired?.(row, current?.status ?? "ended");
            return;
        }

        const call = {
            row,
            role: "callee",
            localStream,
            pc: null,
            remoteSet: false,
            pendingIce: [],
            timer: null,
            state: "connecting"
        };

        active = call;

        onLocalStream?.(localStream);
        createPeer(call);
        setState(call, "connecting");

        // Signals sent before accepting are stored in the table, so load them now.
        const { data: signals, error } = await supabaseClient
            .from("call_signals")
            .select("id, call_id, from_user, kind, payload")
            .eq("call_id", row.id)
            .eq("to_user", userId)
            .order("created_at", { ascending: true });

        if (error) {
            finishCall(call, "failed", true);
            throw error;
        }

        await processSignals(call, signals ?? []);

    }

    async function declineIncoming() {

        if (!incoming) return;

        const row = incoming.row;

        clearTimeout(incoming.timer);
        incoming = null;

        await supabaseClient
            .from("call_sessions")
            .update({ status: "declined" })
            .eq("id", row.id)
            .eq("status", "ringing");

    }


    // 4. REALTIME EVENTS

    function onSessionInserted(row) {

        if (row.callee_id !== userId) return;

        // Already on a call: refuse the new one.
        if (active || incoming) {
            supabaseClient
                .from("call_sessions")
                .update({ status: "declined" })
                .eq("id", row.id)
                .eq("status", "ringing");
            return;
        }

        const timer = setTimeout(() => {

            if (!incoming || incoming.row.id !== row.id) return;

            const expired = incoming.row;
            incoming = null;

            supabaseClient
                .from("call_sessions")
                .update({ status: "missed" })
                .eq("id", expired.id)
                .eq("status", "ringing");

            onIncomingExpired?.(expired, "missed");

        }, CALL_RING_MS);

        incoming = { row, timer };

        onIncoming?.(row);

    }

    function onSessionUpdated(row) {

        // The caller stopped ringing before I answered.
        if (incoming && incoming.row.id === row.id && row.status !== "ringing") {

            clearTimeout(incoming.timer);

            const expired = incoming.row;
            incoming = null;

            onIncomingExpired?.(expired, row.status);
            return;

        }

        if (!active || active.row.id !== row.id) return;

        if (row.status === "accepted") {
            if (active.role === "caller") setState(active, "connecting");
            return;
        }

        if (CALL_TERMINAL_STATUSES.includes(row.status)) {
            finishCall(active, row.status, false);
        }

    }

    function onSignalInserted(signal) {

        if (signal.to_user !== userId) return;
        if (!active || active.row.id !== signal.call_id) return;

        handleSignal(active, signal);

    }


    // 5. PUBLIC API

    function init() {

        channel = supabaseClient
            .channel(`calls:${userId}`)
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "call_sessions", filter: `callee_id=eq.${userId}` },
                (payload) => onSessionInserted(payload.new)
            )
            .on(
                "postgres_changes",
                { event: "UPDATE", schema: "public", table: "call_sessions", filter: `caller_id=eq.${userId}` },
                (payload) => onSessionUpdated(payload.new)
            )
            .on(
                "postgres_changes",
                { event: "UPDATE", schema: "public", table: "call_sessions", filter: `callee_id=eq.${userId}` },
                (payload) => onSessionUpdated(payload.new)
            )
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "call_signals", filter: `to_user=eq.${userId}` },
                (payload) => onSignalInserted(payload.new)
            )
            .subscribe((status, error) => {
                if (status === "CHANNEL_ERROR") console.error("Call channel error:", error);
            });

    }

    return {
        init,
        start,
        acceptIncoming,
        declineIncoming,
        hangUp() {
            if (active) finishCall(active, "ended", true);
        },
        setMuted(muted) {
            active?.localStream.getAudioTracks().forEach((track) => { track.enabled = !muted; });
        },
        setCameraOff(off) {
            active?.localStream.getVideoTracks().forEach((track) => { track.enabled = !off; });
        },
        isBusy() {
            return Boolean(active || incoming);
        },
        activeRow() {
            return active?.row ?? null;
        },
        destroy() {
            channel?.unsubscribe();
        }
    };

}
