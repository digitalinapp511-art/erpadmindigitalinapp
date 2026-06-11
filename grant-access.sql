-- SQL Script to Grant Remote Access to MySQL
-- Run this in phpMyAdmin SQL tab at http://192.168.50.29/

-- Option 1: Grant access from specific IP (192.168.50.107)
-- Replace with your actual local IP if different
GRANT ALL PRIVILEGES ON worklytics_hrms.* TO 'root'@'192.168.50.107' IDENTIFIED BY 'Thrive@2910';

-- Option 2: Grant access from entire subnet (192.168.50.x)
-- More flexible, allows any IP in your network
GRANT ALL PRIVILEGES ON worklytics_hrms.* TO 'root'@'192.168.50.%' IDENTIFIED BY 'Thrive@2910';

-- Option 3: Grant access from any IP (for development only)
-- Less secure, but works from anywhere
GRANT ALL PRIVILEGES ON worklytics_hrms.* TO 'root'@'%' IDENTIFIED BY 'Thrive@2910';

-- Apply the changes
FLUSH PRIVILEGES;

-- Verify the grants
SELECT User, Host FROM mysql.user WHERE User = 'root';

