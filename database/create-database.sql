-- Create database and users table for Worklytics HRMS Project
-- Run this SQL in phpMyAdmin at http://192.168.50.29/
-- Login with: apiuser / Thrive@2910

-- Create database
CREATE DATABASE IF NOT EXISTS worklytics_hrms;
USE worklytics_hrms;

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(20) NOT NULL,
  role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Grant permissions (if needed)
-- GRANT ALL PRIVILEGES ON worklytics_hrms.* TO 'apiuser'@'%';
-- FLUSH PRIVILEGES;

