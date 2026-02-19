import "dotenv/config";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Api } from "telegram/tl/index.js";
import { getUserById, getUserAll, getSessionByNumber, addLog, addSession, updateUser } from "./supabase.js";
import passwordPkg from "telegram/Password.js";
const { computeCheck } = passwordPkg;
const apiId = Number(process.env.API_ID || 0);
const apiHash = process.env.API_HASH || "";

if (!apiId || !apiHash) {
  console.error("❌ API_ID / API_HASH yo‘q. .env ni tekshiring.");
  process.exit(1);
}






const send_code = async (req, res) => {
    try {
        const { phone, user_id } = req.body;
        if (!phone) return res.json({ auth: 0, status: 400, messsage: "Telifon raqam kiritilmagan !" });

        const session = new StringSession("");
        const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 });
        await client.connect();

        let result;
        try {
            result = await client.invoke(
                new Api.auth.SendCode({
                    phoneNumber: phone,
                    apiId,
                    apiHash,
                    settings: new Api.CodeSettings({}),
                })
            );
        } catch (err) {
            console.error("Telegram error:", err);
            await client.disconnect();
            return res.json({ auth: 0, status: 401, message: "Telegram xatoligi" + err.message });
        }

        // Log qo‘shish
        addLog(user_id, { action: "send_code", timestamp: new Date().toISOString() });

        console.log("Muvaffaqiyatli");
        await client.disconnect();

        return res.json({
            auth: 0,
            status: 200,
            ok: true,
            message: "Kode yuborildi",
            phoneCodeHash: result.phoneCodeHash,
            sessionString: client.session.save(),
        });
    } catch (e) {
        console.error(e);
        return res.json({ auth: 0, status: 500, message: "Gram jsda yuborishda hatolik", detail: String(e?.message || e) });
    }
}

const verify_code = async (req, res) => {
    try {
        const { user_id, phone, code, phoneCodeHash, stringSessionText, password } = req.body;
        if (!phone || !code || !phoneCodeHash) {
            return res.json({ auth: 1, status: 400, message: "o'zgaruvchilar yetib kelmasligi", user_id, phone, code, phoneCodeHash, stringSessionText, password });
        }

        const client = new TelegramClient(
            new StringSession(stringSessionText),
            apiId,
            apiHash,
            { connectionRetries: 5 }
        );
        await client.connect();

        try {
            // Avval SMS kod bilan sign in qilish
            await client.invoke(
                new Api.auth.SignIn({
                    phoneNumber: phone,
                    phoneCode: code,
                    phoneCodeHash,
                })
            );
        } catch (err) {
            const msg = String(err?.message || err).toLowerCase();

            if (msg.includes("password") || msg.includes("session_password_needed")) {
                // Agar 2FA parol kerak bo‘lsa
                if (!password) {
                    await client.disconnect();
                    return res.json({ auth: 1, status: 401, message: "2 bosqichli parol zarur" });
                }

                const pwdInfo = await client.invoke(new Api.account.GetPassword());
                const srpPassword = await computeCheck(pwdInfo, password);

                await client.invoke(
                    new Api.auth.CheckPassword({
                        password: srpPassword,
                    })
                );
            } else {
                await client.disconnect();
                return res.json({ auth: 1, status: 402, message: "telegram kodi xato", detail: String(err?.message || err) });
            }
        }

        const sessionStringSuccess = client.session.save();
        let userDate = (await getUserById(user_id)).data;
        console.log(userDate.setle_phones);

        let setle_phones = userDate.setle_phones == null ? [] : userDate.setle_phones;
        setle_phones.push(phone);
        setle_phones = Array.from(new Set(setle_phones));
        let session_number = phone;
        addSession(user_id, session_number, password, sessionStringSuccess, new Date().toISOString());
        updateUser(user_id, { setle_phones });

        console.log("Kirish muvaffaqiyatli:", user_id);

        await client.disconnect();

        return res.json({ auth: 1, status: 200, ok: true, session: sessionStringSuccess });
    } catch (e) {
        console.error(e);
        return res.json({ auth: 1, status: 500, message: "verify_code_failed", detail: String(e?.message || e) });
    }
}

export { send_code, verify_code }