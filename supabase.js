import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TABLE_NAME = "Users1";


export async function getUserById(user_id) {
    const { data, error } = await supabase
        .from(TABLE_NAME)
        .select('*')
        .eq('user_id', user_id)
        .single();
    return { data, error };
}

export async function getUserAll() {
    const { data, error } = await supabase
        .from(TABLE_NAME)
        .select('*');
    console.log(data);

    return { data, error };
}

export async function upsertUser(user) {
    const { data, error } = await supabase
        .from(TABLE_NAME)
        .upsert([user]);
    return { data, error };
}

export function deleteUserById(user_id) {
    return supabase
        .from(TABLE_NAME)
        .delete()
        .eq('user_id', user_id);
}

export async function addLog(user_id, log) {
    const user = await getUserById(user_id);
    if (user.error) {
        console.error("User not found:", user.error);
        return;
    }
    const logs = user.data.logs || [];
    logs.push({ title: log, timestamp: new Date().toISOString() });
    return supabase.from(TABLE_NAME)
        .update({ logs })
        .eq('user_id', user_id);
}

export async function updateUser(user_id, updates = {}) {
    if (!user_id) throw new Error("user_id majburiy!");
    if (!updates || Object.keys(updates).length === 0) {
        throw new Error("Yangilash uchun kamida bitta qiymat kerak!");
    }

    const { data, error } = await supabase
        .from(TABLE_NAME)               // jadval nomi
        .update(updates)             // dinamik yangilash
        .eq("user_id", user_id)           // qaysi userni yangilash
        .select();                   // yangilangan qatorni qaytarish

    if (error) {
        throw new Error("Yangilashda xatolik: " + error.message);
    }

    return data[0]; // yangilangan foydalanuvchi
}

export async function addSession(user_id, session_number, session_two_step_veryfy, session_sring, created_date) {
    if (!user_id) throw new Error("user_id majburiy!");

    const { data, error } = await supabase
        .from("user_sesions")
        .upsert([{ session_number, user_id, session_two_step_veryfy, session_sring }], { onConflict: "session_number" })
        .select();

    if (error) {
        throw new Error("Upsert xatolik: " + error.message);
    }

    return data[0]; // yangi yoki mavjud foydalanuvchi
}

export async function getSessionByNumber(session_number) {
    const { data, error } = await supabase
        .from("user_sesions")
        .select('*')
        .eq('session_number', session_number)
        .single();
    return { data, error };

}
export async function deleteNumber(req, res) {
    const { user_id, number } = req.body
    const { datau, erroru } = await supabase.from("Users1").update({ setle_phones: number }).eq('user_id', user_id).single();
    const { data, error } = await supabase.from("user_sesions").update({ session_sring: "deleted" }).eq('user_id', user_id);
    return res.json({ status: 200, datau, erroru });
}