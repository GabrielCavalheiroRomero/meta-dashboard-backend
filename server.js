const express = require("express");
const axios = require("axios");
const cors = require("cors");
const fs = require("fs");
const cron = require("node-cron");

const app = express();
app.use(cors());

const TOKEN = "EAAKTGz6dC4kBRD2rDzZAt95CET4Tji0ZAPqxuGSn9MpkhyBAzUNxqTmSzTo1x5ymtHQqVsf84hs2PJqsCTtlmvXivRQhpwABpHZB4TQg4XX6Jz82Xwz8x2XG9MKOV2xAOKoBC3tA6sGUyKnfTLcozevksTrmIKYQWOMzUzExVjRcbAKcY1CzrNVzBlz";
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

// roda também ao iniciar
saveFollowersHistory();

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
// 📉 FOLLOWERS HISTORY (NOVO 🔥)
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
app.listen(3001, () => {
  console.log("🚀 Backend rodando em http://localhost:3001");
});