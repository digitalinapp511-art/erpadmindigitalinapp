const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const { connectMongo, getUsersCollection, LOGIN_DB_NAME } = require('../../../config/mongo');
const { ensureQueryTrackerConnection } = require('../config/database');

const auth = async (req, res, next) => {
  try {
    // Try multiple ways to get the Authorization header
    const authHeader = req.header('Authorization') || req.headers.authorization || req.headers.Authorization;
    let token = null;
    
    if (authHeader) {
      // Handle both "Bearer token" and just "token" formats
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.replace('Bearer ', '').trim();
      } else {
        token = authHeader.trim();
      }
    }
    
    console.log('[Query Tracker Auth] Request received:', {
      hasAuthHeader: !!authHeader,
      hasToken: !!token,
      tokenLength: token ? token.length : 0,
      path: req.path,
      method: req.method,
      url: req.url
    });
    
    if (!token) {
      console.log('[Query Tracker Auth] No token provided');
      return res.status(401).json({ message: 'No token, authorization denied' });
    }

    // Use the same JWT_SECRET as main auth, with same fallback
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
    
    let decoded;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (jwtError) {
      console.error('[Query Tracker Auth] JWT verification failed:', {
        error: jwtError.message,
        name: jwtError.name,
        jwtSecretSet: !!process.env.JWT_SECRET
      });
      return res.status(401).json({ 
        message: 'Token is not valid', 
        error: process.env.NODE_ENV === 'development' ? jwtError.message : 'Invalid token'
      });
    }
    
    console.log('[Query Tracker Auth] Token decoded:', { 
      hasEmail: !!decoded.email, 
      hasUserId: !!decoded.userId,
      email: decoded.email,
      role: decoded.role 
    });
    
    let user = null;
    
    // Priority 1: If token has email, use that to find/create user (main auth uses email)
    if (decoded.email) {
      // Resolve company from main login DB, then connect mongoose to that company DB
      let company = null;
      try {
        await connectMongo(LOGIN_DB_NAME);
        const mainUsersCol = await getUsersCollection();
        const mainUserForCompany = await mainUsersCol.findOne({ email: decoded.email });
        company = mainUserForCompany?.company || null;
      } catch (_e) {}

      if (!company) {
        return res.status(400).json({ message: 'Company not found for user' });
      }

      await ensureQueryTrackerConnection(company);

      // First try to find user in Query Tracker database by email
      try {
        user = await User.findOne({ email: decoded.email }).select('-password');
        if (user) {
          console.log('[Query Tracker Auth] User found in Query Tracker:', user.email);
        }
      } catch (dbError) {
        console.error('[Query Tracker Auth] Error finding user in Query Tracker:', dbError);
      }
      
      // If not found in Query Tracker, try to get from main auth database
      if (!user) {
        try {
          await connectMongo(LOGIN_DB_NAME);
          const usersCol = await getUsersCollection();
          const mainUser = await usersCol.findOne({ email: decoded.email });
          
          if (mainUser) {
            // Check if user exists in Query Tracker, if not create one
            let queryTrackerUser = await User.findOne({ email: decoded.email });
            
            if (!queryTrackerUser) {
              // Create new user - password will be hashed by pre-save hook
              queryTrackerUser = new User({
                name: mainUser.name || decoded.email,
                email: decoded.email,
                password: 'temp-password-' + Date.now(), // Will be hashed by pre-save hook
                role: mainUser.role === 'admin' ? 'admin' : 'user',
                isActive: true
              });
              await queryTrackerUser.save();
            } else {
              // Update existing user
              queryTrackerUser.name = mainUser.name || queryTrackerUser.name;
              queryTrackerUser.role = mainUser.role === 'admin' ? 'admin' : 'user';
              queryTrackerUser.isActive = true;
              await queryTrackerUser.save();
            }
            
            user = await User.findById(queryTrackerUser._id).select('-password');
          }
        } catch (error) {
          console.error('Error syncing user from main auth:', error);
        }
      }
      
      // If still no user, create a basic user from token data
      if (!user) {
        try {
          let queryTrackerUser = await User.findOne({ email: decoded.email });
          
          if (!queryTrackerUser) {
            console.log('[Query Tracker Auth] Creating new user from token:', decoded.email);
            queryTrackerUser = new User({
              name: decoded.email.split('@')[0] || 'User',
              email: decoded.email,
              password: 'temp-password-' + Date.now(), // Will be hashed by pre-save hook
              role: decoded.role === 'admin' ? 'admin' : 'user',
              isActive: true
            });
            await queryTrackerUser.save();
            console.log('[Query Tracker Auth] User created successfully:', queryTrackerUser._id);
          }
          
          user = await User.findById(queryTrackerUser._id).select('-password');
          if (user) {
            console.log('[Query Tracker Auth] User found after creation:', user.email);
          }
        } catch (error) {
          console.error('[Query Tracker Auth] Error creating user from token:', error);
          console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            email: decoded.email
          });
        }
      }
    } 
    // Priority 2: If token has userId (for Query Tracker native tokens), try to find by MongoDB ObjectId
    else if (decoded.userId) {
      try {
        // Check if userId is a valid MongoDB ObjectId
        const { ObjectId } = require('mongoose').Types;
        if (ObjectId.isValid(decoded.userId)) {
          user = await User.findById(decoded.userId).select('-password');
        }
      } catch (error) {
        console.error('Error finding user by userId:', error);
      }
    }
    
    if (!user) {
      console.log('[Query Tracker Auth] User not found after all attempts:', { 
        email: decoded.email,
        hasEmail: !!decoded.email,
        hasUserId: !!decoded.userId
      });
      return res.status(401).json({ message: 'User not found. Please contact administrator.' });
    }
    
    if (!user.isActive) {
      console.log('[Query Tracker Auth] User is inactive:', { 
        email: user.email,
        isActive: user.isActive
      });
      return res.status(401).json({ message: 'User account is inactive' });
    }

    console.log('[Query Tracker Auth] Authentication successful:', { 
      userId: user._id, 
      email: user.email, 
      role: user.role 
    });
    req.user = user;
    req.user.company = req.user.company || decoded.company || undefined;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    // Don't expose internal error details in production
    const errorMessage = process.env.NODE_ENV === 'development' ? error.message : 'Token is not valid';
    res.status(401).json({ message: 'Token is not valid', error: errorMessage });
  }
};

const adminAuth = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied. Admin only.' });
  }
  next();
};

module.exports = { auth, adminAuth };

