const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Store builder data
let builders = [];

// Helper function to detect spammer
function detectSpammer(userData, reposData, commitsData) {
  const spamIndicators = [];
  let spamScore = 0;
  
  // Check 1: Account age too new (created less than 30 days ago)
  const accountAge = (Date.now() - new Date(userData.created_at)) / (1000 * 60 * 60 * 24);
  if (accountAge < 30) {
    spamIndicators.push('⚠️ Account is very new (less than 30 days old)');
    spamScore += 20;
  }
  
  // Check 2: No bio or fake looking bio
  if (!userData.bio || userData.bio.length < 10) {
    spamIndicators.push('⚠️ No or very short bio');
    spamScore += 15;
  }
  
  // Check 3: All repositories are forks (no original work)
  const totalRepos = reposData.length;
  const forkRepos = reposData.filter(repo => repo.fork).length;
  const forkPercentage = totalRepos > 0 ? (forkRepos / totalRepos) * 100 : 0;
  
  if (forkPercentage > 80) {
    spamIndicators.push(`⚠️ ${forkPercentage.toFixed(0)}% of repos are forks (no original work)`);
    spamScore += 30;
  }
  
  // Check 4: Repositories have no descriptions
  const reposWithoutDesc = reposData.filter(repo => !repo.description || repo.description.length < 10).length;
  const descPercentage = totalRepos > 0 ? (reposWithoutDesc / totalRepos) * 100 : 0;
  
  if (descPercentage > 70) {
    spamIndicators.push('⚠️ Most repositories have no or poor descriptions');
    spamScore += 20;
  }
  
  // Check 5: All repos created in a short time (bulk creation)
  const repoDates = reposData.map(repo => new Date(repo.created_at).getTime());
  const oldestRepo = Math.min(...repoDates);
  const newestRepo = Math.max(...repoDates);
  const timeSpan = (newestRepo - oldestRepo) / (1000 * 60 * 60 * 24);
  
  if (totalRepos > 5 && timeSpan < 7) {
    spamIndicators.push('⚠️ Multiple repositories created in a short time (potential spam)');
    spamScore += 25;
  }
  
  // Check 6: No commits or very few commits
  let totalCommits = 0;
  if (commitsData && commitsData.length > 0) {
    totalCommits = commitsData.reduce((sum, repo) => sum + repo.commitCount, 0);
  }
  
  if (totalCommits < 10) {
    spamIndicators.push('⚠️ Very low commit activity (<10 total commits)');
    spamScore += 25;
  }
  
  // Check 7: No followers and following no one
  if (userData.followers === 0 && userData.following === 0) {
    spamIndicators.push('⚠️ No social interaction (0 followers, 0 following)');
    spamScore += 10;
  }
  
  // Determine if spammer
  const isSpammer = spamScore >= 50;
  const spammerLevel = spamScore >= 70 ? 'High' : (spamScore >= 40 ? 'Medium' : 'Low');
  
  return {
    isSpammer,
    spamScore,
    spammerLevel,
    indicators: spamIndicators,
    confidence: Math.min(spamScore, 100)
  };
}

// Helper function to calculate builder score
function calculateBuilderScore(userData, reposData, commitsData) {
  let score = 0;
  const details = {};
  
  // Factor 1: Quality repositories (not forks, with description)
  const qualityRepos = reposData.filter(repo => 
    !repo.fork && 
    repo.description && 
    repo.description.length > 10
  );
  const qualityRepoScore = Math.min(qualityRepos.length * 5, 40);
  score += qualityRepoScore;
  details.qualityRepos = {
    count: qualityRepos.length,
    score: qualityRepoScore,
    maxScore: 40
  };
  
  // Factor 2: Repository stars (community appreciation)
  const totalStars = reposData.reduce((sum, repo) => sum + repo.stargazers_count, 0);
  const starScore = Math.min(totalStars * 2, 30);
  score += starScore;
  details.stars = {
    total: totalStars,
    score: starScore,
    maxScore: 30
  };
  
  // Factor 3: Active repositories (updated in last 6 months)
  const activeRepos = reposData.filter(repo => {
    const updated = new Date(repo.updated_at);
    const diffDays = (Date.now() - updated) / (1000 * 60 * 60 * 24);
    return diffDays < 180;
  });
  const activeScore = Math.min(activeRepos.length * 3, 20);
  score += activeScore;
  details.activeRepos = {
    count: activeRepos.length,
    score: activeScore,
    maxScore: 20
  };
  
  // Factor 4: Commit activity
  let totalCommits = 0;
  if (commitsData && commitsData.length > 0) {
    totalCommits = commitsData.reduce((sum, repo) => sum + repo.commitCount, 0);
  }
  const commitScore = Math.min(totalCommits / 5, 30);
  score += commitScore;
  details.commits = {
    total: totalCommits,
    score: Math.floor(commitScore),
    maxScore: 30
  };
  
  // Factor 5: Account age bonus
  const accountAge = (Date.now() - new Date(userData.created_at)) / (1000 * 60 * 60 * 24 * 365);
  const ageBonus = Math.min(accountAge * 2, 20);
  score += ageBonus;
  details.accountAge = {
    years: accountAge.toFixed(1),
    bonus: Math.floor(ageBonus),
    maxBonus: 20
  };
  
  // Factor 6: Followers bonus
  const followerBonus = Math.min(userData.followers / 5, 10);
  score += followerBonus;
  details.followers = {
    count: userData.followers,
    bonus: Math.floor(followerBonus),
    maxBonus: 10
  };
  
  return {
    totalScore: Math.min(Math.floor(score), 100),
    details
  };
}

