const express = require("express");
const axios = require("axios");
const cors = require("cors");
const fs = require("fs");
const cron = require("node-cron");

const app = express();
app.use(cors());

// ==========================
// 🔐 CONFIG
// ==========================
const TOKEN = "EAAKTGz6dC4kBRErOZCGoGbIvdp6a5zywWGvzlscz5jMdWD9Ui8fZC7OI7WwL5SbyEGnST7WXazRD1En84xh7B49Ii3gTaz5w1pva6mnY6TBdWT4kJ2mYZB7nZATtoZCC8DxAUT4hj1AUE6Wy3PjfkOipICGW1rEDfqNZCZA4Yo3eA9xBpm5ZCXs875ykKGMy5dMFlnbzYpj4nuaJZC7o5YLmsi0srjVgZCaLPSGcj5eqULr3JRfJQyqBL1kUHmrQRlmnRZBEnBm48zOZBbZBnt1jyYRtkkchO"; // ⚠️ depois vamos mover isso pra variável de ambiente
const IG_ID = "17841449359330655";
const BASE_URL = "https://graph.facebook.com/v25.0";

const HISTORY_FILE = "./followers-history.json";

// ==========================
// 📁 GARANTE ARQUIVO
// ==========================
if (!fs.existsSync(HISTORY_FILE)) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify([]));
}

// ==========================
// 💾 SALVAR FOLLOWERS
// ==========================
async function saveFollowersHistory() {
  try {
    const url = `${BASE_URL}/${IG_ID}?fields=followers_count&access_token=${TOKEN}`;
    const response = await axios.get(url);

    const followers = response.data.followers_count;
    const today = new Date().toISOString().split("T")[0];

    const history = JSON.parse(fs.readFileSync(HISTORY_FILE));

    const alreadyExists = history.find(h => h.date === today);

    if (!alreadyExists) {
      history.push({ date: today, followers });
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
      console.log("✅ Followers salvo:", { date: today, followers });
    }

  } catch (error) {
    console.log("❌ ERRO AO SALVAR FOLLOWERS:", error.response?.data || error.message);
  }
}

// ==========================
// ⏰ CRON (1x por dia)
// ==========================
cron.schedule("0 0 * * *", () => {
  console.log("⏰ Rodando coleta diária...");
  saveFollowersHistory();
});

// roda ao iniciar
saveFollowersHistory();

// ==========================
// 🏠 ROTA ROOT (MELHORIA 🔥)
// ==========================
app.get("/", (req, res) => {
  res.send("🚀 API Meta Dashboard rodando com sucesso!");
});

// ==========================
// 📊 DAILY (30 dias)
// ==========================
app.get("/insights/daily", async (req, res) => {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const sinceStr = since.toISOString().split("T")[0];
    const untilStr = new Date().toISOString().split("T")[0];

    const url = `${BASE_URL}/${IG_ID}/insights?metric=reach&period=day&since=${sinceStr}&until=${untilStr}&access_token=${TOKEN}`;

    const response = await axios.get(url);

    const reachData = response.data.data.find(m => m.name === "reach");

    const result = reachData?.values?.map(v => ({
      date: v.end_time.split("T")[0],
      reach: v.value
    })) || [];

    res.json(result);

  } catch (error) {
    console.log("❌ DAILY ERROR:", error.response?.data || error.message);
    res.json([]);
  }
});

// ==========================
// 📈 TOTAL
// ==========================
app.get("/insights/total", async (req, res) => {
  try {
    const profileUrl = `${BASE_URL}/${IG_ID}/insights?metric=profile_views&period=day&metric_type=total_value&access_token=${TOKEN}`;
    const followersUrl = `${BASE_URL}/${IG_ID}?fields=followers_count&access_token=${TOKEN}`;

    const [profileRes, followersRes] = await Promise.all([
      axios.get(profileUrl),
      axios.get(followersUrl),
    ]);

    res.json({
      profile_views: profileRes.data?.data?.[0]?.total_value?.value ?? 0,
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
// 📱 MEDIA
// ==========================
app.get("/media", async (req, res) => {
  try {
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
        } catch (err) {
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
// 🚀 START SERVER (FIX RAILWAY)
// ==========================
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 Backend rodando na porta ${PORT}`);
});