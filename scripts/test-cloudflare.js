const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !accountId) {
  console.error('Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID first.');
  process.exit(1);
}

async function check() {
  const url = 'https://api.cloudflare.com/client/v4/accounts/' + accountId + '/r2/buckets';
  console.log('Testing R2 buckets:', url);
  const res = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  console.log('Status:', res.status);
  const data = await res.json();
  console.log('Data:', JSON.stringify(data, null, 2));
}

check().catch(console.error);

