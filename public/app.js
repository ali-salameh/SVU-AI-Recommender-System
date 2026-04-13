async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || "Request failed");
  }
  return res.json();
}

function renderRows(rows) {
  const tbody = document.getElementById("resultsBody");
  tbody.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.rank}</td>
      <td>${row.product_id}</td>
      <td>${row.category}</td>
      <td>${row.price}</td>
      <td>${row.breakdown.totalScore}</td>
      <td>${row.breakdown.categoryAffinity}</td>
      <td>${row.breakdown.productQuality}</td>
      <td>${row.breakdown.priceMatch}</td>
    `;
    tbody.appendChild(tr);
  }
}

async function init() {
  const userSelect = document.getElementById("userSelect");
  const runBtn = document.getElementById("runBtn");
  const limitInput = document.getElementById("limitInput");

  const summary = await getJson("/api/summary");
  document.getElementById("q1").textContent = summary.question1;
  document.getElementById("q2").textContent = summary.question2;

  const usersResponse = await getJson("/api/users?limit=300");
  for (const u of usersResponse.users) {
    const opt = document.createElement("option");
    opt.value = u.user_id;
    opt.textContent = `User ${u.user_id} | العمر ${u.age} | ${u.country}`;
    userSelect.appendChild(opt);
  }

  const run = async () => {
    runBtn.disabled = true;
    runBtn.textContent = "جارٍ التنفيذ...";
    try {
      const userId = userSelect.value;
      const limit = Number(limitInput.value || 10);
      const data = await getJson(`/api/recommendations/${userId}?limit=${limit}`);
      document.getElementById("baselineFitness").textContent = data.metrics.baselineFitness;
      document.getElementById("gaFitness").textContent = data.metrics.optimizedFitness;
      document.getElementById("lift").textContent = `${data.metrics.estimatedLiftPercent}%`;
      renderRows(data.optimized);
    } catch (error) {
      alert(error.message);
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = "توليد توصيات محسّنة";
    }
  };

  runBtn.addEventListener("click", run);
  if (userSelect.value) {
    run();
  }
}

init().catch((e) => {
  alert(e.message);
});

