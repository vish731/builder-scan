const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

let builders = [];

// ============ BUILDER TIERS ============
const getBuilderTier = (score) => {
  if (score >= 75) {
    return {
      name: "🏆 LEGENDARY BUILDER",
      emoji: "👑",
      color: "#00b894",
      description: "Elite developer - consistently shipping high-quality code"
    };
  } else if (score >= 50) {
    return {
      name: "⚡ PRO BUILDER",
      emoji: "🚀",
      color: "#3498db",
      description: "Serious contributor - active and skilled"
    };
  } else if (score >= 25) {
    return {
      name: "🌱 RISING BUILDER",
      emoji: "📈",
      color: "#f39c12",
      description: "Getting started - showing potential"
    };
  } else {
    return {
      name: "👻 GHOST BUILDER",
      emoji: "💀",
      color: "#95a5a6",
      description: "Inactive or spam activity detected"
    };
  }
};

// ============ DETECT SPAM REPOS ============
const isSpamRepo = (repoName, description, files) => {
  const spamKeywords = ['hello', 'test', 'demo', 'sample', 'practice', 'learning', 'tutorial', 'hii', 'hi', 'temp', 'testing', 'playground'];
  const lowerName = repoName.toLowerCase();
  const lowerDesc = (description || '').toLowerCase();
  
  // Check repo name for spam
  if (spamKeywords.some(keyword => lowerName.includes(keyword))) {
    return { isSpam: true, reason: 'Spam repo name' };
  }
  
  // Check description
  if (lowerDesc && spamKeywords.some(keyword => lowerDesc.includes(keyword))) {
    return { isSpam: true, reason: 'Spam description' };
  }
  
  // Check if repo has actual code files
  if (files && files.length > 0) {
    const hasRealCode = files.some(file => {
      const ext = path.extname(file.name).toLowerCase();
      const name = file.name.toLowerCase();
      const codeExtensions = ['.js', '.py', '.java', '.cpp', '.c', '.go', '.rs', '.ts', '.sol', '.rb', '.php', '.jsx', '.tsx', '.vue', '.swift', '.kt', '.cs'];
      
      // Ignore README, LICENSE, .gitignore
      if (name.includes('readme') || name.includes('license') || name.includes('.gitignore')) {
        return false;
      }
      
      return codeExtensions.includes(ext);
    });
    
    if (!hasRealCode) {
      return { isSpam: true, reason: 'No real code files (only README/docs)' };
    }
  }
  
  return { isSpam: false };
};

// ============ DETECT SPAM COMMITS ============
const isSpamCommit = (commitMessage) => {
  const spamMessages = ['test', 'update', 'fix', 'wip', 'temp', 'demo', 'hello', 'hii', 'asd', '123', 'remove', 'delete', 'initial commit', 'first commit'];
  const lowerMsg = commitMessage.toLowerCase();
  
  // Check if commit message is spammy
  if (lowerMsg.length < 3) return true;
  if (spamMessages.some(spam => lowerMsg === spam)) return true;
  if (spamMessages.some(spam => lowerMsg.includes(spam) && lowerMsg.length < 10)) return true;
  
  return false;
};

// ============ GET MEANINGFUL COMMITS ============
async function getMeaningfulCommits(username, repo) {
  try {
    const commitsRes = await axios.get(
      `https://api.github.com/repos/${username}/${repo.name}/commits?author=${username}&per_page=100`,
      { timeout: 10000 }
    );
    
    let meaningfulCommits = 0;
    let spamCommits = 0;
    
    for (const commit of commitsRes.data) {
      const message = commit.commit.message;
      const isSpam = isSpamCommit(message);
      
      if (!isSpam) {
        meaningfulCommits++;
      } else {
        spamCommits++;
      }
    }
    
    return { meaningfulCommits, spamCommits, totalCommits: commitsRes.data.length };
    
  } catch (error) {
    return { meaningfulCommits: 0, spamCommits: 0, totalCommits: 0 };
  }
}

