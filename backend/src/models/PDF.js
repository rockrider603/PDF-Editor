const mongoose = require('mongoose');

const pdfSchema = new mongoose.Schema({
  originalName: {
    type: String,
    required: true
  },
  filePath: {
    type: String,
    required: true
  },
  fileSize: {
    type: Number,
    required: true
  },
  title: {
    type: String,
    default: null
  },
  description: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['processing', 'processed', 'failed'],
    default: 'processing'
  },
  processedAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt field before saving
pdfSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('PDF', pdfSchema);