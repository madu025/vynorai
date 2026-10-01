const token = process.env.COOLIFY_API_TOKEN;
const base = process.env.COOLIFY_API_URL;

if (!token || !base) {
  throw new Error('COOLIFY_API_TOKEN and COOLIFY_API_URL must be set');
}

async function deployApp() {
  const headers = { 
    'Authorization': 'Bearer ' + token, 
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  };

  // Try creating via /applications/public first or /applications/private-github-app
  console.log('Attempting to create application in Coolify...');

  // Check public endpoint
  let res = await fetch(base + '/applications/public', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      project_uuid: process.env.COOLIFY_PROJECT_UUID,
      server_uuid: process.env.COOLIFY_SERVER_UUID,
      environment_name: process.env.COOLIFY_ENVIRONMENT_NAME || 'production',
      git_repository: process.env.COOLIFY_GIT_REPOSITORY || 'https://github.com/madu025/vynorai',
      git_branch: process.env.COOLIFY_GIT_BRANCH || 'main',
      build_pack: 'dockerfile',
      ports_exposes: '3333,3334',
      base_directory: '/backend'
    })
  });

  console.log('Public endpoint status:', res.status);
  let data = await res.json();
  console.log('Response:', JSON.stringify(data, null, 2));

  if (res.status !== 200 && res.status !== 201) {
    // Try private-github-app endpoint
    console.log('Trying private-github-app endpoint...');
    res = await fetch(base + '/applications/private-github-app', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project_uuid: process.env.COOLIFY_PROJECT_UUID,
        server_uuid: process.env.COOLIFY_SERVER_UUID,
        environment_name: process.env.COOLIFY_ENVIRONMENT_NAME || 'production',
        git_repository: process.env.COOLIFY_GIT_REPOSITORY || 'madu025/vynorai',
        git_branch: process.env.COOLIFY_GIT_BRANCH || 'main',
        build_pack: 'dockerfile',
        ports_exposes: '3333,3334',
        base_directory: '/backend'
      })
    });
    console.log('Private endpoint status:', res.status);
    data = await res.json();
    console.log('Private response:', JSON.stringify(data, null, 2));
  }
}

deployApp().catch(console.error);
