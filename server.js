const express = require("express");
const axios = require("axios");
const cors = require("cors");
const fs = require("fs");
const cron = require("node-cron");

const app = express();
app.use(cors());

// ==========================
// 🛡️ PROTEÇÃO GLOBAL (evita crash)
// ==========================
process.on("uncaughtException", (err) => {
  console.error("💥 ERRO NÃO TRATADO:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("💥 PROMISE ERROR:", err);
});

// ==========================
// 🔐 CONFIG (ENV)
// ==========================
const TOKEN = process.env.TOKEN;
const IG_ID = process.env.IG_ID;
const BASE_URL = "https://graph.facebook.com/v25.0";

if (!TOKEN || !IG_ID) {
  console.log("⚠️ TOKEN ou IG_ID não definidos!");
}

// ==========================
// 📁 ARQUIVO HISTÓRICO
// ==========================
const HISTORY_FILE = "./followers-history.json";

if (!fs.existsSync(HISTORY_FILE)) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify([]));
}

// ==========================
// 💾 SALVAR FOLLOWERS
// ==========================
async function saveFollowersHistory() {
  try {
    if (!TOKEN || !IG_ID) return;

    const url = `${BASE_URL}/${IG_ID}?fields=followers_count&access_token=${TOKEN}`;
    const response = await axios.get(url);

    const followers = response.data.followers_count;
    const today = new Date().toISOString().split("T")[0];

    let history = JSON.parse(fs.readFileSync(HISTORY_FILE));

    const alreadyExists = history.find((h) => h.date === today);

    if (!alreadyExists) {
      history.push({ date: today, followers });
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
      console.log("✅ Followers salvo:", { date: today, followers });
    }
  } catch (error) {
    console.log(
      "❌ ERRO AO SALVAR FOLLOWERS:",
      error.response?.data || error.message
    );
  }
}

// ==========================
// ⏰ CRON (todo dia)
// ==========================
cron.schedule("0 0 * * *", () => {
  console.log("⏰ Rodando coleta diária...");
  if (TOKEN && IG_ID) {
    saveFollowersHistory();
  }
});

// roda ao iniciar
if (TOKEN && IG_ID) {
  saveFollowersHistory();
}

// ==========================
// 🏠 ROTA ROOT (Railway)
// ==========================
app.get("/", (req, res) => {
  res.send("🚀 API Meta Dashboard rodando com sucesso!");
});

// ==========================
// 📊 INSIGHTS DAILY (30 dias)
// ==========================
app.get("/insights/daily", async (req, res) => {
  try {
    if (!TOKEN || !IG_ID) return res.json([]);

    const since = new Date();
    since.setDate(since.getDate() - 30);

    const sinceStr = since.toISOString().split("T")[0];
    const untilStr = new Date().toISOString().split("T")[0];

    const url = `${BASE_URL}/${IG_ID}/insights?metric=reach&period=day&since=${sinceStr}&until=${untilStr}&access_token=${TOKEN}`;

    const response = await axios.get(url);

    const reachData = response.data.data.find(
      (m) => m.name === "reach"
    );

    const result =
      reachData?.values?.map((v) => ({
        date: v.end_time.split("T")[0],
        reach: v.value,
      })) || [];

    res.json(result);
  } catch (error) {
    console.log("❌ DAILY ERROR:", error.response?.data || error.message);
    res.json([]);
  }
});

// ==========================
// 📈 INSIGHTS TOTAL
// ==========================
app.get("/insights/total", async (req, res) => {
  try {
    if (!TOKEN || !IG_ID)
      return res.json({ profile_views: 0, followers_count: 0 });

    const profileUrl = `${BASE_URL}/${IG_ID}/insights?metric=profile_views&period=day&metric_type=total_value&access_token=${TOKEN}`;
    const followersUrl = `${BASE_URL}/${IG_ID}?fields=followers_count&access_token=${TOKEN}`;

    const [profileRes, followersRes] = await Promise.all([
      axios.get(profileUrl),
      axios.get(followersUrl),
    ]);

    res.json({
      profile_views:
        profileRes.data?.data?.[0]?.total_value?.value ?? 0,
      followers_count: followersRes.data?.followers_count ?? 0,
    });
  } catch (error) {
    console.log("❌ TOTAL ERROR:", error.response?.data || error.message);

    res.json({
      profile_views: 0,
      followers_count: 0,
    });
  }
});

// ==========================
// 📉 FOLLOWERS HISTORY
// ==========================
app.get("/insights/followers-history", (req, res) => {
  try {
    const history = JSON.parse(fs.readFileSync(HISTORY_FILE));
    res.json(history);
  } catch (error) {
    res.json([]);
  }
});

// ==========================
// 📱 MEDIA + REACH
// ==========================
app.get("/media", async (req, res) => {
  try {
    if (!TOKEN || !IG_ID) return res.json([]);

    const url = `${BASE_URL}/${IG_ID}/media?fields=id,caption,media_type,media_url,thumbnail_url,like_count,comments_count,timestamp&limit=25&access_token=${TOKEN}`;

    const response = await axios.get(url);

    const media = await Promise.all(
      response.data.data.map(async (item) => {
        try {
          const insightsUrl = `${BASE_URL}/${item.id}/insights?metric=reach&access_token=${TOKEN}`;
          const insightsRes = await axios.get(insightsUrl);

          const reach =
            insightsRes.data.data?.[0]?.values?.[0]?.value ?? 0;

          return {
            ...item,
            reach,
          };
        } catch {
          return {
            ...item,
            reach: 0,
          };
        }
      })
    );

    res.json(media);
  } catch (error) {
    console.log("❌ MEDIA ERROR:", error.response?.data || error.message);
    res.json([]);
  }
});

// ==========================
// 🚀 START SERVER
// ==========================
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 Backend rodando na porta ${PORT}`);
});