import "dotenv/config";
import cors from "cors";
import { send_code, verify_code } from "./loginfunktions.js";
import { activeNumbers, getUserIDBy } from "./inital.js";
import express from "express";
import { getGroupMenmers } from "./groupmember.js";
import addUserToGroup from "./addUserToGroup.js";
import { deleteNumber } from "./supabase.js";


const app = express();
app.use(cors({ origin: "*" }));
app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://aracelis-svelte-mitigatedly.ngrok-free.dev"
  ], // Vite
}));
app.use(express.json());


const apiId = Number(process.env.API_ID || 0);
const apiHash = process.env.API_HASH || "";
const port = Number(process.env.PORT || 4000);

if (!apiId || !apiHash) {
  console.error("❌ API_ID / API_HASH yo‘q. .env ni tekshiring.");
  process.exit(1);
}
// check health
app.get("/health", (req, res) => {
  console.log("impuls 100000000");
  return res.json({ status: "ok" });
});
// login fonksiyasi
// 1) Kod yuborish
app.post("/tg/send-code", send_code)
// 2) Kodni tekshirish
app.post("/tg/verify-code", verify_code);
// active numberlar
app.post("/activeNumbers", activeNumbers);
// get  user by id
app.get("/getUserByID", getUserIDBy);
//add member

// get members in group
app.post("/getGroupMenmers", getGroupMenmers)
app.delete("/deleteNumber", deleteNumber)


app.post("/addUserToGroup", addUserToGroup)


app.listen(port, "0.0.0.0", () => {
  console.log(`✅ Backend : http://localhost:${port}`);
});