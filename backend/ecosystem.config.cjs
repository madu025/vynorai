module.exports = {
  apps: [
    {
      name: "vynorai-backend",
      script: "dist/index.js",
      instances: 1, // Fork mode recommended for single SQLite file integrity
      exec_mode: "fork",
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      },
      kill_timeout: 8000,
      wait_ready: true,
      listen_timeout: 10000,
      exp_backoff_restart_delay: 100,
    },
  ],
};
