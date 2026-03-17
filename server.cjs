const express = require("express");
const app = express();

app.use(express.static("public"));

// memory store (temporary)
let builders = [];

app.get("/scan", (req, res) => {
  const user = req.query.user;

  // dummy score for now
  const score = Math.floor(Math.random() * 100);

  // store builder
  builders.push({ user, score });

  // sort high to low
  builders.sort((a, b) => b.score - a.score);

  res.json({
    user,
    score,
    builders
  });
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
