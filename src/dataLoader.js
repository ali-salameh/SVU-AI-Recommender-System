const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function loadExcel(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: null });
}

function loadDataset(dataDir) {
  const users = loadExcel(path.join(dataDir, "users.xlsx")).map((row) => ({
    user_id: toNumber(row.user_id),
    age: toNumber(row.age),
    country: row.country || row.location || "Unknown",
  }));

  const products = loadExcel(path.join(dataDir, "products.xlsx")).map((row) => ({
    product_id: toNumber(row.product_id),
    category: row.category || "Unknown",
    price: toNumber(row.price),
  }));

  const ratings = loadExcel(path.join(dataDir, "ratings.xlsx")).map((row) => ({
    user_id: toNumber(row.user_id),
    product_id: toNumber(row.product_id),
    rating: toNumber(row.rating),
  }));

  let behaviorFile = path.join(dataDir, "behavior.xlsx");
  if (!fs.existsSync(behaviorFile)) {
    behaviorFile = path.join(dataDir, "behavior_15500.xlsx");
  }

  const behavior = loadExcel(behaviorFile).map((row) => ({
    user_id: toNumber(row.user_id),
    product_id: toNumber(row.product_id),
    viewed: toNumber(row.viewed),
    clicked: toNumber(row.clicked),
    purchased: toNumber(row.purchased),
  }));

  const userById = new Map(users.map((u) => [u.user_id, u]));
  const productById = new Map(products.map((p) => [p.product_id, p]));
  const categories = [...new Set(products.map((p) => p.category))];

  const userRatings = new Map();
  for (const r of ratings) {
    if (!userRatings.has(r.user_id)) {
      userRatings.set(r.user_id, new Map());
    }
    userRatings.get(r.user_id).set(r.product_id, r.rating);
  }

  const userBehavior = new Map();
  for (const b of behavior) {
    if (!userBehavior.has(b.user_id)) {
      userBehavior.set(b.user_id, new Map());
    }
    userBehavior.get(b.user_id).set(b.product_id, {
      viewed: b.viewed,
      clicked: b.clicked,
      purchased: b.purchased,
    });
  }

  const productStats = new Map();
  for (const p of products) {
    productStats.set(p.product_id, {
      views: 0,
      clicks: 0,
      purchases: 0,
      ratingSum: 0,
      ratingCount: 0,
    });
  }

  for (const b of behavior) {
    const stat = productStats.get(b.product_id);
    if (!stat) continue;
    stat.views += b.viewed ? 1 : 0;
    stat.clicks += b.clicked ? 1 : 0;
    stat.purchases += b.purchased ? 1 : 0;
  }

  for (const r of ratings) {
    const stat = productStats.get(r.product_id);
    if (!stat) continue;
    stat.ratingSum += r.rating;
    stat.ratingCount += 1;
  }

  let minPrice = Number.POSITIVE_INFINITY;
  let maxPrice = 0;
  let totalPrice = 0;
  for (const p of products) {
    minPrice = Math.min(minPrice, p.price);
    maxPrice = Math.max(maxPrice, p.price);
    totalPrice += p.price;
  }
  const avgPrice = products.length ? totalPrice / products.length : 0;

  return {
    users,
    products,
    ratings,
    behavior,
    categories,
    userById,
    productById,
    userRatings,
    userBehavior,
    productStats,
    stats: {
      userCount: users.length,
      productCount: products.length,
      ratingCount: ratings.length,
      behaviorCount: behavior.length,
      minPrice: Number.isFinite(minPrice) ? minPrice : 0,
      maxPrice,
      avgPrice,
    },
  };
}

module.exports = { loadDataset };