// Helper function to fetch commit data
async function fetchCommitData(username) {
  try {
    const response = await axios.get(`https://api.github.com/users/${username}/events/public`);
    const events = response.data;
    
    // Count push events (commits)
    const pushEvents = events.filter(event => event.type === 'PushEvent');
    const totalCommits = pushEvents.reduce((sum, event) => sum + event.payload.size, 0);
    
    // Get last 30 days activity
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
    console.log('Error fetching commits:', error.message);
    return {
      totalCommits: 0,
      recentCommits: 0,
      recentActivityCount: 0
    };
  }
}

// API endpoint to scan a builder
app.get('/api/scan/:username', async (req, res) => {
  const { username } = req.params;
  
  try {
    console.log(`🔍 Scanning builder: ${username}`);
    
    // Fetch user data
    const userResponse = await axios.get(`https://api.github.com/users/${username}`);
    const userData = userResponse.data;
    
    // Fetch repositories
    const reposResponse = await axios.get(`https://api.github.com/users/${username}/repos?per_page=100`);
    const reposData = reposResponse.data;
    
    // Fetch commit activity
    const commitData = await fetchCommitData(username);
    
    // Calculate builder score
    const scoreData = calculateBuilderScore(userData, reposData, commitData);
    
    // Detect spammer
    const spamDetection = detectSpammer(userData, reposData, commitData);
    
    // Prepare builder profile
    const builderProfile = {
      username: userData.login,
      name: userData.name || userData.login,
      avatar: userData.avatar_url,
      bio: userData.bio || '',
      location: userData.location || '',
      company: userData.company || '',
      followers: userData.followers,
      following: userData.following,
      publicRepos: userData.public_repos,
      accountCreated: userData.created_at,
      accountUpdated: userData.updated_at,
      
      // Score data
      builderScore: scoreData.totalScore,
      scoreDetails: scoreData.details,
      
      // Spam detection
      isSpammer: spamDetection.isSpammer,
      spammerLevel: spamDetection.spammerLevel,
      spamIndicators: spamDetection.indicators,
      spamConfidence: spamDetection.confidence,
      
      // Commit activity
      commits: commitData,
      
      // Top repositories
      topRepos: reposData
        .filter(repo => !repo.fork)
        .sort((a, b) => b.stargazers_count - a.stargazers_count)
        .slice(0, 5)
        .map(repo => ({
          name: repo.name,
          description: repo.description,
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          language: repo.language,
          url: repo.html_url
        }))
    };
    
    // Store in leaderboard
    const existingIndex = builders.findIndex(b => b.username === username);
    if (existingIndex !== -1) {
      builders[existingIndex] = {
        username,
        score: builderProfile.builderScore,
        timestamp: Date.now(),
        isSpammer: builderProfile.isSpammer
      };
    } else {
      builders.push({
        username,
        score: builderProfile.builderScore,
        timestamp: Date.now(),
        isSpammer: builderProfile.isSpammer
      });
    }
    
    // Sort leaderboard
    builders.sort((a, b) => b.score - a.score);
    builders = builders.slice(0, 20); // Keep top 20
    
    res.json({
      success: true,
      builder: builderProfile,
      leaderboard: builders
    });
    
  } catch (error) {
    console.error('Error scanning user:', error.message);
    res.status(404).json({
      success: false,
      error: 'User not found or GitHub API error',
      message: error.message
    });
  }
});

// Get leaderboard
app.get('/api/leaderboard', (req, res) => {
  res.json({
    success: true,
    builders: builders
  });
});

// Serve index.html for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`
  🚀 BuilderScan Agent Started!
  📡 Server running at: http://localhost:${PORT}
  🔍 Scan builders by visiting: http://localhost:${PORT}/api/scan/:username
  `);
});
