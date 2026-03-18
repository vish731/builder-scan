const express = require("express");
const app = express();

app.use(express.static("public"));

let builders = [];

// 👇 ADD THIS
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

app.get("/scan", async (req, res) => {
  const user = req.query.user;

  try {
    const response = await fetch(`https://api.github.com/users/${user}`);
    const data = await response.json();

    const repoRes = await fetch(`https://api.github.com/users/${user}/repos`);
    const reposData = await repoRes.json();

    const goodRepos = reposData.filter(r =>
      r.description &&
      r.description.length > 5 &&
      !r.fork
    );

    const activeRepos = goodRepos.filter(r => {
      const updated = new Date(r.updated_at);
      const diffDays = (Date.now() - updated) / (1000 * 60 * 60 * 24);
      return diffDays < 180;
    });

    const score = Math.min(activeRepos.length, 10) * 10;

    builders.push({ user, score });
    builders.sort((a, b) => b.score - a.score);

    res.json({ user, score, builders });

  } catch (err) {
    res.json({ error: "User not found" });
  }
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
