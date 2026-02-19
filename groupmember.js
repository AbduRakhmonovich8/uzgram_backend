import "dotenv/config";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { getSessionByNumber } from "./supabase.js";


const apiId = Number(process.env.API_ID || 0);
const apiHash = process.env.API_HASH || "";

function isValidApiCreds() {
    return Number.isFinite(apiId) && apiId > 0 && typeof apiHash === "string" && apiHash.length > 10;
}
function cleanTextWithStack(text = "") {
    const stack = [];

    for (const ch of text.toLowerCase()) {
        // lotin harflar
        const isLatin = ch >= "a" && ch <= "z";

        // kirill harflar
        const isCyrillic =
            (ch >= "а" && ch <= "я") || ch === "ё";

        // bo‘sh joy
        const isSpace = ch === " ";

        // _, -, . ni space ga aylantiramiz
        if (ch === "_" || ch === "-" || ch === ".") {
            stack.push(" ");
            continue;
        }

        // faqat ruxsat etilgan belgilar stackga tushadi
        if (isLatin || isCyrillic || isSpace) {
            stack.push(ch);
        }
        // qolgan hamma narsa (emoji, raqam, symbol) tashlanadi
    }

    // ketma-ket bo‘sh joylarni tozalash
    return stack
        .join("")
        .replace(/\s+/g, " ")
        .trim();
}
function toTokensStack(text = "") {
    return cleanTextWithStack(text).split(" ");
}

export function guessGender(user) {
    const firstRaw = (user?.firstName || "").toString().trim();
    const lastRaw = (user?.lastName || "").toString().trim();
    const usernameRaw = (user?.username || "").toString().trim();

    const first = firstRaw.toLowerCase();
    const last = lastRaw.toLowerCase();
    const username = usernameRaw.toLowerCase();

    if (!first && !last && !username) return "aralash";

    const femaleKeywords = [
        "gul", "гул",
        "noz", "ноз",
        "oy", "ой",
        "oyim", "ойим",
        "bibi", "биби",
        "bonu", "бону",
        "nisa", "ниса",
        "malika", "малика",
        "shirin", "ширин",
        "zebo", "зебо",
        "nargiz", "наргиз",
        "lola", "лола",
        "nozanin", "нозанин",
        "dilafruz", "дилафруз",
        "dilbar", "дилбар",
        "xonim", "хоним",
        "qiz", "қиз"
    ];

    const maleKeywords = [
        "bek", "бек",
        "boy", "бой",
        "jon", "жон",
        "mir", "мир",
        "mirzo", "мирзо",
        "zod", "зод",
        "shoh", "шоҳ", "шох",
        "xuja", "хўжа",
        "xaydar", "хайдар",
        "botir", "ботир",
        "bahodir", "баходир",
        "shavkat", "шавкат",
        "rustam", "рустам",
        "farhod", "фарҳод", "фарход",
        "sherzod", "шерзод",
        "shoxrux", "шоҳрух", "шохрух",
        "jaxongir", "жаҳонгир", "жахонгир",
        "o'g'il", "ўғил", "угил"
    ];

    const femaleEndings = [
        "a", "а", "ya", "я",
        "na", "на",
        "la", "ла",
        "ra", "ра",
        "sha", "ша",
        "ta", "та",
        "da", "да",
        "va", "ва",
        "ma", "ма",
        "bonu", "бону",
        "nisa", "ниса",
        "gul", "гул",
        "noz", "ноз"
    ];

    const maleEndings = [
        "bek", "бек",
        "jon", "жон",
        "mir", "мир",
        "zod", "зод",
        "shoh", "шоҳ", "шох",
        "boy", "бой",
        "r", "р",
        "n", "н",
        "k", "к",
        "v", "в",
        "d", "д",
        "l", "л",
        "p", "п"
    ];

    const femaleSurnameEndings = ["ova", "ovna", "ова", "eva", "ева", "овна", "na", "la"];
    const maleSurnameEndings = ["ov", "ов", "ev", "ев", "ich", "ич"];
    const hay = new Set(toTokensStack(`${username} ${last} ${first}`.trim()));
    let femaleScore = 0;
    let maleScore = 0;
    for (const element of hay) {
        if (element.length < 2) continue
        for (const w of femaleSurnameEndings) if (element.endsWith(w)) femaleScore += 3;
        for (const w of maleSurnameEndings) if (element.endsWith(w)) maleScore += 2;

        for (const w of femaleKeywords) if (element.includes(w)) femaleScore += 1;
        for (const w of maleKeywords) if (element.includes(w)) maleScore += 1;

        for (const w of femaleEndings) if (element.endsWith(w)) femaleScore += 2;
        for (const w of maleEndings) if (element.endsWith(w)) maleScore += 2;
    }

    if (femaleScore >= maleScore + 2) return "ayol";
    if (maleScore >= femaleScore + 2) return "erkak";
    return "aralash";
}

