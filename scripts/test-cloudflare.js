const token = 'cfat_y5HsQvrNKYI3Gq3ARyYtPcI3lvAjGcPBRzG2ZB4S23bad5f4';
const accountId = 'fac748703d602c9fdf350cc1171a0adb';

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