// ============ ANALYZE REPO CONTENT ============
async function analyzeRepoContent(username, repoName) {
  try {
    const contentsRes = await axios.get(
      `https://api.github.com/repos/${username}/${repoName}/contents`,
      { timeout: 5000 }
    );
    
    const files = contentsRes.data;
    const codeFiles = [];
    const docFiles = [];
    
    for (const file of files) {
      const ext = path.extname(file.name).toLowerCase();
      const name = file.name.toLowerCase();
      
      if (name.includes('readme') || name.includes('license')) {
        docFiles.push(file.name);
      } else if (['.js', '.py', '.java', '.cpp', '.c', '.go', '.rs', '.ts', '.sol', '.rb', '.php', '.jsx', '.tsx', '.vue', '.swift', '.kt', '.cs', '.html', '.css'].includes(ext)) {
        codeFiles.push(file.name);
      }
    }
    
    return {
      hasCode: codeFiles.length > 0,
      codeFiles: codeFiles,
      docFiles: docFiles,
      totalFiles: files.length
    };
    
  } catch (error) {
    return { hasCode: false, codeFiles: [], docFiles: [], totalFiles: 0 };
  }
}

// ============ CALCULATE BUILDER SCORE ============
async function calculateBuilderScore(username, userData, repos) {
  let score = 0;
  const details = {
    codeRepos: 0,
    totalMeaningfulCommits: 0,
    totalSpamCommits: 0,
    stars: 0,
    forks: 0,
    accountAge: 0,
    recentActivity: 0
  };
  
  const repoAnalysis = [];
  
  for (const repo of repos) {
    if (repo.fork) continue; // Skip forks
    
    // Analyze repo content
    const content = await analyzeRepoContent(username, repo.name);
    
    // Check if spam repo
    const spamCheck = isSpamRepo(repo.name, repo.description, content.codeFiles);
    
    if (spamCheck.isSpam) {
      repoAnalysis.push({
        name: repo.name,
        status: 'spam',
        reason: spamCheck.reason,
        hasCode: false
      });
      continue;
    }
    
    // Get meaningful commits
    const commits = await getMeaningfulCommits(username, repo);
    
    if (commits.meaningfulCommits > 0 || content.hasCode) {
      details.codeRepos++;
      details.totalMeaningfulCommits += commits.meaningfulCommits;
      details.totalSpamCommits += commits.spamCommits;
      details.stars += repo.stargazers_count;
      details.forks += repo.forks_count;
      
      repoAnalysis.push({
        name: repo.name,
        status: 'valid',
        meaningfulCommits: commits.meaningfulCommits,
        spamCommits: commits.spamCommits,
        hasCode: content.hasCode,
        codeFiles: content.codeFiles.length,
        stars: repo.stargazers_count,
        description: repo.description
      });
    } else {
      repoAnalysis.push({
        name: repo.name,
        status: 'empty',
        reason: 'No meaningful commits or code',
        hasCode: false
      });
    }
    
    // Small delay to avoid rate limit
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  // ============ CALCULATE SCORE ============
  
  // 1. Code Repositories (Max 35 points)
  let repoScore = 0;
  if (details.codeRepos >= 10) repoScore = 35;
  else if (details.codeRepos >= 7) repoScore = 30;
  else if (details.codeRepos >= 5) repoScore = 25;
  else if (details.codeRepos >= 3) repoScore = 20;
  else if (details.codeRepos >= 1) repoScore = 10;
  score += repoScore;
  
  // 2. Meaningful Commits (Max 35 points)
  let commitScore = 0;
  if (details.totalMeaningfulCommits >= 500) commitScore = 35;
  else if (details.totalMeaningfulCommits >= 300) commitScore = 30;
  else if (details.totalMeaningfulCommits >= 200) commitScore = 25;
  else if (details.totalMeaningfulCommits >= 100) commitScore = 20;
  else if (details.totalMeaningfulCommits >= 50) commitScore = 15;
  else if (details.totalMeaningfulCommits >= 20) commitScore = 10;
  else if (details.totalMeaningfulCommits >= 5) commitScore = 5;
  score += commitScore;
  
  // 3. Stars (Community Love) (Max 15 points)
  let starScore = 0;
  if (details.stars >= 100) starScore = 15;
  else if (details.stars >= 50) starScore = 12;
  else if (details.stars >= 20) starScore = 9;
  else if (details.stars >= 10) starScore = 6;
  else if (details.stars >= 5) starScore = 3;
  else if (details.stars >= 1) starScore = 1;
  score += starScore;
  
  // 4. Account Age (Max 10 points)
  const accountAgeDays = (Date.now() - new Date(userData.created_at)) / (1000 * 60 * 60 * 24);
  details.accountAge = accountAgeDays;
  let ageScore = 0;
  if (accountAgeDays > 730) ageScore = 10;
  else if (accountAgeDays > 365) ageScore = 8;
  else if (accountAgeDays > 180) ageScore = 6;
  else if (accountAgeDays > 90) ageScore = 4;
  else if (accountAgeDays > 30) ageScore = 2;
  score += ageScore;
  
  // 5. Spam Penalty (Max -15 points)
  let spamPenalty = Math.min(details.totalSpamCommits / 10, 15);
  if (details.codeRepos === 0 && details.totalMeaningfulCommits === 0) {
    spamPenalty = 15; // Full penalty if no real activity
  }
  score -= spamPenalty;
  
  // Final score (0-100)
  score = Math.max(0, Math.min(Math.floor(score), 100));
  
  return {
    score,
    details,
    repoAnalysis,
    breakdown: {
      repoScore,
      commitScore,
      starScore,
      ageScore,
      spamPenalty: Math.floor(spamPenalty)
    }
  };
}

// ============ MAIN SCAN ENDPOINT ============
app.get('/api/scan/:username', async (req, res) => {
  const { username } = req.params;
  
  try {
    console.log(`\n🔍 SCANNING: @${username}`);
    console.log('═'.repeat(50));
    
    // Get user data
    const userRes = await axios.get(`https://api.github.com/users/${username}`);
    const user = userRes.data;
    
    // Get repositories
    const reposRes = await axios.get(`https://api.github.com/users/${username}/repos?per_page=100&sort=updated`);
    const allRepos = reposRes.data;
    
    console.log(`📁 Total repos: ${allRepos.length}`);
    console.log(`🔍 Analyzing each repo for real code...\n`);
    
    // Calculate score
    const scoreData = await calculateBuilderScore(username, user, allRepos);
    
    // Get builder tier
    const tier = getBuilderTier(scoreData.score);
    
    // Prepare response
    const builderProfile = {
      username: user.login,
      name: user.name || user.login,
      avatar: user.avatar_url,
      bio: user.bio || '',
      location: user.location || '',
      followers: user.followers,
      following: user.following,
      accountCreated: user.created_at,
      
      // Score and Tier
      builderScore: scoreData.score,
      tier: tier,
      
      // Stats
      stats: {
        codeRepos: scoreData.details.codeRepos,
        totalMeaningfulCommits: scoreData.details.totalMeaningfulCommits,
        totalSpamCommits: scoreData.details.totalSpamCommits,
        totalStars: scoreData.details.stars,
        accountAge: Math.floor(scoreData.details.accountAge / 30) + ' months'
      },
      
      // Breakdown
      scoreBreakdown: scoreData.breakdown,
      
      // Repositories
      repositories: scoreData.repoAnalysis,
      
      // Analysis message
      analysisMessage: getAnalysisMessage(scoreData.score, scoreData.details)
    };
    
    // Store in leaderboard
    builders.unshift({
      username: user.login,
      score: scoreData.score,
      tier: tier.name,
      timestamp: Date.now()
    });
    builders = builders.slice(0, 20);
    
    console.log(`\n📊 FINAL SCORE: ${scoreData.score}/100`);
    console.log(`🏆 TIER: ${tier.name}`);
    console.log(`📝 Valid repos: ${scoreData.details.codeRepos}`);
    console.log(`💻 Meaningful commits: ${scoreData.details.totalMeaningfulCommits}`);
    console.log(`⚠️ Spam commits filtered: ${scoreData.details.totalSpamCommits}`);
    console.log('═'.repeat(50));
    
    res.json({
      success: true,
      builder: builderProfile,
      leaderboard: builders
    });
    
  } catch (error) {
    console.error('Error:', error.message);
    res.status(404).json({
      success: false,
      error: error.response?.data?.message || 'User not found'
    });
  }
});

// Helper function for analysis message
function getAnalysisMessage(score, details) {
  if (score >= 75) {
    return `🎉 Exceptional developer! ${details.codeRepos} high-quality repos with ${details.totalMeaningfulCommits} meaningful commits. Community loves your work (${details.stars} stars)!`;
  } else if (score >= 50) {
    return `💪 Strong builder! ${details.codeRepos} active repos with real code. Keep shipping great work!`;
  } else if (score >= 25) {
    return `🌱 You're on your way! Started with ${details.codeRepos} repos. Focus on consistent commits to level up.`;
  } else {
    return `👻 Low activity detected. Start building real projects with actual code commits to increase your score.`;
  }
}

// Leaderboard endpoint
app.get('/api/leaderboard', (req, res) => {
  res.json({ success: true, builders });
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`
  ═══════════════════════════════════════════
  🏗️  BUILDER SCAN AGENT (Like BaseName)
  ═══════════════════════════════════════════
  📡 Server: http://localhost:${PORT}
  🔍 Scan: http://localhost:${PORT}/api/scan/username
  ═══════════════════════════════════════════
  `);
});
