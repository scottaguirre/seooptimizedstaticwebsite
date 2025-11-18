// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    unique: true,
    required: true,
    lowercase: true,
    trim: true
  },
  passwordHash: {
    type: String,
    required: true
  },
  credits: {
    type: Number,
    default: 20
  },
  role: {
    type: String,
    enum: ['superadmin', 'admin', 'subscriber', 'free'],  // 👈 add superadmin here
    default: 'subscriber'   // new users become "subscriber" by default
  },
  // 🔹 New fields for email verification
  verified: { type: Boolean, default: false },

  verificationToken: { type: String, default: null },

  createdAt: {
    type: Date,
    default: Date.now
  }
});

userSchema.methods.setPassword = async function (plain) {
  this.passwordHash = await bcrypt.hash(plain, 10);
};

userSchema.methods.validatePassword = async function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

module.exports = mongoose.model('User', userSchema);