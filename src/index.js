console.log("BuilderScan Agent Started");

const account = {
  username: "example_dev",
  githubCommits: 12,
  contractsDeployed: 2,
  technicalTweets: 7
};

const builderScore =
  account.githubCommits * 2 +
  account.contractsDeployed * 10 +
  account.technicalTweets * 1;

console.log("Account:", account.username);
console.log("Builder Score:", builderScore);
