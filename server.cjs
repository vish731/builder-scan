const express = require("express");
const app = express();

app.use(express.static("public"));

let builders = [];

app.get("/scan", async (req, res) => {
  const user = req.query.user;

  try {
  
    const response = await fetch(`https://api.github.com/users/${user}`);
    const data = await response.json();

    
    const repos = data.public_repos || 0;
    const followers = data.followers || 0;

  
    const score = repos * 5 + followers * 2;

    builders.push({ user, score });
    builders.sort((a, b) => b.score - a.score);

    res.json({
      user,
      score,
      builders
    });

  } catch (err) {
    res.json({ error: "User not found" });
  }
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
