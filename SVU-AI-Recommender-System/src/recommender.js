function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

class GeneticRecommender {
  constructor(dataset, options = {}) {
    this.dataset = dataset;
    this.options = {
      populationSize: options.populationSize || 36,
      generations: options.generations || 24,
      mutationRate: options.mutationRate || 0.22,
      tournamentSize: options.tournamentSize || 3,
    };
    this.userProfiles = this.buildUserProfiles();
    this.scoreCache = new Map();
  }

  buildUserProfiles() {
    const profiles = new Map();
    const {
      users,
      products,
      userBehavior,
      userRatings,
      productById,
      categories,
      stats,
    } = this.dataset;

    const categoryIndex = new Map(categories.map((c, idx) => [c, idx]));

    for (const user of users) {
      const behaviorMap = userBehavior.get(user.user_id) || new Map();
      const ratingsMap = userRatings.get(user.user_id) || new Map();

      const affinity = new Array(categories.length).fill(0);
      const seenProducts = new Set();
      const purchasedProducts = new Set();
      let weightedPriceSum = 0;
      let weightSum = 0;

      for (const [productId, b] of behaviorMap.entries()) {
        const product = productById.get(productId);
        if (!product) continue;
        const ci = categoryIndex.get(product.category);
        if (typeof ci === "number") {
          const behaviorWeight = b.viewed * 0.3 + b.clicked * 1.0 + b.purchased * 2.0;
          affinity[ci] += behaviorWeight;
          seenProducts.add(productId);
          if (b.purchased) purchasedProducts.add(productId);
          if (behaviorWeight > 0) {
            weightedPriceSum += product.price * behaviorWeight;
            weightSum += behaviorWeight;
          }
        }
      }

      for (const [productId, rating] of ratingsMap.entries()) {
        const product = productById.get(productId);
        if (!product) continue;
        const ci = categoryIndex.get(product.category);
        if (typeof ci === "number") {
          const ratingWeight = (rating / 5) * 2;
          affinity[ci] += ratingWeight;
          seenProducts.add(productId);
          if (rating >= 4) {
            weightedPriceSum += product.price * ratingWeight;
            weightSum += ratingWeight;
          }
        }
      }

      const maxAffinity = Math.max(...affinity, 1);
      const normalizedAffinity = affinity.map((v) => v / maxAffinity);
      const preferredPrice = weightSum > 0 ? weightedPriceSum / weightSum : stats.avgPrice;

      profiles.set(user.user_id, {
        normalizedAffinity,
        categoryIndex,
        preferredPrice,
        seenProducts,
        purchasedProducts,
      });
    }

    for (const user of users) {
      if (!profiles.has(user.user_id)) {
        profiles.set(user.user_id, {
          normalizedAffinity: new Array(this.dataset.categories.length).fill(0),
          categoryIndex,
          preferredPrice: stats.avgPrice,
          seenProducts: new Set(),
          purchasedProducts: new Set(),
        });
      }
    }

    if (products.length === 0) {
      throw new Error("No products found in dataset.");
    }

    return profiles;
  }

  productQualityScore(productId) {
    const stat = this.dataset.productStats.get(productId);
    if (!stat) return 0;
    const avgRating = stat.ratingCount ? stat.ratingSum / stat.ratingCount : 0;
    const ratingSignal = avgRating / 5;
    const ctr = stat.views ? stat.clicks / stat.views : 0;
    const purchaseRate = stat.views ? stat.purchases / stat.views : 0;
    return clamp(ratingSignal * 0.5 + ctr * 0.25 + purchaseRate * 0.25, 0, 1);
  }

