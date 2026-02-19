// addUserToGroup.js
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function addUserToGroup(req, res) {
    const {
        group,
        user_id,
        access_hash,       // optional fallback
        session_string,
        name,
        uname,
        // optional tuning
        join_first = true,          // session avval guruhga kirsin
        precheck_member = true,     // invite'dan oldin tekshir
        postcheck_member = true,    // invite'dan keyin tekshir
        wait_after_invite_ms = 800, // post-check oldidan biroz kutish (cache/propagation)
    } = req.body || {};

    if (!session_string) return res.json(resp({ status: 400, added: false, reason: "bad_request", message: "session_string required", name }));
    if (!group) return res.json(resp({ status: 400, added: false, reason: "bad_request", message: "group required", name }));
    if (user_id === undefined || user_id === null || user_id === "") {
        return res.json(resp({ status: 400, added: false, reason: "bad_request", message: "user_id required", name }));
    }

    let client;
    try {
        client = new TelegramClient(
            new StringSession(String(session_string)),
            Number(process.env.API_ID),
            String(process.env.API_HASH),
            { connectionRetries: 5 }
        );

        await client.connect();

        // 1) Group entity (public/private) + optional join
        const channelEntity = await resolveChannelEntity(client, group, join_first);

        // 2) User input (resolve)
        const inputUser = await resolveInputUser(client, user_id, access_hash, uname);

        // 3) Pre-check: user allaqachon membermi?
        if (precheck_member) {
            const already = await isUserInChannel(client, channelEntity, inputUser);
            if (already) {
                return res.json(resp({
                    status: 200,
                    added: true,
                    already: true,
                    reason: "already_member",
                    message: "User is already a participant",
                    name,
                }));
            }
        }

        // 4) Invite
        let inviteErr = null;
        try {
            await client.invoke(new Api.channels.InviteToChannel({
                channel: channelEntity,
                users: [inputUser],
            }));
        } catch (e) {
            inviteErr = String(e?.message || e);
        }

        // 5) Post-check: aniq qo‘shildimi?
        if (postcheck_member) {
            if (wait_after_invite_ms) await sleep(Number(wait_after_invite_ms));
            const isMember = await isUserInChannel(client, channelEntity, inputUser);

            if (isMember) {
                // inviteErr bo‘lsa ham — user member bo‘lsa success
                return res.json(resp({
                    status: 200,
                    added: true,
                    already: false,
                    reason: inviteErr ? "added_but_invite_error" : "added",
                    message: inviteErr ? `Invite error, but user is member: ${inviteErr}` : "User successfully added",
                    name,
                }));
            }

            // Member emas: sababni inviteErr'dan chiqaramiz
            const mapped = mapTelegramError(inviteErr || "Invite done, but user is NOT a participant");
            return res.json(resp({
                status: 200,
                added: false,
                already: false,
                reason: mapped.reason,
                message: mapped.message,
                wait_seconds: mapped.wait_seconds ?? null,
                name,
            }));
        }

        // Agar post-check o‘chirilgan bo‘lsa: invite natijasini qaytaramiz (kam tavsiya)
        if (!inviteErr) {
            return res.json(resp({ status: 200, added: true, reason: "added_no_postcheck", message: "Invite sent (no post-check)", name }));
        } else {
            const mapped = mapTelegramError(inviteErr);
            return res.json(resp({ status: 200, added: false, reason: mapped.reason, message: mapped.message, wait_seconds: mapped.wait_seconds ?? null, name }));
        }
    } catch (err) {
        const msg = String(err?.message || err);
        const mapped = mapTelegramError(msg);
        return res.json(resp({
            status: 500,
            added: false,
            reason: mapped.reason || "server_error",
            message: mapped.message || msg,
            wait_seconds: mapped.wait_seconds ?? null,
            name,
        }));
    } finally {
        try { if (client) await client.disconnect(); } catch { }
    }
}

/* -------------------- Core helpers -------------------- */

async function resolveChannelEntity(client, group, joinFirst) {
    const s = String(group).trim();

    const plus = s.match(/t\.me\/\+([A-Za-z0-9_-]+)/i);
    const joinchat = s.match(/t\.me\/joinchat\/([A-Za-z0-9_-]+)/i);

    if (plus?.[1] || joinchat?.[1]) {
        const hash = plus?.[1] || joinchat?.[1];

        if (joinFirst) {
            const updates = await client.invoke(new Api.messages.ImportChatInvite({ hash }));
            // updates.chats ichidan entity
            const chats = updates?.chats || [];
            if (Array.isArray(chats) && chats.length) {
                return await client.getEntity(chats[0]);
            }
            // fallback: cache to‘ldi deb faraz qilib dialogs’dan topish
            const dialogs = await client.getDialogs({ limit: 100 });
            const found = dialogs?.[0]?.entity;
            if (found) return found;
            throw new Error("Joined via invite, but could not resolve chat entity");
        }

        // joinFirst=false bo‘lsa ham entity topish qiyin (private link getEntity qilmaydi)
        throw new Error("Private invite link requires join/import to resolve entity");
    }

    // PUBLIC
    const groupInput = normalizePublicGroup(s);
    const entity = await client.getEntity(groupInput);

    if (joinFirst) {
        try {
            await client.invoke(new Api.channels.JoinChannel({ channel: entity }));
        } catch (_) { }
    }

    return entity;
}

