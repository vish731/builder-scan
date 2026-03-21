const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

let builders = [];

// Helper function to check if repo has actual code
async function checkRepoContent(username, repoName) {
  try {
    // Try to get repo contents to check if it has actual files
    const response = await axios.get(`https://api.github.com/repos/${username}/${repoName}/contents`, {
      timeout: 5000
    });
    
    const files = response.data;
    
    // Filter out .gitignore, README, LICENSE - these are not real code
    const realFiles = files.filter(file => {
      const name = file.name.toLowerCase();
      return !name.includes('readme') && 
             !name.includes('license') && 
             !name.includes('.gitignore') &&
             !name.includes('contributing') &&
             !name.includes('code-of-conduct');
    });
    
    // Check if files have actual code extensions
    const codeExtensions = ['.js', '.py', '.java', '.cpp', '.c', '.go', '.rs', '.ts', '.sol', '.rb', '.php', '.html', '.css', '.json'];
    const hasCodeFiles = realFiles.some(file => {
      const ext = path.extname(file.name).toLowerCase();
      return codeExtensions.includes(ext);
    });
    
    return {
      hasContent: realFiles.length > 0,
      hasCodeFiles: hasCodeFiles,
      fileCount: realFiles.length
    };
  } catch (error) {
    // If can't fetch content, assume it's empty
    return {
      hasContent: false,
      hasCodeFiles: false,
      fileCount: 0
    };
  }
}

// Better spammer detection
function detectRealBuilder(userData, reposData, commitsData, repoContents) {
  const indicators = {
    isBuilder: false,
    reasons: [],
    warnings: [],
    score: 0
  };
  
  let builderPoints = 0;
  let maxPoints = 0;
  
  // CRITERIA 1: Account Age (must be at least 3 months old)
  maxPoints += 15;
  const accountAgeDays = (Date.now() - new Date(userData.created_at)) / (1000 * 60 * 60 * 24);
  if (accountAgeDays > 180) {
    builderPoints += 15;
    indicators.reasons.push('✅ Account is well-established (>6 months)');
  } else if (accountAgeDays > 90) {
    builderPoints += 10;
    indicators.reasons.push('✅ Account is established (>3 months)');
  } else if (accountAgeDays > 30) {
    builderPoints += 5;
    indicators.reasons.push('⚠️ Account is relatively new (1-3 months)');
  } else {
    indicators.warnings.push('❌ Account is too new (<30 days) - suspicious');
  }
  
  // CRITERIA 2: Actual Code in Repositories
  maxPoints += 30;
  let reposWithCode = 0;
  let totalRealFiles = 0;
  
  for (const repo of reposData) {
    if (!repo.fork && repoContents[repo.name]) {
      const content = repoContents[repo.name];
      if (content.hasCodeFiles) {
        reposWithCode++;
        totalRealFiles += content.fileCount;
      }
    }
  }
  
  if (reposWithCode >= 3) {
    builderPoints += 30;
    indicators.reasons.push(`✅ Has ${reposWithCode} repositories with actual code`);
  } else if (reposWithCode >= 1) {
    builderPoints += 15;
    indicators.reasons.push(`⚠️ Has ${reposWithCode} repository with actual code`);
  } else {
    indicators.warnings.push('❌ No repositories with actual code - just empty repos');
  }
  
  // CRITERIA 3: Commit Activity
  maxPoints += 25;
  const hasCommits = commitsData.totalCommits > 0;
  const hasRecentCommits = commitsData.recentCommits > 0;
  
  if (commitsData.totalCommits > 100) {
    builderPoints += 25;
    indicators.reasons.push(`✅ Highly active: ${commitsData.totalCommits} total commits`);
  } else if (commitsData.totalCommits > 20) {
    builderPoints += 15;
    indicators.reasons.push(`✅ Active: ${commitsData.totalCommits} total commits`);
  } else if (commitsData.totalCommits > 0) {
    builderPoints += 5;
    indicators.reasons.push(`⚠️ Some activity: ${commitsData.totalCommits} commits`);
  } else {
    indicators.warnings.push('❌ No commit history - not building anything');
  }
  
  if (!hasRecentCommits && hasCommits) {
    indicators.warnings.push('⚠️ No recent activity in last 30 days');
  }
  
  // CRITERIA 4: Community Engagement
  maxPoints += 15;
  const hasStars = reposData.some(repo => repo.stargazers_count > 0);
  const hasFollowers = userData.followers > 0;
  
  if (hasStars && hasFollowers) {
    builderPoints += 15;
    indicators.reasons.push('✅ Community recognized work (has stars & followers)');
  } else if (hasStars || hasFollowers) {
    builderPoints += 8;
    indicators.reasons.push('⚠️ Some community engagement');
  } else {
    indicators.warnings.push('❌ No community engagement (0 stars, 0 followers)');
  }
  
  // CRITERIA 5: Repository Quality (not just empty/forks)
  maxPoints += 15;
  const nonForkRepos = reposData.filter(r => !r.fork);
  const reposWithDescription = nonForkRepos.filter(r => r.description && r.description.length > 20);
  const reposWithReadme = nonForkRepos.filter(r => r.has_readme === true);
  
  let qualityScore = 0;
  if (reposWithDescription.length >= 2) qualityScore += 5;
  if (reposWithCode >= 2) qualityScore += 10;
  
  builderPoints += qualityScore;
  if (qualityScore >= 10) {
    indicators.reasons.push('✅ High quality repositories with proper documentation');
  } else if (qualityScore < 5 && nonForkRepos.length > 0) {
    indicators.warnings.push('⚠️ Repositories lack proper documentation');
  }
  
  // Calculate final builder score (0-100)
  const builderScore = Math.min(Math.floor((builderPoints / maxPoints) * 100), 100);
  
  // Determine if real builder
  const isRealBuilder = builderScore >= 40 && reposWithCode > 0 && commitsData.totalCommits > 0;
  
  return {
    isRealBuilder,
    builderScore,
    confidence: builderScore,
    reasons: indicators.reasons,
    warnings: indicators.warnings,
    reposWithCode,
    totalCommits: commitsData.totalCommits,
    hasRecentActivity: hasRecentCommits
  };
}

