// models/KeywordBudget.js
//
// How many PAID keyword lookups each customer has made today.
//
// WHY A COLLECTION AND NOT A COUNTER IN MEMORY
//
// pm2 restarts this app on every deploy, and a limit that forgets itself on
// deploy is not a limit — it is a limit somebody can reset by waiting for the
// next one. The existing rate limiters are in-memory on purpose: they guard
// against a burst over minutes, where a restart mid-burst costs little. This
// guards a prepaid balance over a day.
//
// WHY NOT A FIELD ON THE USER
//
// It would need clearing at midnight for every user who ever used the tool,
// which is a scheduled job to write and a scheduled job to forget. A row per
// customer per day with a TTL index means Mongo throws them away and nothing
// has to remember to.
//
// WHY ONLY PAID LOOKUPS
//
// A cache hit costs nothing. Counting one against a customer's allowance
// would lock them out of the answers the cache exists to give away free, and
// would punish exactly the customers researching a town somebody else has
// already paid for. See utils/keywordBudget.

const mongoose = require('mongoose');

const keywordBudgetSchema = new mongoose.Schema({
  // "<userId>:<YYYY-MM-DD>". One row per customer per day, so the count is
  // an $inc rather than a read-modify-write.
  key: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },

  // Kept for answering "who is using this?" later. The key is what finds it.
  userId: String,
  day: String,

  count: {
    type: Number,
    default: 0,
  },

  // What those lookups actually cost, so the question "is this worth
  // charging for?" has a number behind it rather than an impression.
  costUsd: {
    type: Number,
    default: 0,
  },

  // TTL index. Two days rather than one: a row for today must survive until
  // today is over in every timezone the customer might be in, and an extra
  // day of tiny rows costs nothing.
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 },
  },
});

module.exports = mongoose.models.KeywordBudget
  || mongoose.model('KeywordBudget', keywordBudgetSchema);