async function resolveInputUser(client, user_id, access_hash, uname) {

    // 1️⃣ Agar username bo‘lsa — birinchi navbatda username orqali resolve qilamiz
    if (uname && String(uname).trim()) {
        try {
            const username = String(uname).trim().startsWith("@")
                ? String(uname).trim()
                : "@" + String(uname).trim();

            return await client.getInputEntity(username);
        } catch (e) {
            // username ishlamasa fallback qilamiz
        }
    }

    // 2️⃣ ID orqali resolve qilishga urinib ko‘ramiz (session cache bo‘lsa ishlaydi)
    const uid = toBigInt(user_id);
    try {
        return await client.getInputEntity(uid);
    } catch (e) {
        // 3️⃣ Oxirgi fallback: id + access_hash
        if (!access_hash) throw e;

        return new Api.InputUser({
            userId: uid,
            accessHash: toBigInt(access_hash),
        });
    }
}


async function isUserInChannel(client, channelEntity, inputUser) {
    try {
        await client.invoke(new Api.channels.GetParticipant({
            channel: channelEntity,
            participant: inputUser,
        }));
        return true;
    } catch (e) {
        const msg = String(e?.message || e);
        // aniq member emas bo‘ladiganlar
        if (msg.includes("USER_NOT_PARTICIPANT")) return false;
        if (msg.includes("PARTICIPANT_ID_INVALID")) return false;
        if (msg.includes("USER_ID_INVALID")) return false;
        // Boshqa xatoda ham false qaytaramiz (tekshiruv qiyin bo‘lsa)
        return false;
    }
}

/* -------------------- Utility helpers -------------------- */

function normalizePublicGroup(s) {
    if (s.startsWith("@")) return s;

    // https://t.me/username  (private emas)
    const m = s.match(/t\.me\/(?!\+)(?!joinchat\/)([A-Za-z0-9_]+)/i);
    if (m?.[1]) return `@${m[1]}`;

    // "username"
    if (/^[A-Za-z0-9_]{4,}$/.test(s)) return `@${s}`;

    return s;
}

function toBigInt(x) {
    try { return BigInt(String(x)); }
    catch { throw new Error(`Invalid integer value: ${x}`); }
}

function parseFloodWaitSeconds(message) {
    const m1 = String(message).match(/FLOOD_WAIT_(\d+)/i);
    if (m1?.[1]) return Number(m1[1]);
    const m2 = String(message).match(/wait of (\d+) seconds/i);
    if (m2?.[1]) return Number(m2[1]);
    return null;
}

/**
 * Telegram error -> reason + message (+ wait_seconds)
 * Bu frontda “nega qo‘shilmadi” ni aniq chiqarish uchun.
 */
function mapTelegramError(raw) {
    const msg = String(raw || "");

    const fw = parseFloodWaitSeconds(msg);
    if (fw) return { reason: "flood_wait", message: `FloodWait: wait ${fw} seconds`, wait_seconds: fw };

    if (msg.includes("CHAT_ADMIN_REQUIRED")) return { reason: "admin_required", message: "Session is not admin / no permission to add members" };
    if (msg.includes("USER_PRIVACY_RESTRICTED")) return { reason: "privacy_restricted", message: "User privacy settings prevent adding to groups" };
    if (msg.includes("USER_BANNED_IN_CHANNEL")) return { reason: "user_banned", message: "User is banned in this group/channel" };
    if (msg.includes("USER_KICKED")) return { reason: "user_kicked", message: "User was kicked from this group/channel (may require unban)" };
    if (msg.includes("USER_ID_INVALID")) return { reason: "user_id_invalid", message: "Invalid user_id / user entity cannot be resolved" };
    if (msg.includes("CHANNEL_PRIVATE")) return { reason: "channel_private", message: "Channel/group is private or session has no access" };
    if (msg.includes("INVITE_HASH_INVALID")) return { reason: "invite_invalid", message: "Invite link/hash is invalid" };
    if (msg.includes("INVITE_HASH_EXPIRED")) return { reason: "invite_expired", message: "Invite link/hash is expired" };
    if (msg.includes("PEER_FLOOD")) return { reason: "peer_flood", message: "Peer flood: Telegram flagged this account for too many actions" };

    // default
    return { reason: "unknown_error", message: msg || "Unknown error" };
}

function resp(x) {
    // response shape stable bo‘lsin
    return {
        status: x.status ?? 200,
        added: !!x.added,
        already: !!x.already,
        reason: x.reason ?? null,
        message: x.message ?? "",
        wait_seconds: x.wait_seconds ?? null,
        name: x.name ?? null,
        ts: Date.now(),
    };
}