  userProductScore(userId, productId) {
    const cacheKey = `${userId}:${productId}`;
    if (this.scoreCache.has(cacheKey)) {
      return this.scoreCache.get(cacheKey);
    }

    const product = this.dataset.productById.get(productId);
    const profile = this.userProfiles.get(userId);
    if (!product || !profile) return 0;

    const categoryIdx = profile.categoryIndex.get(product.category);
    const categoryAffinity =
      typeof categoryIdx === "number" ? profile.normalizedAffinity[categoryIdx] : 0;
    const quality = this.productQualityScore(productId);

    const priceRange = Math.max(1, this.dataset.stats.maxPrice - this.dataset.stats.minPrice);
    const priceDistance = Math.abs(product.price - profile.preferredPrice) / priceRange;
    const priceScore = clamp(1 - priceDistance, 0, 1);

    const seenPenalty = profile.seenProducts.has(productId) ? 0.06 : 0;
    const purchasedPenalty = profile.purchasedProducts.has(productId) ? 0.25 : 0;

    const score =
      categoryAffinity * 0.42 + quality * 0.33 + priceScore * 0.25 - seenPenalty - purchasedPenalty;

    const normalized = clamp(score, 0, 1);
    this.scoreCache.set(cacheKey, normalized);
    return normalized;
  }

  getCandidateProducts(userId) {
    const profile = this.userProfiles.get(userId);
    if (!profile) return [];
    return this.dataset.products.filter((p) => !profile.purchasedProducts.has(p.product_id));
  }

  evaluateChromosome(userId, genes) {
    if (genes.length === 0) return 0;
    const profile = this.userProfiles.get(userId);
    let relevanceSum = 0;
    let priceMatchSum = 0;
    const categories = new Set();
    let unseenCount = 0;
    const range = Math.max(1, this.dataset.stats.maxPrice - this.dataset.stats.minPrice);

    for (const productId of genes) {
      const p = this.dataset.productById.get(productId);
      if (!p) continue;
      relevanceSum += this.userProductScore(userId, productId);
      categories.add(p.category);
      const priceDist = Math.abs(p.price - profile.preferredPrice) / range;
      priceMatchSum += clamp(1 - priceDist, 0, 1);
      if (!profile.seenProducts.has(productId)) {
        unseenCount += 1;
      }
    }

    const length = Math.max(1, genes.length);
    const relevance = relevanceSum / length;
    const diversity = categories.size / length;
    const priceMatch = priceMatchSum / length;
    const novelty = unseenCount / length;

    return relevance * 0.58 + diversity * 0.22 + priceMatch * 0.12 + novelty * 0.08;
  }

  topBaseline(userId, candidates, size) {
    const sorted = [...candidates].sort(
      (a, b) => this.userProductScore(userId, b.product_id) - this.userProductScore(userId, a.product_id)
    );
    return sorted.slice(0, size).map((p) => p.product_id);
  }

  weightedUniqueSample(candidates, size, userId) {
    const pool = [...candidates];
    const chosen = [];
    while (chosen.length < size && pool.length > 0) {
      let totalWeight = 0;
      for (const p of pool) {
        totalWeight += this.userProductScore(userId, p.product_id) + 0.05;
      }
      let target = Math.random() * totalWeight;
      let idx = 0;
      for (let i = 0; i < pool.length; i += 1) {
        target -= this.userProductScore(userId, pool[i].product_id) + 0.05;
        if (target <= 0) {
          idx = i;
          break;
        }
      }
      chosen.push(pool[idx].product_id);
      pool.splice(idx, 1);
    }
    return chosen;
  }

  select(population, userId) {
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < this.options.tournamentSize; i += 1) {
      const candidate = population[randomInt(population.length)];
      const score = this.evaluateChromosome(userId, candidate);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return [...best];
  }

  crossover(parentA, parentB, targetSize, candidateIds, userId) {
    if (targetSize <= 1) return [parentA[0]];
    const cut = 1 + randomInt(targetSize - 1);
    const child = [];
    const used = new Set();

    for (let i = 0; i < cut && i < parentA.length; i += 1) {
      if (!used.has(parentA[i])) {
        child.push(parentA[i]);
        used.add(parentA[i]);
      }
    }
    for (const gene of parentB) {
      if (!used.has(gene) && child.length < targetSize) {
        child.push(gene);
        used.add(gene);
      }
    }

    while (child.length < targetSize) {
      const sampled = this.weightedUniqueSample(
        candidateIds
          .filter((id) => !used.has(id))
          .map((id) => this.dataset.productById.get(id))
          .filter(Boolean),
        1,
        userId
      );
      if (sampled.length === 0) break;
      child.push(sampled[0]);
      used.add(sampled[0]);
    }
    return child;
  }

