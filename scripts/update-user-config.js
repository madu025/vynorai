const fs = require('fs');
const path = require('path');

const targetPath = path.join(process.env.USERPROFILE || 'C:/Users/USER', '.vynorai', 'config.yaml');

const yamlContent = `name: VynorAI Coding Agent
version: 2.0.0
schema: v1
models:
  - name: "VynorAI DeepSeek V3 (Coding)"
    provider: vynorai
    model: deepseek/deepseek-chat-v3-0324
    apiBase: http://localhost:3000/v1/
    roles:
      - chat
      - edit
      - apply
    defaultCompletionOptions:
      contextLength: 64000
      maxTokens: 8192
    capabilities:
      - tool_use
  - name: "VynorAI DeepSeek R1 (Reasoning)"
    provider: vynorai
    model: deepseek/deepseek-r1
    apiBase: http://localhost:3000/v1/
    roles:
      - chat
    defaultCompletionOptions:
      contextLength: 64000
      maxTokens: 16384
    capabilities:
      - tool_use
  - name: "VynorAI Qwen 2.5 Coder 32B"
    provider: vynorai
    model: qwen/qwen-2.5-coder-32b-instruct
    apiBase: http://localhost:3000/v1/
    roles:
      - chat
      - edit
    defaultCompletionOptions:
      contextLength: 32000
      maxTokens: 8192
    capabilities:
      - tool_use
  - name: "VynorAI Llama 3.3 70B Instruct"
    provider: vynorai
    model: meta-llama/llama-3.3-70b-instruct
    apiBase: http://localhost:3000/v1/
    roles:
      - chat
      - edit
    defaultCompletionOptions:
      contextLength: 128000
      maxTokens: 8192
    capabilities:
      - tool_use
  - name: "VynorAI Claude 3.7 Sonnet"
    provider: vynorai
    model: anthropic/claude-3.7-sonnet
    apiBase: http://localhost:3000/v1/
    roles:
      - chat
      - edit
    defaultCompletionOptions:
      contextLength: 200000
      maxTokens: 8192
    capabilities:
      - tool_use
  - name: "VynorAI Autocomplete (FIM)"
    provider: vynorai
    model: deepseek/deepseek-coder-v2
    apiBase: http://localhost:3000/v1/
    roles:
      - autocomplete
    defaultCompletionOptions:
      contextLength: 16000
      maxTokens: 256
      temperature: 0
`;


fs.writeFileSync(targetPath, yamlContent, 'utf8');
console.log('Successfully written to', targetPath);