// Function to calculate builder score (simple version)
function calculateScore(reposData, commitsData, userData, repoContents) {
  let score = 0;
  const details = {};
  
  // 1. Actual Code Repositories (most important)
  let reposWithCode = 0;
  let totalCodeFiles = 0;
  
  for (const repo of reposData) {
    if (!repo.fork && repoContents[repo.name]) {
      const content = repoContents[repo.name];
      if (content.hasCodeFiles) {
        reposWithCode++;
        totalCodeFiles += content.fileCount;
      }
    }
  }
  
  const codeRepoScore = Math.min(reposWithCode * 15, 40);
  score += codeRepoScore;
  details.codeRepos = {
    count: reposWithCode,
    score: codeRepoScore,
    maxScore: 40
  };
  
  // 2. Commit Activity
  const commitScore = Math.min(commitsData.totalCommits / 5, 30);
  score += commitScore;
  details.commits = {
    total: commitsData.totalCommits,
    recent: commitsData.recentCommits,
    score: Math.floor(commitScore),
    maxScore: 30
  };
  
  // 3. Stars (community appreciation)
  const totalStars = reposData.reduce((sum, repo) => sum + repo.stargazers_count, 0);
  const starScore = Math.min(totalStars * 3, 20);
  score += starScore;
  details.stars = {
    total: totalStars,
    score: starScore,
    maxScore: 20
  };
  
  // 4. Account Age
  const accountAgeYears = (Date.now() - new Date(userData.created_at)) / (1000 * 60 * 60 * 24 * 365);
  const ageBonus = Math.min(accountAgeYears * 5, 10);
  score += ageBonus;
  details.accountAge = {
    years: accountAgeYears.toFixed(1),
    bonus: Math.floor(ageBonus),
    maxBonus: 10
  };
  
  // Penalty for empty repos
  const emptyRepos = reposData.filter(r => !r.fork && (!repoContents[r.name] || !repoContents[r.name].hasCodeFiles)).length;
  if (emptyRepos > 2) {
    const penalty = Math.min(emptyRepos * 5, 20);
    score -= penalty;
    details.emptyReposPenalty = {
      count: emptyRepos,
      penalty: penalty
    };
  }
  
  return {
    totalScore: Math.max(0, Math.min(Math.floor(score), 100)),
    details
  };
}

