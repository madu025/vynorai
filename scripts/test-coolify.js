const token = process.env.COOLIFY_API_TOKEN;
const base = process.env.COOLIFY_API_URL;

if (!token || !base) {
  throw new Error('COOLIFY_API_TOKEN and COOLIFY_API_URL must be set');
}

async function main() {
  const headers = { 
    'Authorization': 'Bearer ' + token, 
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  };

  const res = await fetch(base + '/applications/dockerfile', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      project_uuid: process.env.COOLIFY_PROJECT_UUID,
      server_uuid: process.env.COOLIFY_SERVER_UUID,
      environment_name: process.env.COOLIFY_ENVIRONMENT_NAME || 'production'
    })
  });
  console.log('Status:', res.status);
  const data = await res.json();
  console.log('Response:', JSON.stringify(data, null, 2));
}

main().catch(console.error);