  mutate(chromosome, candidateIds, userId) {
    if (Math.random() > this.options.mutationRate || chromosome.length === 0) {
      return chromosome;
    }
    const used = new Set(chromosome);
    const available = candidateIds
      .filter((id) => !used.has(id))
      .map((id) => this.dataset.productById.get(id))
      .filter(Boolean);
    if (available.length === 0) return chromosome;
    const [newGene] = this.weightedUniqueSample(available, 1, userId);
    if (!newGene) return chromosome;
    const idx = randomInt(chromosome.length);
    chromosome[idx] = newGene;
    return chromosome;
  }

  runGA(userId, candidates, size) {
    const candidateIds = candidates.map((p) => p.product_id);
    const population = [];
    const baseline = this.topBaseline(userId, candidates, size);
    population.push(baseline);

    while (population.length < this.options.populationSize) {
      population.push(this.weightedUniqueSample(candidates, size, userId));
    }

    for (let g = 0; g < this.options.generations; g += 1) {
      const next = [];
      const elite = [...population].sort(
        (a, b) => this.evaluateChromosome(userId, b) - this.evaluateChromosome(userId, a)
      )[0];
      next.push([...elite]);

      while (next.length < this.options.populationSize) {
        const p1 = this.select(population, userId);
        const p2 = this.select(population, userId);
        let child = this.crossover(p1, p2, size, candidateIds, userId);
        child = this.mutate(child, candidateIds, userId);
        next.push(child);
      }
      population.splice(0, population.length, ...next);
    }

    const best = [...population].sort(
      (a, b) => this.evaluateChromosome(userId, b) - this.evaluateChromosome(userId, a)
    )[0];
    return best;
  }

  explainScore(userId, productId) {
    const product = this.dataset.productById.get(productId);
    const profile = this.userProfiles.get(userId);
    const categoryIdx = profile.categoryIndex.get(product.category);
    const categoryAffinity =
      typeof categoryIdx === "number" ? profile.normalizedAffinity[categoryIdx] : 0;
    const quality = this.productQualityScore(productId);
    const priceRange = Math.max(1, this.dataset.stats.maxPrice - this.dataset.stats.minPrice);
    const priceScore = clamp(
      1 - Math.abs(product.price - profile.preferredPrice) / priceRange,
      0,
      1
    );
    return {
      categoryAffinity: Number(categoryAffinity.toFixed(3)),
      productQuality: Number(quality.toFixed(3)),
      priceMatch: Number(priceScore.toFixed(3)),
      totalScore: Number(this.userProductScore(userId, productId).toFixed(3)),
    };
  }

  recommend(userId, limit = 10) {
    const user = this.dataset.userById.get(userId);
    if (!user) {
      throw new Error(`User ${userId} not found.`);
    }
    const size = Math.max(1, Math.min(limit, 20));
    const candidates = this.getCandidateProducts(userId);
    if (candidates.length === 0) {
      return {
        user,
        baseline: [],
        optimized: [],
        metrics: {
          baselineFitness: 0,
          optimizedFitness: 0,
          estimatedLiftPercent: 0,
        },
      };
    }

    const baselineGenes = this.topBaseline(userId, candidates, size);
    const optimizedGenes = this.runGA(userId, candidates, size);

    const baselineFitness = this.evaluateChromosome(userId, baselineGenes);
    const optimizedFitness = this.evaluateChromosome(userId, optimizedGenes);
    const lift =
      baselineFitness > 0 ? ((optimizedFitness - baselineFitness) / baselineFitness) * 100 : 0;

    const toRows = (genes) =>
      genes.map((productId, index) => {
        const p = this.dataset.productById.get(productId);
        return {
          rank: index + 1,
          product_id: productId,
          category: p.category,
          price: p.price,
          breakdown: this.explainScore(userId, productId),
        };
      });

    return {
      user,
      baseline: toRows(baselineGenes),
      optimized: toRows(optimizedGenes),
      metrics: {
        baselineFitness: Number(baselineFitness.toFixed(4)),
        optimizedFitness: Number(optimizedFitness.toFixed(4)),
        estimatedLiftPercent: Number(lift.toFixed(2)),
      },
      gaConfig: this.options,
    };
  }
}

module.exports = { GeneticRecommender };

