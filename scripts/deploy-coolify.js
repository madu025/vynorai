const token = '10|Zj0AyQJWPrRRT0XgkcJbnIdPQ26npV4h7lipEkIZ7d7ac351';
const base = 'http://172.255.209.243:8000/api/v1';

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
      project_uuid: 'kpqoxempx3h7l69cpk24nraw',
      server_uuid: '4rsokr1xcbrlfnej4uruvdjj',
      environment_name: 'production',
      git_repository: 'https://github.com/madu025/vynorai',
      git_branch: 'main',
      build_pack: 'dockerfile',
      ports_exposes: '3000',
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
        project_uuid: 'kpqoxempx3h7l69cpk24nraw',
        server_uuid: '4rsokr1xcbrlfnej4uruvdjj',
        environment_name: 'production',
        git_repository: 'madu025/vynorai',
        git_branch: 'main',
        build_pack: 'dockerfile',
        ports_exposes: '3000',
        base_directory: '/backend'
      })
    });
    console.log('Private endpoint status:', res.status);
    data = await res.json();
    console.log('Private response:', JSON.stringify(data, null, 2));
  }
}

deployApp().catch(console.error);
