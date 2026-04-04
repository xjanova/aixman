module.exports = {
  apps: [
    {
      name: 'aixman',
      script: 'node_modules/.bin/next',
      args: 'start -p 3001',
      cwd: '/home/admin/domains/ai.xman4289.com',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
