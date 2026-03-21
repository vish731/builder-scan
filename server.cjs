const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;  // Define PORT here

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

let builders = [];

// Main scan endpoint
app.get('/api/scan/:username', async (req, res) => {
  const { username } = req.params;
  
  try {
    console.log(`🔍 Scanning: ${username}`);
    
    // Get user data
    const userRes = await axios.get(`https://api.github.com/users/${username}`);
    const user = userRes.data;
    
    // Get repos
    const reposRes = await axios.get(`https://api.github.com/users/${username}/repos?per_page=100`);
    let repos = reposRes.data;
    
    // Filter out forks
    const originalRepos = repos.filter(r => !r.fork);
    
    // Get commit activity
    const eventsRes = await axios.get(`https://api.github.com/users/${username}/events/public`);
    const events = eventsRes.data;
    
    // Count commits
    let totalCommits = 0;
    let recentCommits = 0;
    const ninetyDaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
    
    events.forEach(event => {
      if (event.type === 'PushEvent') {
        const commitCount = event.payload.size || 0;
        totalCommits += commitCount;
        
        const eventDate = new Date(event.created_at).getTime();
        if (eventDate > ninetyDaysAgo) {
          recentCommits += commitCount;
        }
      }
    });
    
    // Check each repo for actual code
    const repoDetails = [];
    let reposWithCode = 0;
    let totalStars = 0;
    
    for (const repo of originalRepos) {
      totalStars += repo.stargazers_count;
      
      let hasCode = false;
      let fileCount = 0;
      
      try {
        const contentsRes = await axios.get(`https://api.github.com/repos/${username}/${repo.name}/contents`, {
          timeout: 5000
        });
        
        const files = contentsRes.data;
        const codeExtensions = ['.js', '.py', '.java', '.cpp', '.c', '.go', '.rs', '.ts', '.sol', '.rb', '.php', '.html', '.css', '.json', '.jsx', '.tsx'];
        
        const codeFiles = files.filter(file => {
          const ext = path.extname(file.name).toLowerCase();
          const name = file.name.toLowerCase();
          return codeExtensions.includes(ext) && 
                 !name.includes('readme') && 
                 !name.includes('license');
        });
        
        hasCode = codeFiles.length > 0;
        fileCount = codeFiles.length;
        
        if (hasCode) reposWithCode++;
        
        repoDetails.push({
          name: repo.name,
          description: repo.description,
          stars: repo.stargazers_count,
          hasCode: hasCode,
          fileCount: fileCount,
          url: repo.html_url
        });
        
      } catch (err) {
        repoDetails.push({
          name: repo.name,
          description: repo.description,
          stars: repo.stargazers_count,
          hasCode: false,
          fileCount: 0,
          url: repo.html_url
        });
      }
    }
    
    // Calculate score
    let score = 0;
    
    if (reposWithCode >= 5) score += 40;
    else if (reposWithCode >= 3) score += 30;
    else if (reposWithCode >= 1) score += 15;
    
    if (totalCommits >= 100) score += 25;
    else if (totalCommits >= 50) score += 20;
    else if (totalCommits >= 20) score += 15;
    else if (totalCommits >= 5) score += 8;
    else if (totalCommits > 0) score += 3;
    
    if (recentCommits > 10) score += 15;
    else if (recentCommits > 5) score += 10;
    else if (recentCommits > 0) score += 5;
    
    if (totalStars >= 50) score += 15;
    else if (totalStars >= 20) score += 10;
    else if (totalStars >= 5) score += 5;
    else if (totalStars > 0) score += 2;
    
    const accountAgeDays = (Date.now() - new Date(user.created_at)) / (1000 * 60 * 60 * 24);
    if (accountAgeDays > 365) score += 5;
    else if (accountAgeDays > 180) score += 3;
    else if (accountAgeDays > 90) score += 1;
    
    score = Math.min(score, 100);
    
    const isRealBuilder = (reposWithCode >= 1 && totalCommits >= 5) || (totalCommits >= 20);
    
    const builderProfile = {
      username: user.login,
      name: user.name || user.login,
      avatar: user.avatar_url,
      bio: user.bio || '',
      location: user.location || '',
      followers: user.followers,
      following: user.following,
      publicRepos: user.public_repos,
      accountCreated: user.created_at,
      isRealBuilder: isRealBuilder,
      builderScore: score,
      stats: {
        reposWithCode: reposWithCode,
        totalRepos: originalRepos.length,
        totalCommits: totalCommits,
        recentCommits: recentCommits,
        totalStars: totalStars
      },
      repos: repoDetails.slice(0, 10),
      reasons: []
    };
    
    if (reposWithCode > 0) {
      builderProfile.reasons.push(`✅ Has ${reposWithCode} repositories with actual code`);
    } else {
      builderProfile.reasons.push(`❌ No repositories with actual code`);
    }
    
    if (totalCommits > 0) {
      builderProfile.reasons.push(`✅ ${totalCommits} total commits`);
    } else {
      builderProfile.reasons.push(`❌ No commit activity`);
    }
    
    if (recentCommits > 0) {
      builderProfile.reasons.push(`✅ Active in last 90 days (${recentCommits} commits)`);
    }
    
    if (totalStars > 0) {
      builderProfile.reasons.push(`✅ ${totalStars} stars received from community`);
    }
    
    builders.unshift({
      username: user.login,
      score: score,
      isRealBuilder: isRealBuilder,
      timestamp: Date.now()
    });
    builders = builders.slice(0, 20);
    
    console.log(`✅ Score for ${username}: ${score}/100`);
    
    res.json({
      success: true,
      builder: builderProfile,
      leaderboard: builders
    });
    
  } catch (error) {
    console.error('Error:', error.message);
    res.status(404).json({
      success: false,
      error: error.message || 'User not found'
    });
  }
});

app.get('/api/leaderboard', (req, res) => {
  res.json({ success: true, builders });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server - THIS IS THE CORRECT PART
app.listen(PORT, () => {
  console.log(`
  ═══════════════════════════════════════
  🚀 BuilderScan Server Running!
  📡 http://localhost:${PORT}
  🔍 Try scanning: vish731
  ═══════════════════════════════════════
  `);
});
