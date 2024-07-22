import { Octokit } from "@octokit/core";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import dotenv from "dotenv";

dotenv.config();

const { decodeUTF8, encodeBase64, decodeBase64 } = naclUtil;

// Script secrets
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER
const REPO_NAME = process.env.REPO_NAME;

const BUCKET_NAME = process.env.BUCKET_NAME;
const AWS_ACCOUNT = process.env.AWS_ACCOUNT;
const IAM_ROLE = process.env.IAM_ROLE;

async function getPublicKey(octokit, environment) {
  const url = `/repos/${REPO_OWNER}/${REPO_NAME}/environments/${environment}/secrets/public-key`;
  try {
    const response = await octokit.request(`GET ${url}`, {
      headers: {
        accept: 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    return response.data;
  } catch (error) {
    console.error(`Failed to get public key for environment '${environment}':`, error);
    throw error;
  }
}

async function updateGitHubSecrets(environment, secretName, secretValue) {
  const octokit = new Octokit({
    auth: GITHUB_TOKEN
  });

  const { key_id, key } = await getPublicKey(octokit, environment);
  const encryptedSecret = encryptSecret(key, secretValue);

  const uri = `/repos/${REPO_OWNER}/${REPO_NAME}/environments/${environment}/secrets/${secretName}`;
  try {
    await octokit.request(`PUT ${uri}`, {
      encrypted_value: encryptedSecret,
      key_id,
      headers: {
        accept: 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
  } catch (error) {
    console.error(`Failed to update secret '${secretName}' for environment '${environment}':`, error);
    throw error;
  }
}

function encryptSecret(publicKey, secretValue) {
  const messageBytes = decodeUTF8(secretValue);
  const keyBytes = decodeBase64(publicKey);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);

  const sealedBox = nacl.box(messageBytes, nonce, keyBytes, nacl.box.keyPair().secretKey);

  const combinedMessage = new Uint8Array(nonce.length + sealedBox.length);
  combinedMessage.set(nonce);
  combinedMessage.set(sealedBox, nonce.length);

  return encodeBase64(combinedMessage);
}

async function main() {
  const environments = ['production', 'staging'];
  const prodDistributionId = execSync('aws cloudfront list-distributions --query "DistributionList.Items[?Aliases.Items[0]==`pizza.yourdomainname.net`].Id" --output text').toString().trim();
  const stageDistributionId = execSync('aws cloudfront list-distributions --query "DistributionList.Items[?Aliases.Items[0]==`stage-pizza.yourdomainname.net`].Id" --output text').toString().trim();

  for (const env of environments) {
    const DISTRUBUTION_ID = (env === 'production' ? prodDistributionId : stageDistributionId)
    await updateGitHubSecrets(env, 'DISTRIBUTION_ID', DISTRUBUTION_ID)
    await updateGitHubSecrets(env, 'APP_BUCKET', BUCKET_NAME);
    await updateGitHubSecrets(env, 'AWS_ACCOUNT', AWS_ACCOUNT);
    await updateGitHubSecrets(env, 'CI_IAM_ROLE', IAM_ROLE);
  }
}

main().catch(console.error);