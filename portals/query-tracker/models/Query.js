const mongoose = require('mongoose');

const querySchema = new mongoose.Schema({
  platform: {
    type: String,
    enum: ['Website', 'Email', 'Phone', 'WhatsApp'],
    required: true
  },
  customerName: {
    type: String,
    required: true,
    trim: true
  },
  customerMobile: {
    type: String,
    required: true,
    trim: true
  },
  customerEmail: {
    type: String,
    trim: true
  },
  companyName: {
    type: String,
    trim: true
  },
  location: {
    type: String,
    trim: true
  },
  customerQuery: {
    type: String,
    required: true,
    trim: true
  },
  agentRemark: {
    type: String,
    trim: true
  },
  queryReceivedDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  agentCallingDate: {
    type: Date
  },
  status: {
    type: String,
    enum: ['Open', 'In-Progress', 'Closed'],
    default: 'Open'
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  queryType: {
    type: String,
    trim: true
  },
  howDidYouHearAboutUs: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Query', querySchema);