function isOnlineStatus(status) {
    return status instanceof Api.UserStatusOnline;
}
function isOfflineStatus(status) {
    return status instanceof Api.UserStatusOffline;
}
async function fetchParticipantsPage(client, entity, index) {
    const limit = 100;
    const offset = (Math.max(1, Number(index) || 1) - 1) * limit;
    const users = await client.getParticipants(entity, { offset, limit });

    return users || [];
}



function applyFilters(users, { typegender = "aralash", isoline = "aralash" }) {
    const tg = (typegender || "aralash").toString().toLowerCase();
    const il = (isoline || "aralash").toString().toLowerCase();
    const out = [];
    for (const u of users) {
        if (u.bot) continue;
        if (u.deleted) continue;
        if (il === "online") {
            if (!isOnlineStatus(u.status)) continue;
        } else if (il === "offline") {
            if (!isOfflineStatus(u.status)) continue;
        }
        const g = guessGender(u);
        if (tg === "erkak" && g !== "erkak") continue;
        if (tg === "ayol" && g !== "ayol") continue;
        const uname = u.username ? `@${u.username}` : "";
        out.push({
            user_id: String(u.id),
            user_name: uname,
            gender: g,
            firstname: u.firstName || null,
            lastname: u.lastName || null,
            telnumber: u.phone || null,
            accessHash: u.accessHash || null
        });
    }
    return out;
}

async function getClientFromSession(sessionStr) {
    if (!isValidApiCreds()) throw new Error("API_ID/API_HASH noto‘g‘ri yoki yo‘q");
    const stringSession = new StringSession(sessionStr || "");
    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 3,
    });
    await client.connect();
    const isAuth = await client.isUserAuthorized();
    if (!isAuth) {
        await client.disconnect();
        throw new Error("Session authorize qilinmagan (login qilinmagan stringSession)");
    }
    return client;
}

const getGroupMenmers = async (req, res) => {
    try {
        const { group, index, typegender, isoline, number } = req.body;
        const { data } = await getSessionByNumber(number)
        const session = await data?.session_sring


        if (!group || typeof group !== "string") {
            return res.json({ step: 0, status: 400, message: "group (link yoki @username) majburiy" });
        }
        if (!session || typeof session !== "string" || session.length < 7) {
            return res.json({ step: 0, status: 400, message: "session (StringSession) majburiy" });
        }

        const client = await getClientFromSession(session);

        try {
            const entity = await client.getEntity(group);

            if (entity instanceof Api.Channel && entity.broadcast && !entity.megagroup) {
                return res.status(400).json({
                    message: "Bu    broadcast kanal. Subscriberlarni olish mumkin emas. Faqat supergroup (megagroup) bo‘lsa bo‘ladi.",
                });
            }
            const usersPage = await fetchParticipantsPage(client, entity, index);
            const data = applyFilters(usersPage, { typegender, isoline });

            return res.json({ step: 0, status: 200, data, meta: { fetched: usersPage.length, returned: data.length } });
        } finally {
            await client.disconnect();
        }
    } catch (err) {
        return res.json({ step: 0, status: 500, message: err?.message || "server_error" });
    }
}

export { getGroupMenmers }