// Function to fetch commit data
async function fetchCommitData(username) {
  try {
    const response = await axios.get(`https://api.github.com/users/${username}/events/public`);
    const events = response.data;
    
    const pushEvents = events.filter(event => event.type === 'PushEvent');
    const totalCommits = pushEvents.reduce((sum, event) => sum + event.payload.size, 0);
    
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const recentActivity = pushEvents.filter(event => 
      new Date(event.created_at).getTime() > thirtyDaysAgo
    );
    
    return {
      totalCommits,
      recentCommits: recentActivity.reduce((sum, event) => sum + event.payload.size, 0),
      recentActivityCount: recentActivity.length
    };
  } catch (error) {
    return { totalCommits: 0, recentCommits: 0, recentActivityCount: 0 };
  }
}

// Main scan endpoint
app.get('/api/scan/:username', async (req, res) => {
  const { username } = req.params;
  
  try {
    console.log(`🔍 Scanning builder: ${username}`);
    
    // Fetch user data
    const userResponse = await axios.get(`https://api.github.com/users/${username}`);
    const userData = userResponse.data;
    
    // Fetch repositories
    const reposResponse = await axios.get(`https://api.github.com/users/${username}/repos?per_page=50`);
    let reposData = reposResponse.data;
    
    // Filter out forks for main analysis
    reposData = reposData.filter(repo => !repo.fork);
    
    // Fetch commit data
    const commitData = await fetchCommitData(username);
    
    // Check each repository for actual content
    const repoContents = {};
    for (const repo of reposData) {
      console.log(`  Checking repo: ${repo.name}...`);
      repoContents[repo.name] = await checkRepoContent(username, repo.name);
    }
    
    // Detect if real builder
    const builderDetection = detectRealBuilder(userData, reposData, commitData, repoContents);
    
    // Calculate score
    const scoreData = calculateScore(reposData, commitData, userData, repoContents);
    
    // Prepare profile
    const builderProfile = {
      username: userData.login,
      name: userData.name || userData.login,
      avatar: userData.avatar_url,
      bio: userData.bio || '',
      location: userData.location || '',
      followers: userData.followers,
      following: userData.following,
      publicRepos: userData.public_repos,
      accountCreated: userData.created_at,
      
      // Builder detection
      isRealBuilder: builderDetection.isRealBuilder,
      builderScore: builderDetection.builderScore,
      confidence: builderDetection.confidence,
      reasons: builderDetection.reasons,
      warnings: builderDetection.warnings,
      
      // Score details
      scoreDetails: scoreData.details,
      
      // Commit info
      commits: commitData,
      
      // Repository details
      repos: reposData.slice(0, 10).map(repo => ({
        name: repo.name,
        description: repo.description,
        stars: repo.stargazers_count,
        hasCode: repoContents[repo.name]?.hasCodeFiles || false,
        fileCount: repoContents[repo.name]?.fileCount || 0,
        url: repo.html_url,
        updatedAt: repo.updated_at
      })),
      
      stats: {
        reposWithCode: builderDetection.reposWithCode,
        totalCommits: commitData.totalCommits,
        recentCommits: commitData.recentCommits,
        totalStars: reposData.reduce((sum, r) => sum + r.stargazers_count, 0)
      }
    };
    
    // Store in leaderboard
    builders.unshift({
      username,
      score: builderDetection.builderScore,
      isRealBuilder: builderDetection.isRealBuilder,
      timestamp: Date.now()
    });
    builders = builders.slice(0, 20);
    
    res.json({
      success: true,
      builder: builderProfile,
      leaderboard: builders
    });
    
  } catch (error) {
    console.error('Error:', error.message);
    res.status(404).json({
      success: false,
      error: 'User not found or GitHub API error'
    });
  }
});

app.get('/api/leaderboard', (req, res) => {
  res.json({ success: true, builders });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 BuilderScan running on http://localhost:${PORT}`);
});
