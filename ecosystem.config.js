const path = require('path');
const { ports } = require('./config/app.config');

const backendInstances = Math.max(1, parseInt(process.env.PM2_INSTANCES || '1', 10) || 1);
const backendExecMode = backendInstances > 1 ? 'cluster' : 'fork';

module.exports = {
  apps: [
    {
      name: 'HRMS-backend',
      script: './server.js',
      cwd: path.resolve(__dirname),
      instances: backendInstances,
      exec_mode: backendExecMode,
      env_production: {
        NODE_ENV: 'production',
        PORT: ports.backend
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true,
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      node_args: '--max-old-space-size=1024'
    },
    {
      name: 'HRMS-frontend',
      script: './start-server.js',
      cwd: path.resolve(__dirname, '../hrms_frontend'),
      instances: 1,
      exec_mode: 'fork',
      env_production: {
        NODE_ENV: 'production',
        PORT: ports.frontend
      },
      error_file: './logs/frontend-err.log',
      out_file: './logs/frontend-out.log',
      log_file: './logs/frontend-combined.log',
      time: true,
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G'
    }
  ]
};

