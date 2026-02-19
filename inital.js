import "dotenv/config";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { getUserById, getUserAll, getSessionByNumber, addLog, addSession, updateUser } from "./supabase.js";
const apiId = Number(process.env.API_ID || 0);
const apiHash = process.env.API_HASH || "";
const port = Number(process.env.PORT || 4000);

if (!apiId || !apiHash) {
    console.error("❌ API_ID / API_HASH yo‘q. .env ni tekshiring.");
    process.exit(1);
}



// funktions
async function checkSessionActive(sessionString) {
    const client = new TelegramClient(
        new StringSession(sessionString),
        apiId,
        apiHash,
        { connectionRetries: 3, requestTimeout: 10000 }
    );

    let javob = false;
    try {
        await client.connect(); // mavjud sessionni ulash
        const me = await client.getMe(); // foydalanuvchini olish
        javob = true;
    } catch (err) {
        console.error("Session xato:", err.message);
        javob = false;
    } finally {
        await client.disconnect(); // har doim yopib qo‘yish
    }
    return javob;
}



const getUserIDBy = async (req, res) => {
    try {
        const user = await getUserById(req.query.user_id);

        res.json(user);
    } catch (err) {
        console.error("Backend xatolik:", err); // <-- shu joyda to‘liq xatolik chiqadi
        res.status(500).json({ error: err.message });
    }
}
const activeNumbers = async (req, res) => {
    const array = req.body.numbers;

    if (!Array.isArray(array)) {
        return res.status(400).json({ error: "numbers massiv bo‘lishi kerak" });
    }

    const newArray = [];
    for (const element of array) {
        const session = await getSessionByNumber(element);
        const status = await checkSessionActive(session.data?.session_sring)
            ? "active"
            : "inactive";

        newArray.push({ number: element, status, session_sring: session.data.session_sring });
    }
    return res.json({ data: newArray });
}



export { getUserIDBy, activeNumbers }