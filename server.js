const path = require("path");
const express = require("express");
const { loadDataset } = require("./src/dataLoader");
const { GeneticRecommender } = require("./src/recommender");

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = path.join(__dirname, "data_new");

const dataset = loadDataset(DATA_DIR);
const recommender = new GeneticRecommender(dataset);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", dataset: dataset.stats });
});

app.get("/api/summary", (_req, res) => {
  const categoryCounts = {};
  for (const p of dataset.products) {
    categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
  }
  res.json({
    dataset: dataset.stats,
    categories: categoryCounts,
    question1:
      "تحسين التوصيات يعني رفع جودة اقتراحات المنتجات بحيث تتناسب أكثر مع سلوك واهتمامات المستخدم وتزيد النقر والشراء.",
    question2:
      "الخوارزمية الجينية تولّد مجموعات توصيات متعددة وتُقيّمها، ثم تنتقي الأفضل وتدمجها وتُجري طفرات للوصول إلى قائمة توصيات أكثر كفاءة.",
  });
});

app.get("/api/users", (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit || 100), 1000));
  const users = dataset.users.slice(0, limit).map((u) => ({
    user_id: u.user_id,
    age: u.age,
    country: u.country,
  }));
  res.json({ users, total: dataset.users.length });
});

app.get("/api/recommendations/:userId", (req, res) => {
  try {
    const userId = Number(req.params.userId);
    const limit = Math.max(1, Math.min(Number(req.query.limit || 10), 20));
    const output = recommender.recommend(userId, limit);
    res.json(output);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`Smart recommendation app running on http://${HOST}:${PORT}`);
});
