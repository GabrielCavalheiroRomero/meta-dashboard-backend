const express = require("express");
const axios = require("axios");
const cors = require("cors");
const cron = require("node-cron");
const { Pool } = require("pg");

const app = express();
app.use(cors());

/* ================================
   🔑 ENV VARIABLES
================================ */
const TOKEN = process.env.TOKEN;
const IG_ID = process.env.IG_ID;
const BASE_URL = "https://graph.facebook.com/v19.0";

/* ================================
   🗄️ DATABASE (POSTGRES - RAILWAY)
================================ */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

/* ================================
   📦 INIT DATABASE
================================ */
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS followers_history (
        id SERIAL PRIMARY KEY,
        date DATE UNIQUE,
        followers INT
      )
    `);

    console.log("✅ Banco conectado e tabela pronta");
  } catch (error) {
    console.log("❌ ERRO DB:", error.message);
  }
}

initDB();

/* ================================
   💾 SAVE FOLLOWERS
================================ */
async function saveFollowersHistory() {
  try {
    if (!TOKEN || !IG_ID) {
      console.log("⚠️ TOKEN ou IG_ID não definidos!");
      return;
    }

    const url = `${BASE_URL}/${IG_ID}?fields=followers_count&access_token=${TOKEN}`;
    const response = await axios.get(url);

    const followers = response.data.followers_count;
    const today = new Date().toISOString().split("T")[0];

    await pool.query(
      `
      INSERT INTO followers_history (date, followers)
      VALUES ($1, $2)
      ON CONFLICT (date) DO NOTHING
      `,
      [today, followers]
    );

    console.log("✅ Followers salvo no banco:", { date: today, followers });

  } catch (error) {
    console.log("❌ ERRO AO SALVAR FOLLOWERS:", error.response?.data || error.message);
  }
}

/* ================================
   ⏰ CRON (1x por dia)
================================ */
cron.schedule("0 23 * * *", () => {
  console.log("⏰ Salvando followers automático...");
  saveFollowersHistory();
});

/* ================================
   🚀 ROTAS
================================ */

// ROOT
app.get("/", (req, res) => {
  res.send("🚀 API Meta Dashboard rodando com sucesso!");
});

/* ================================
   📊 TOTAL
================================ */
app.get("/insights/total", async (req, res) => {
  try {
    const profileUrl = `${BASE_URL}/${IG_ID}/insights?metric=profile_views&period=day&metric_type=total_value&access_token=${TOKEN}`;
    const followersUrl = `${BASE_URL}/${IG_ID}?fields=followers_count&access_token=${TOKEN}`;

    const [profileRes, followersRes] = await Promise.all([
      axios.get(profileUrl),
      axios.get(followersUrl),
    ]);

    res.json({
      profile_views: profileRes.data.data?.[0]?.values?.[0]?.value || 0,
      followers_count: followersRes.data.followers_count || 0,
    });

  } catch (error) {
    console.log("❌ TOTAL ERROR:", error.response?.data || error.message);
    res.json({ profile_views: 0, followers_count: 0 });
  }
});

/* ================================
   📈 DAILY
================================ */
app.get("/insights/daily", async (req, res) => {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const sinceStr = since.toISOString().split("T")[0];
    const untilStr = new Date().toISOString().split("T")[0];

    const url = `${BASE_URL}/${IG_ID}/insights?metric=reach&period=day&since=${sinceStr}&until=${untilStr}&access_token=${TOKEN}`;

    const response = await axios.get(url);

    const reach = response.data.data.find(m => m.name === "reach");

    const result = reach.values.map(item => ({
      date: item.end_time.split("T")[0],
      reach: item.value
    }));

    res.json(result);

  } catch (error) {
    console.log("❌ DAILY ERROR:", error.response?.data || error.message);
    res.json([]);
  }
});

/* ================================
   📸 MEDIA
================================ */
app.get("/media", async (req, res) => {
  try {
    const url = `${BASE_URL}/${IG_ID}/media?fields=id,caption,media_type,media_url,thumbnail_url,like_count,comments_count,timestamp&access_token=${TOKEN}`;

    const response = await axios.get(url);

    const mediaData = await Promise.all(
      response.data.data.map(async (post) => {
        try {
          const insightsUrl = `${BASE_URL}/${post.id}/insights?metric=reach&access_token=${TOKEN}`;
          const insightsRes = await axios.get(insightsUrl);

          return {
            ...post,
            reach: insightsRes.data.data?.[0]?.values?.[0]?.value || 0
          };
        } catch {
          return { ...post, reach: 0 };
        }
      })
    );

    res.json(mediaData);

  } catch (error) {
    console.log("❌ MEDIA ERROR:", error.response?.data || error.message);
    res.json([]);
  }
});

/* ================================
   📊 FOLLOWERS HISTORY (BANCO)
================================ */
app.get("/followers/history", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM followers_history ORDER BY date ASC"
    );
    res.json(result.rows);
  } catch (error) {
    console.log("❌ HISTORY ERROR:", error.message);
    res.json([]);
  }
});

app.get("/test/save-followers", async (req, res) => {
  await saveFollowersHistory();
  res.send("Salvou followers!");
});

/* ================================
   🚀 START SERVER
================================ */
const PORT = process.env.PORT || 3001;

app.listen(PORT, "0.0.0.0", async () => {
  console.log(`🚀 Backend rodando na porta ${PORT}`);

  // salva ao iniciar
  await saveFollowersHistory();
});