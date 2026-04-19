const express = require("express");
const axios = require("axios");
const cors = require("cors");
const cron = require("node-cron");
const { Pool } = require("pg");

const app = express();
app.use(cors());

const TOKEN = process.env.TOKEN;
const IG_ID = process.env.IG_ID;
const BASE_URL = "https://graph.facebook.com/v19.0";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const todayBrasilia = () => {
  const now = new Date();
  now.setHours(now.getHours() - 3);
  return now.toISOString().split("T")[0];
};

async function initDB() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS followers_history (id SERIAL PRIMARY KEY, date DATE UNIQUE, followers INT)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS metrics_history (id SERIAL PRIMARY KEY, date DATE UNIQUE, reach INT DEFAULT 0, profile_views INT DEFAULT 0, impressions INT DEFAULT 0)`);
    console.log("✅ Banco conectado e tabelas prontas");
  } catch (error) {
    console.log("❌ ERRO DB:", error.message);
  }
}
initDB();

async function saveFollowersHistory() {
  try {
    if (!TOKEN || !IG_ID) return;
    const url = `${BASE_URL}/${IG_ID}?fields=followers_count&access_token=${TOKEN}`;
    const response = await axios.get(url);
    const followers = response.data.followers_count;
    const today = todayBrasilia();
    await pool.query(`INSERT INTO followers_history (date, followers) VALUES ($1, $2) ON CONFLICT (date) DO UPDATE SET followers = $2`, [today, followers]);
    console.log("✅ Followers salvo:", { date: today, followers });
  } catch (error) {
    console.log("❌ ERRO AO SALVAR FOLLOWERS:", error.response?.data || error.message);
  }
}

async function saveMetricsHistory() {
  try {
    if (!TOKEN || !IG_ID) return;
    const until = Math.floor(Date.now() / 1000) - 86400;
    const since = until - 86400;
    const today = todayBrasilia();

    const [reachRes, profileRes, viewsRes] = await Promise.allSettled([
      axios.get(`${BASE_URL}/${IG_ID}/insights?metric=reach&period=day&since=${since}&until=${until}&access_token=${TOKEN}`),
      axios.get(`${BASE_URL}/${IG_ID}/insights?metric=profile_views&period=day&metric_type=total_value&since=${since}&until=${until}&access_token=${TOKEN}`),
      axios.get(`${BASE_URL}/${IG_ID}/insights?metric=views&period=day&metric_type=total_value&access_token=${TOKEN}`),
    ]);

    const reach        = reachRes.status === "fulfilled"   ? reachRes.value.data.data?.find(m => m.name === "reach")?.values?.slice(-1)[0]?.value ?? 0 : 0;
    const profileViews = profileRes.status === "fulfilled" ? profileRes.value.data.data?.[0]?.total_value?.value ?? 0 : 0;
    const impressions  = viewsRes.status === "fulfilled"   ? viewsRes.value.data.data?.[0]?.total_value?.value ?? 0 : 0;

    await pool.query(`INSERT INTO metrics_history (date, reach, profile_views, impressions) VALUES ($1, $2, $3, $4) ON CONFLICT (date) DO UPDATE SET reach = $2, profile_views = $3, impressions = $4`, [today, reach, profileViews, impressions]);
    console.log("✅ Métricas salvas:", { date: today, reach, profileViews, impressions });
  } catch (error) {
    console.log("❌ ERRO AO SALVAR MÉTRICAS:", error.message);
  }
}

cron.schedule("0 23 * * *", () => {
  console.log("⏰ Salvando dados automático...");
  saveFollowersHistory();
  saveMetricsHistory();
});

/* ================================ ROTAS ================================ */

app.get("/", (req, res) => res.send("🚀 API Meta Dashboard rodando com sucesso!"));

app.get("/insights/total", async (req, res) => {
  try {
    const until = Math.floor(Date.now() / 1000) - 86400;
    const since = until - 86400;
    const [profileRes, viewsRes, followersRes] = await Promise.all([
      axios.get(`${BASE_URL}/${IG_ID}/insights?metric=profile_views&period=day&metric_type=total_value&since=${since}&until=${until}&access_token=${TOKEN}`),
      axios.get(`${BASE_URL}/${IG_ID}/insights?metric=views&period=day&metric_type=total_value&access_token=${TOKEN}`),
      axios.get(`${BASE_URL}/${IG_ID}?fields=followers_count,username&access_token=${TOKEN}`),
    ]);
    res.json({
      profile_views:   profileRes.data.data?.[0]?.total_value?.value ?? 0,
      followers_count: followersRes.data.followers_count || 0,
      impressions:     viewsRes.data.data?.[0]?.total_value?.value ?? 0,
      username:        followersRes.data.username || "",
    });
  } catch (error) {
    console.log("❌ TOTAL ERROR:", error.response?.data || error.message);
    res.json({ profile_views: 0, followers_count: 0, impressions: 0, username: "" });
  }
});

app.get("/insights/daily", async (req, res) => {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const url = `${BASE_URL}/${IG_ID}/insights?metric=reach&period=day&since=${since.toISOString().split("T")[0]}&until=${new Date().toISOString().split("T")[0]}&access_token=${TOKEN}`;
    const response = await axios.get(url);
    const reach = response.data.data.find(m => m.name === "reach");
    res.json(reach.values.map(item => ({ date: item.end_time.split("T")[0], reach: item.value })));
  } catch (error) {
    console.log("❌ DAILY ERROR:", error.response?.data || error.message);
    res.json([]);
  }
});

app.get("/insights/today", async (req, res) => {
  try {
    const today = todayBrasilia();
    const until = Math.floor(Date.now() / 1000);
    const since = until - 86400;
    const [reachRes, viewsRes, followersRes] = await Promise.allSettled([
      axios.get(`${BASE_URL}/${IG_ID}/insights?metric=reach&period=day&since=${since}&until=${until}&access_token=${TOKEN}`),
      axios.get(`${BASE_URL}/${IG_ID}/insights?metric=views&period=day&metric_type=total_value&access_token=${TOKEN}`),
      axios.get(`${BASE_URL}/${IG_ID}?fields=followers_count&access_token=${TOKEN}`),
    ]);
    res.json({
      date:           today,
      reach:          reachRes.status === "fulfilled"     ? reachRes.value.data.data?.find(m => m.name === "reach")?.values?.slice(-1)[0]?.value ?? 0 : 0,
      impressions:    viewsRes.status === "fulfilled"     ? viewsRes.value.data.data?.[0]?.total_value?.value ?? 0 : 0,
      followers_count:followersRes.status === "fulfilled" ? followersRes.value.data.followers_count ?? 0 : 0,
      partial: true,
    });
  } catch (error) {
    console.log("❌ TODAY ERROR:", error.response?.data || error.message);
    res.json({ date: todayBrasilia(), reach: 0, impressions: 0, followers_count: 0, partial: true });
  }
});

/* ================================
   📊 DEMOGRAPHICS
================================ */
app.get("/insights/demographics", async (req, res) => {
  try {
    const breakdowns = ["age", "gender", "city", "country"];

    const results = await Promise.allSettled(
      breakdowns.map(b =>
        axios.get(`${BASE_URL}/${IG_ID}/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=${b}&access_token=${TOKEN}`)
      )
    );

    const parse = (res, index) => {
      if (res.status !== "fulfilled") return [];
      const breakdownData = res.value.data.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [];
      return breakdownData.map(r => ({ label: r.dimension_values[0], value: r.value }));
    };

    res.json({
      age:     parse(results[0]),
      gender:  parse(results[1]),
      city:    parse(results[2]).sort((a, b) => b.value - a.value).slice(0, 10),
      country: parse(results[3]).sort((a, b) => b.value - a.value),
    });
  } catch (error) {
    console.log("❌ DEMOGRAPHICS ERROR:", error.response?.data || error.message);
    res.json({ age: [], gender: [], city: [], country: [] });
  }
});

app.get("/metrics/history", async (req, res) => {
  try {
    const result = await pool.query(`SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date, reach, profile_views, impressions FROM metrics_history ORDER BY date ASC`);
    res.json(result.rows);
  } catch (error) {
    console.log("❌ METRICS HISTORY ERROR:", error.message);
    res.json([]);
  }
});

app.get("/media", async (req, res) => {
  try {
    const url = `${BASE_URL}/${IG_ID}/media?fields=id,caption,media_type,media_url,thumbnail_url,like_count,comments_count,timestamp&access_token=${TOKEN}`;
    const response = await axios.get(url);
    const mediaData = await Promise.all(
      response.data.data.map(async (post) => {
        try {
          const insightsRes = await axios.get(`${BASE_URL}/${post.id}/insights?metric=reach&access_token=${TOKEN}`);
          return { ...post, reach: insightsRes.data.data?.[0]?.values?.[0]?.value || 0 };
        } catch { return { ...post, reach: 0 }; }
      })
    );
    res.json(mediaData);
  } catch (error) {
    console.log("❌ MEDIA ERROR:", error.response?.data || error.message);
    res.json([]);
  }
});

app.get("/followers/history", async (req, res) => {
  try {
    const result = await pool.query(`SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date, followers FROM followers_history ORDER BY date ASC`);
    res.json(result.rows);
  } catch (error) {
    console.log("❌ HISTORY ERROR:", error.message);
    res.json([]);
  }
});

app.get("/test/save-followers", async (req, res) => { await saveFollowersHistory(); res.send("✅ Followers salvo!"); });
app.get("/test/save-metrics",   async (req, res) => { await saveMetricsHistory();   res.send("✅ Métricas salvas!"); });

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", async () => {
  console.log(`🚀 Backend rodando na porta ${PORT}`);
  await saveFollowersHistory();
  await saveMetricsHistory();
});