const token = '10|Zj0AyQJWPrRRT0XgkcJbnIdPQ26npV4h7lipEkIZ7d7ac351';
const base = 'http://172.255.209.243:8000/api/v1';

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
      project_uuid: 'kpqoxempx3h7l69cpk24nraw',
      server_uuid: '4rsokr1xcbrlfnej4uruvdjj',
      environment_name: 'production'
    })
  });
  console.log('Status:', res.status);
  const data = await res.json();
  console.log('Response:', JSON.stringify(data, null, 2));
}

main().catch(console.error);
